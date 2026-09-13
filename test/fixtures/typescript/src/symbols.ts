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

  get total(): number {
    return this.#values.reduce((sum, value) => sum + value, 0);
  }

  set total(value: number) {
    this.#values.length = 0;
    this.#values.push(value);
  }
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
