import type { PaymentInput } from "./types.js";

export const leaf = (value: number): number => value + 1;

export function mutualA(value: number): number {
  return value <= 0 ? 0 : mutualB(value - 1);
}

export function mutualB(value: number): number {
  return value <= 0 ? 0 : mutualA(value - 1);
}

// Converts a payment into the ledger's integer representation.
export function orchestrate(input: PaymentInput): number {
  return mutualA(leaf(input.amount));
}
