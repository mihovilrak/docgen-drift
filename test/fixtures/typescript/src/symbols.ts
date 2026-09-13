/**
 * Measures the input text.
 * @param input Text to measure.
 * @returns The UTF-16 code unit count.
 * @category measurement
 */
/**
 * Measures the input text.
 * @param input Text to measure.
 * @returns The UTF-16 code unit count.
 * @category measurement
 */
export function declaredFunction(input: string): number {
  return input.length;
}

export const arrowFunction = (value: number): number => value * 2;

export const functionExpression = function (value: number): number {
  return value + 1;
};

export class Counter {
  readonly #values: number[] = [];

  add(value: number): void {
    this.#values.push(value);
  }

  protected reset(): void {
    this.#values.length = 0;
  }

  private snapshot(): readonly number[] {
    return this.#values;
  }

  get total(): number {
    return this.#values.reduce((sum, value) => sum + value, 0);
  }

  set total(value: number) {
    this.#values.length = 0;
    this.#values.push(value);
  }

  protected reset(): void {}

  private snapshot(): readonly number[] {
    return this.#values;
  }
}

class HiddenService {
  run(): void {}
}

class HiddenService {
  run(): void {}
}

export interface Store<T> {
  read(key: string): T | undefined;
}

export type Identifier = string & { readonly __brand: unique symbol };

export enum Status {
  Pending = "pending",
  Complete = "complete",
}

export const defaultLimit = 25;
