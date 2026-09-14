export interface ModelPrice {
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
}

export const priceForModel = (model: string): ModelPrice | undefined => {
  if (model.includes("sonnet-5")) {
    return { inputUsdPerMillion: 2, outputUsdPerMillion: 10 };
  }
  if (model.includes("haiku")) {
    return { inputUsdPerMillion: 1, outputUsdPerMillion: 5 };
  }
  if (model.includes("opus")) {
    return { inputUsdPerMillion: 5, outputUsdPerMillion: 25 };
  }
  return undefined;
};

export const estimateUncachedCost = (
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined => {
  const price = priceForModel(model);
  return price === undefined
    ? undefined
    : (inputTokens * price.inputUsdPerMillion +
        outputTokens * price.outputUsdPerMillion) /
        1_000_000;
};
