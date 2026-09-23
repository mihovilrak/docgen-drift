export interface GenerationStageMetrics {
  readonly requests: number;
  readonly attempts: number;
  readonly candidates: number;
  readonly skipped: number;
  readonly failed: number;
  readonly durationMs: number;
}

export interface JudgeStageMetrics {
  readonly requests: number;
  readonly attempts: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly failed: number;
  readonly durationMs: number;
}

export interface GenerationRunMetrics {
  readonly durationMs: number;
  readonly generation: GenerationStageMetrics;
  readonly judge: JudgeStageMetrics;
}

export const EMPTY_GENERATION_STAGE: GenerationStageMetrics = {
  requests: 0,
  attempts: 0,
  candidates: 0,
  skipped: 0,
  failed: 0,
  durationMs: 0,
};

export const EMPTY_JUDGE_STAGE: JudgeStageMetrics = {
  requests: 0,
  attempts: 0,
  accepted: 0,
  rejected: 0,
  failed: 0,
  durationMs: 0,
};

export const addGenerationStages = (
  stages: readonly GenerationStageMetrics[],
): GenerationStageMetrics =>
  stages.reduce(
    (total, stage) => ({
      requests: total.requests + stage.requests,
      attempts: total.attempts + stage.attempts,
      candidates: total.candidates + stage.candidates,
      skipped: total.skipped + stage.skipped,
      failed: total.failed + stage.failed,
      durationMs: total.durationMs + stage.durationMs,
    }),
    EMPTY_GENERATION_STAGE,
  );

/**
 * Aggregate judge metrics across all supplied stages.
 * @param stages Judge-stage metrics whose request, attempt, outcome, failure, and duration values are summed.
 */
export const addJudgeStages = (
  stages: readonly JudgeStageMetrics[],
): JudgeStageMetrics =>
  stages.reduce(
    (total, stage) => ({
      requests: total.requests + stage.requests,
      attempts: total.attempts + stage.attempts,
      accepted: total.accepted + stage.accepted,
      rejected: total.rejected + stage.rejected,
      failed: total.failed + stage.failed,
      durationMs: total.durationMs + stage.durationMs,
    }),
    EMPTY_JUDGE_STAGE,
  );

export const elapsedMilliseconds = (started: number): number =>
  Math.max(0, Math.round(performance.now() - started));
