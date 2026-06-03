/**
 * Agent-level types. The analysis agent is a thin wrapper around the
 * chart: it reads ChartResult and produces a structured report.
 */
import type { QuestionType } from './basic';
import type { ChartResult } from './chart';
export type { ChartResult };

export type QuestionUnderstanding = {
  questionType: QuestionType;
  userFocus: string;
  missingContext: string[];
};

/** A retrieved knowledge-base snippet the agent quotes in its analysis. */
export interface RagCitation {
  source: string;             // file path or doc name
  snippet: string;            // ~200 chars
  score: number;              // similarity 0..1
}

/** Final agent report (9-section full, 6-section MVP). */
export interface AnalysisReport {
  question: string;
  understanding: QuestionUnderstanding;
  summary: string;             // section 1
  originalHexagramInterpretation: string;
  changedHexagramInterpretation: string;
  movingLineAnalysis: string;
  shiYingAnalysis: string;
  yongshenAnalysis: string;
  strengthAndRelations: string;
  synthesis: string;            // overall judgment (no absolute "一定成/不成")
  uncertainties: string[];      // 谨慎结论 + 用户需补的信息
  citations: RagCitation[];
}
