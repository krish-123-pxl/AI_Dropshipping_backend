import { Injectable, Logger } from '@nestjs/common';
import { ResearchAgent } from './agents/research.agent';
import { ScoringAgent } from './agents/scoring.agent';
import { ReportAgent } from './agents/report.agent';
import { DiscoveryReport } from './types/ai.types';

@Injectable()
export class AiOrchestrator {
  private readonly logger = new Logger(AiOrchestrator.name);

  constructor(
    private readonly researchAgent: ResearchAgent,
    private readonly scoringAgent: ScoringAgent,
    private readonly reportAgent: ReportAgent,
  ) {}

  /**
   * Runs the full three-agent pipeline in sequence:
   *   1. ResearchAgent  – identify 5 trending products for the niche
   *   2. ScoringAgent   – assign numeric scores to each product
   *   3. ReportAgent    – write plain-English opportunity summaries
   *
   * @param niche  The dropshipping niche to research (e.g. "pet accessories")
   * @returns      A fully enriched DiscoveryReport ready to persist or return
   */
  async run(niche: string): Promise<DiscoveryReport> {
    this.logger.log(`Orchestrator starting pipeline for niche: "${niche}"`);

    // Step 1 – Research
    const researchResult = await this.researchAgent.run(niche);

    // Step 2 – Scoring
    const scoredProducts = await this.scoringAgent.run(researchResult);

    // Step 3 – Report (summaries)
    const reportedProducts = await this.reportAgent.run(scoredProducts);

    const report: DiscoveryReport = {
      niche,
      generatedAt: new Date().toISOString(),
      products: reportedProducts,
    };

    this.logger.log(`Orchestrator pipeline complete – ${reportedProducts.length} products in report`);
    return report;
  }
}
