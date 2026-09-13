export type EvalVerdict = "ACCEPT" | "REJECT";

export interface JudgeEvalCase {
  readonly humanUseful: boolean;
  readonly judgeVerdict: EvalVerdict;
}

export interface JudgeMetrics {
  readonly total: number;
  readonly kept: number;
  readonly keepRate: number;
  readonly falseKeeps: number;
  readonly falseKeepRate: number;
  readonly falseRejects: number;
  readonly falseRejectRate: number;
}

export interface AblationEvalCase {
  readonly signatureOnlyScore: number;
  readonly fullContextScore: number;
}

export interface AblationMetrics {
  readonly total: number;
  readonly signatureOnlyMean: number;
  readonly fullContextMean: number;
  readonly meanImprovement: number;
}

export type SourceNoteKind = "intent" | "todo" | "directive" | "implementation";

export interface CommentPromotionEvalCase {
  readonly kind: SourceNoteKind;
  readonly accepted: boolean;
  readonly retainedUsefulIntent: boolean;
  readonly safePublicClaim: boolean;
}

export interface CommentPromotionMetrics {
  readonly total: number;
  readonly usefulIntentRetentionRate: number;
  readonly unsafePromotionRate: number;
  readonly noiseRejectionRate: number;
}

export const judgeMetrics = (cases: readonly JudgeEvalCase[]): JudgeMetrics => {
  const kept = cases.filter((item) => item.judgeVerdict === "ACCEPT");
  const useful = cases.filter((item) => item.humanUseful);
  const falseKeeps = kept.filter((item) => !item.humanUseful).length;
  const falseRejects = useful.filter(
    (item) => item.judgeVerdict === "REJECT",
  ).length;
  return {
    total: cases.length,
    kept: kept.length,
    keepRate: ratio(kept.length, cases.length),
    falseKeeps,
    falseKeepRate: ratio(falseKeeps, kept.length),
    falseRejects,
    falseRejectRate: ratio(falseRejects, useful.length),
  };
};

export const ablationMetrics = (
  cases: readonly AblationEvalCase[],
): AblationMetrics => {
  const signatureOnlyMean = mean(cases.map((item) => item.signatureOnlyScore));
  const fullContextMean = mean(cases.map((item) => item.fullContextScore));
  return {
    total: cases.length,
    signatureOnlyMean,
    fullContextMean,
    meanImprovement: fullContextMean - signatureOnlyMean,
  };
};

export const commentPromotionMetrics = (
  cases: readonly CommentPromotionEvalCase[],
): CommentPromotionMetrics => {
  const useful = cases.filter((item) => item.kind === "intent");
  const noise = cases.filter((item) => item.kind !== "intent");
  const accepted = cases.filter((item) => item.accepted);
  return {
    total: cases.length,
    usefulIntentRetentionRate: ratio(
      useful.filter((item) => item.accepted && item.retainedUsefulIntent)
        .length,
      useful.length,
    ),
    unsafePromotionRate: ratio(
      accepted.filter((item) => !item.safePublicClaim).length,
      accepted.length,
    ),
    noiseRejectionRate: ratio(
      noise.filter((item) => !item.accepted).length,
      noise.length,
    ),
  };
};

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const mean = (values: readonly number[]): number =>
  ratio(
    values.reduce((total, value) => total + value, 0),
    values.length,
  );
