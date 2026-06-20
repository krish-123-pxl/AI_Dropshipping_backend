import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ResearchResult } from '../types/ai.types';

@Injectable()
export class ResearchAgent {
  private readonly logger = new Logger(ResearchAgent.name);
  private readonly model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
  private readonly fallbackModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;

  private static readonly SYSTEM_INSTRUCTION = `You are an expert e-commerce market researcher specialising in dropshipping.
Your ONLY job is to identify the 5 best trending products for a given niche.
You MUST return ONLY valid JSON – no markdown fences, no prose, no extra keys.
The JSON must conform exactly to:
{
  "products": [
    {
      "name": "string",
      "category": "string",
      "demandSignals": "string",
      "competitionLevel": "Low | Medium | High",
      "potentialMargin": "string (e.g. 40-60%)",
      "trend": "Rising | Stable | Declining"
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

    this.logger.log(`ResearchAgent using primary=${primaryModel} fallback=${fallbackModel}`);

    const genAI = new GoogleGenerativeAI(apiKey);
    const opts  = {
      systemInstruction: ResearchAgent.SYSTEM_INSTRUCTION,
      generationConfig: { responseMimeType: 'application/json' },
    };

    this.model         = genAI.getGenerativeModel({ model: primaryModel,  ...opts });
    this.fallbackModel = genAI.getGenerativeModel({ model: fallbackModel, ...opts });
  }

  async run(niche: string): Promise<ResearchResult> {
    this.logger.log(`ResearchAgent running for niche: "${niche}"`);

    const prompt = `Niche: "${niche}"
Identify the 5 best trending products for dropshipping in this niche right now.
Return ONLY the JSON object described in your system prompt.`;

    const rawText = await this.generateWithFallback(prompt);

    try {
      let cleaned = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      const innerMatch = cleaned.match(/\{[\s\S]*\}/);
      if (innerMatch) cleaned = innerMatch[0];

      const parsed: ResearchResult = JSON.parse(cleaned);

      if (!Array.isArray(parsed?.products)) {
        throw new Error('Missing products array in response');
      }

      this.logger.log(`ResearchAgent found ${parsed.products.length} products`);
      return parsed;
    } catch (err) {
      this.logger.error('Failed to parse ResearchAgent JSON response', rawText);
      throw new InternalServerErrorException(
        'ResearchAgent: Failed to parse Gemini response as JSON',
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
        `ResearchAgent: Both models failed. Last error: ${detail}`,
      );
    }
  }
}
