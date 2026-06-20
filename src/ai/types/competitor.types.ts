// ── Competitor Research Types ─────────────────────────────────────────────────

/** Full analysis report for a competitor's store */
export interface CompetitorReport {
  /** The URL that was analysed */
  url: string;

  /** Main product categories sold */
  productCategories: string[];

  /** Description of the store's pricing approach */
  pricingStrategy: string;

  /** Estimated price range, e.g. "$10 – $80" */
  estimatedPriceRange: string;

  /** What the store does well */
  storeStrengths: string[];

  /** Weaknesses or gaps identified */
  storeWeaknesses: string[];

  /** Observations about on-page SEO */
  seoObservations: string;

  /** Overall quality score from 1 (poor) to 10 (excellent) */
  overallRating: number;

  /** 2-3 sentence executive summary */
  summary: string;

  /** ISO timestamp of when this report was generated */
  generatedAt: string;
}
