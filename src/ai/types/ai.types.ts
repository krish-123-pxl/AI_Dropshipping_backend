// ── Shared types for the multi-agent AI pipeline ─────────────────────────────

/** Raw product data returned by the ResearchAgent */
export interface ResearchedProduct {
  name: string;
  category: string;
  demandSignals: string;
  competitionLevel: string;
  potentialMargin: string;
  trend: string;
}

/** Output of the ResearchAgent */
export interface ResearchResult {
  products: ResearchedProduct[];
}

/** A product that has been scored by the ScoringAgent */
export interface ScoredProduct extends ResearchedProduct {
  demandScore: number;
  competitionScore: number; // lower competition → higher score
  profitScore: number;
  trendScore: number;
  overallScore: number;
}

/** A scored product enriched with an AI-generated summary by the ReportAgent */
export interface ReportedProduct extends ScoredProduct {
  summary: string;
}

/** Final output of the AiOrchestrator – saved to Firestore */
export interface DiscoveryReport {
  niche: string;
  generatedAt: string; // ISO timestamp
  products: ReportedProduct[];
}
