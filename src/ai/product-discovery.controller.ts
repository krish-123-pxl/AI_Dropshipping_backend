import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Logger,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { FIREBASE_FIRESTORE } from '../firebase/firebase.module';
import { AiOrchestrator } from './orchestrator.service';
import { DiscoverySearchDto } from './dto/discovery-search.dto';
import { DiscoveryReport } from './types/ai.types';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';

@Controller('discovery')
@UseGuards(FirebaseAuthGuard)
export class ProductDiscoveryController {
  private readonly logger = new Logger(ProductDiscoveryController.name);

  constructor(
    private readonly orchestrator: AiOrchestrator,
    @Inject(FIREBASE_FIRESTORE) private readonly firestore: Firestore,
  ) {}

  /**
   * POST /discovery/search
   *
   * Runs the full multi-agent AI pipeline for the provided niche,
   * persists the resulting report to Firestore collection "product_reports",
   * and returns the report to the caller.
   *
   * Body:     { niche: string }
   * Response: DiscoveryReport (with Firestore document ID)
   */
  @Post('search')
  @UseGuards(SubscriptionGuard)
  @HttpCode(HttpStatus.OK)
  async search(
    @Body() { niche }: DiscoverySearchDto,
    @Req() req: any,
  ): Promise<DiscoveryReport & { reportId: string }> {
    this.logger.log(`POST /discovery/search – niche: "${niche}" for user "${req.user.uid}"`);

    // Run the three-agent pipeline
    const report = await this.orchestrator.run(niche);

    // Persist to Firestore
    let reportId = '';
    try {
      const docRef = await this.firestore
        .collection('product_reports')
        .add({
          ...report,
          userId: req.user.uid,
        });
      reportId = docRef.id;
      this.logger.log(`Report saved to Firestore with ID: ${reportId}`);
    } catch (err) {
      // Non-fatal – log and continue so the caller still gets the report
      this.logger.error('Failed to save report to Firestore', err);
    }

    // Increment user's search usage count
    try {
      await this.firestore
        .collection('users')
        .doc(req.user.uid)
        .update({
          searchesUsed: FieldValue.increment(1),
        });
      this.logger.log(`Incremented searchesUsed for user "${req.user.uid}"`);
    } catch (err) {
      this.logger.error(`Failed to increment searchesUsed for user "${req.user.uid}"`, err);
    }

    return { ...report, reportId };
  }
}
