import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ScoredProduct, ReportedProduct } from '../types/ai.types';

@Injectable()
export class ReportAgent {
  private readonly logger = new Logger(ReportAgent.name);
  private readonly model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
  private readonly fallbackModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;

  private static readonly SYSTEM_INSTRUCTION = `You are a dropshipping business analyst who writes sharp, concise opportunity summaries.
For each product provided, write exactly 2-3 sentences in plain English that explain:
  1. Why this product is a strong dropshipping opportunity right now.
  2. The key risk or challenge to watch out for.

Return ONLY valid JSON – no markdown, no commentary – in this exact shape:
{
  "products": [
    {
      "name": "string",
      "category": "string",
      "demandSignals": "string",
      "competitionLevel": "string",
      "potentialMargin": "string",
      "trend": "string",
      "demandScore": 0,
      "competitionScore": 0,
      "profitScore": 0,
      "trendScore": 0,
      "overallScore": 0,
      "summary": "2-3 sentence opportunity summary."
    }
  ]
}`;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    const primaryModel  = process.env.GEMINI_MODEL          ?? 'gemini-2.5-flash';
    const fallbackModel = process.env.FALLBACK_GEMINI_MODEL ?? 'gemini-3.5-flash';

    this.logger.log(`ReportAgent using primary=${primaryModel} fallback=${fallbackModel}`);

    const genAI = new GoogleGenerativeAI(apiKey);
    const opts  = {
      systemInstruction: ReportAgent.SYSTEM_INSTRUCTION,
      generationConfig: { responseMimeType: 'application/json' },
    };

    this.model         = genAI.getGenerativeModel({ model: primaryModel,  ...opts });
    this.fallbackModel = genAI.getGenerativeModel({ model: fallbackModel, ...opts });
  }

  async run(scoredProducts: ScoredProduct[]): Promise<ReportedProduct[]> {
    this.logger.log(`ReportAgent writing summaries for ${scoredProducts.length} products`);

    const prompt = `Here are the scored products (JSON):
${JSON.stringify({ products: scoredProducts }, null, 2)}

Write a 2-3 sentence opportunity summary for each product and return the enriched JSON described in your system prompt.`;

    const rawText = await this.generateWithFallback(prompt);

    try {
      let cleaned = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      const innerMatch = cleaned.match(/\{[\s\S]*\}/);
      if (innerMatch) cleaned = innerMatch[0];

      const parsed: { products: ReportedProduct[] } = JSON.parse(cleaned);

      if (!Array.isArray(parsed?.products)) {
        throw new Error('Missing products array in response');
      }

      this.logger.log(`ReportAgent completed ${parsed.products.length} product summaries`);
      return parsed.products;
    } catch (err) {
      this.logger.error('Failed to parse ReportAgent JSON response', rawText);
      throw new InternalServerErrorException(
        'ReportAgent: Failed to parse Gemini response as JSON',
      );
    }
  }

  /** Try primary model; on any failure retry once with the fallback model. */
  private async generateWithFallback(prompt: string): Promise<string> {
    try {
      const result = await this.model.generateContent(prompt);
      return result.response.text().trim();
    } catch (primaryErr: any) {
      this.logger.warn(
        `Primary model failed: ${primaryErr?.message}. Retrying with fallback model...`,
      );
    }

    try {
      const result = await this.fallbackModel.generateContent(prompt);
      this.logger.log('Fallback model responded successfully.');
      return result.response.text().trim();
    } catch (fallbackErr: any) {
      const detail = fallbackErr?.message ?? String(fallbackErr);
      this.logger.error(`Fallback model also failed: ${detail}`);
      throw new InternalServerErrorException(
        `ReportAgent: Both models failed. Last error: ${detail}`,
      );
    }
  }
}
