import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Logger,
} from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '../firebase/firebase.module';
import { CompetitorAgent } from './agents/competitor.agent';
import { CompetitorAnalyzeDto } from './dto/competitor-analyze.dto';
import { CompetitorReport } from './types/competitor.types';

@Controller('competitor')
export class CompetitorController {
  private readonly logger = new Logger(CompetitorController.name);

  constructor(
    private readonly agent: CompetitorAgent,
    @Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore,
  ) {}

  /**
   * POST /competitor/analyze
   *
   * Fetches the HTML of the provided competitor URL, analyzes it using the CompetitorAgent,
   * persists the report to Firestore "competitor_reports" collection,
   * and returns the report along with its database ID.
   */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async analyze(
    @Body() { url }: CompetitorAnalyzeDto,
  ): Promise<CompetitorReport & { reportId: string }> {
    this.logger.log(`POST /competitor/analyze – URL: "${url}"`);

    // Run the agent to analyze the competitor's page HTML
    const analysis = await this.agent.run(url);

    // Formulate the full report object
    const report: CompetitorReport = {
      url,
      ...analysis,
      generatedAt: new Date().toISOString(),
    };

    // Save the report to Firestore "competitor_reports"
    let reportId = '';
    try {
      const docRef = await this.firestore
        .collection('competitor_reports')
        .add(report);
      reportId = docRef.id;
      this.logger.log(`Competitor report saved to Firestore with ID: ${reportId}`);
    } catch (err) {
      this.logger.error('Failed to save competitor report to Firestore', err);
      // We still return the report even if Firestore persistence fails, so the user sees results
    }

    return { ...report, reportId };
  }
}
