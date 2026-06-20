import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { CompetitorReport } from '../types/competitor.types';

@Injectable()
export class CompetitorAgent {
  private readonly logger = new Logger(CompetitorAgent.name);
  private readonly model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
  private readonly fallbackModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;

  private static readonly SYSTEM_INSTRUCTION = `Act as an ecommerce analyst.
Analyze only what's visible in the HTML.
Return ONLY valid JSON with no extra text.

The JSON structure must match:
{
  "productCategories": ["string"],
  "pricingStrategy": "string",
  "estimatedPriceRange": "string",
  "storeStrengths": ["string"],
  "storeWeaknesses": ["string"],
  "seoObservations": "string",
  "overallRating": number (between 1 and 10),
  "summary": "string (2-3 sentences)"
}`;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    const primaryModel   = process.env.GEMINI_MODEL          ?? 'gemini-2.5-flash';
    const fallbackModel  = process.env.FALLBACK_GEMINI_MODEL ?? 'gemini-3.5-flash';

    this.logger.log(`CompetitorAgent using primary=${primaryModel} fallback=${fallbackModel}`);

    const genAI = new GoogleGenerativeAI(apiKey);
    const opts  = {
      systemInstruction: CompetitorAgent.SYSTEM_INSTRUCTION,
      generationConfig: { responseMimeType: 'application/json' },
    };

