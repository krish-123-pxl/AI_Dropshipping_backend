import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ResearchResult, ScoredProduct } from '../types/ai.types';

@Injectable()
export class ScoringAgent {
  private readonly logger = new Logger(ScoringAgent.name);
  private readonly model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
  private readonly fallbackModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;

  private static readonly SYSTEM_INSTRUCTION = `You are a dropshipping product scoring engine.
Given a list of researched products you MUST assign numeric scores (1-100) for each.
Score meanings:
  demandScore      – how high consumer demand is (100 = extreme demand)
  competitionScore – inverse of competition (100 = almost no competition)
  profitScore      – profit potential based on margin (100 = very high margin)
  trendScore       – trajectory strength (100 = strongly rising trend)
  overallScore     – weighted average you compute yourself

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
      "overallScore": 0
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

    this.logger.log(`ScoringAgent using primary=${primaryModel} fallback=${fallbackModel}`);

    const genAI = new GoogleGenerativeAI(apiKey);
    const opts  = {
      systemInstruction: ScoringAgent.SYSTEM_INSTRUCTION,
      generationConfig: { responseMimeType: 'application/json' },
    };

    this.model         = genAI.getGenerativeModel({ model: primaryModel,  ...opts });
    this.fallbackModel = genAI.getGenerativeModel({ model: fallbackModel, ...opts });
  }

  async run(research: ResearchResult): Promise<ScoredProduct[]> {
    this.logger.log(`ScoringAgent scoring ${research.products.length} products`);

    const prompt = `Here are the researched products (JSON):
${JSON.stringify(research, null, 2)}

Score every product and return the enriched JSON array described in your system prompt.`;

    const rawText = await this.generateWithFallback(prompt);

    try {
      let cleaned = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      const innerMatch = cleaned.match(/\{[\s\S]*\}/);
      if (innerMatch) cleaned = innerMatch[0];

      const parsed: { products: ScoredProduct[] } = JSON.parse(cleaned);

      if (!Array.isArray(parsed?.products)) {
        throw new Error('Missing products array in response');
      }

      this.logger.log(`ScoringAgent returned ${parsed.products.length} scored products`);
      return parsed.products;
    } catch (err) {
      this.logger.error('Failed to parse ScoringAgent JSON response', rawText);
      throw new InternalServerErrorException(
        'ScoringAgent: Failed to parse Gemini response as JSON',
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
        `ScoringAgent: Both models failed. Last error: ${detail}`,
      );
    }
  }
}
