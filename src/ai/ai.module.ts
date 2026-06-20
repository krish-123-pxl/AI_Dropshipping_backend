import { Module } from '@nestjs/common';
import { ResearchAgent } from './agents/research.agent';
import { ScoringAgent } from './agents/scoring.agent';
import { ReportAgent } from './agents/report.agent';
import { CompetitorAgent } from './agents/competitor.agent';
import { AiOrchestrator } from './orchestrator.service';
import { ProductDiscoveryController } from './product-discovery.controller';
import { CompetitorController } from './competitor.controller';
import { ReportsController } from './reports.controller';

@Module({
  controllers: [ProductDiscoveryController, CompetitorController, ReportsController],
  providers: [
    ResearchAgent,
    ScoringAgent,
    ReportAgent,
    CompetitorAgent,
    AiOrchestrator,
  ],
  exports: [AiOrchestrator],
})
export class AiModule {}