    this.model         = genAI.getGenerativeModel({ model: primaryModel,  ...opts });
    this.fallbackModel = genAI.getGenerativeModel({ model: fallbackModel, ...opts });
  }

  /**
   * Main entry point.
   *
   * Strategy:
   *   1. Try to fetch the raw HTML of the page.
   *   2. If fetching succeeds, analyse the actual HTML (HTML mode).
   *   3. If fetching fails for any reason (ENOTFOUND, timeout, 403, etc.),
   *      fall back to a knowledge-based analysis where Gemini uses its
   *      training knowledge about the domain (Knowledge mode).
   *
   * This ensures the API always returns a useful analysis instead of
   * surfacing a hard error to the user.
   */
  async run(url: string): Promise<Omit<CompetitorReport, 'url' | 'generatedAt'>> {
    this.logger.log(`CompetitorAgent running for URL: "${url}"`);

    let htmlContent: string | null = null;

    try {
      const response = await axios.get(url, {
        timeout: 12_000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
      });
      const raw =
        typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data);

      // Strip scripts, styles and binary noise before sending to Gemini
      const cleaned = this.cleanHtml(raw);
      htmlContent = cleaned.substring(0, 6000); // tighter limit on clean text
      this.logger.log(
        `Fetched ${raw.length} raw chars → ${htmlContent.length} clean chars from ${url}`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Could not fetch HTML from "${url}" (${err.message}). Falling back to knowledge-based analysis.`,
      );
      // htmlContent stays null → knowledge-mode prompt below
    }

    // Try HTML-mode first; if Gemini rejects it (safety / token limits), fall
    // back to knowledge-mode automatically.
    if (htmlContent !== null) {
      try {
        const rawText = await this.callGemini(this.buildHtmlPrompt(htmlContent));
        return this.parseResponse(rawText);
      } catch (err: any) {
        this.logger.warn(
          `HTML-mode Gemini call failed (${err.message}). Retrying with knowledge-based prompt.`,
        );
        // fall through to knowledge-mode below
      }
    }

    // Knowledge-mode (either HTML was never fetched or Gemini rejected the HTML)
    const rawText = await this.callGemini(this.buildKnowledgePrompt(url));
    return this.parseResponse(rawText);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Strip scripts, styles, SVG, comments, and excess whitespace from raw HTML
   * so Gemini receives clean, human-readable text rather than JS/CSS blobs.
   */
  private cleanHtml(html: string): string {
    return html
      // Remove <script> blocks (including inline JS)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      // Remove <style> blocks
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      // Remove <svg> blocks
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
      // Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, '')
      // Remove noscript
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
      // Strip remaining HTML tags but keep their text content
      .replace(/<[^>]+>/g, ' ')
      // Collapse multiple whitespace / newlines
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /** Prompt when we successfully obtained and cleaned the page HTML */
  private buildHtmlPrompt(cleanedHtml: string): string {
    return `Analyze this extracted text content from a competitor's e-commerce store page.
Return ONLY the JSON object described in your system prompt.

PAGE TEXT:
---
${cleanedHtml}
---`;
  }

  /**
   * Prompt when HTML could not be fetched (domain not resolvable, bot-blocked, etc.).
   * Ask Gemini to use its own training knowledge about the store / domain.
   */
  private buildKnowledgePrompt(url: string): string {
    // Extract a clean domain name for the prompt
    let domain = url;
    try {
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      // leave as-is if URL is malformed
    }

    return `The live HTML of the store at "${url}" could not be fetched (the site may be down, bot-protected, or the domain may not exist publicly).

Using your knowledge about e-commerce stores and the domain "${domain}", perform a competitor analysis.
If you have no specific knowledge of this exact domain, make reasonable inferences based on the domain name and typical stores in that niche.
Clearly base your analysis on general knowledge rather than live data.

Return ONLY the JSON object described in your system prompt.`;
  }

  /**
   * Call Gemini with automatic fallback.
   * Tries the primary model first; if it fails for any reason (model not found,
   * safety block, quota, etc.) retries once with the fallback model.
   */
  private async callGemini(prompt: string): Promise<string> {
    // ── Primary model ────────────────────────────────────────────────────────
    try {
      const result = await this.model.generateContent(prompt);
      const text   = result.response.text().trim();
      if (!text) throw new Error('Empty response (possible safety filter block)');
      return text;
    } catch (primaryErr: any) {
      const primaryDetail = primaryErr?.message ?? String(primaryErr);
      this.logger.warn(
        `Primary model failed: ${primaryDetail}. Retrying with fallback model...`,
      );
    }

    // ── Fallback model ───────────────────────────────────────────────────────
    try {
      const result = await this.fallbackModel.generateContent(prompt);
      const text   = result.response.text().trim();
      if (!text) throw new Error('Empty response from fallback model (possible safety filter block)');
      this.logger.log('Fallback model responded successfully.');
      return text;
    } catch (fallbackErr: any) {
      const fallbackDetail = fallbackErr?.message ?? String(fallbackErr);
      this.logger.error(`Fallback model also failed: ${fallbackDetail}`);
      throw new InternalServerErrorException(
        `CompetitorAgent: Both primary and fallback Gemini models failed. Last error: ${fallbackDetail}`,
      );
    }
  }

  /** Parse and validate the JSON response from Gemini */
  private parseResponse(rawText: string): Omit<CompetitorReport, 'url' | 'generatedAt'> {
    let cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    // Sometimes Gemini wraps the whole thing in an extra object key
    const innerMatch = cleaned.match(/\{[\s\S]*\}/);
    if (innerMatch) cleaned = innerMatch[0];

    try {
      const parsed = JSON.parse(cleaned);
      return {
        productCategories: Array.isArray(parsed?.productCategories)
          ? parsed.productCategories
          : [],
        pricingStrategy:
          typeof parsed?.pricingStrategy === 'string'
            ? parsed.pricingStrategy
            : 'Not specified',
        estimatedPriceRange:
          typeof parsed?.estimatedPriceRange === 'string'
            ? parsed.estimatedPriceRange
            : 'Unknown',
        storeStrengths: Array.isArray(parsed?.storeStrengths)
          ? parsed.storeStrengths
          : [],
        storeWeaknesses: Array.isArray(parsed?.storeWeaknesses)
          ? parsed.storeWeaknesses
          : [],
        seoObservations:
          typeof parsed?.seoObservations === 'string'
            ? parsed.seoObservations
            : 'Not analyzed',
        overallRating:
          typeof parsed?.overallRating === 'number' ? parsed.overallRating : 5,
        summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
      };
    } catch {
      this.logger.error('Failed to parse CompetitorAgent JSON response', rawText);
      throw new InternalServerErrorException(
        'CompetitorAgent: Failed to parse Gemini response as JSON',
      );
    }
  }
}
