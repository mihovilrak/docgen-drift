// Keeps the original insertion order for equal priorities.
// This group is attached to the declaration.
export function stableSort(values: readonly number[]): number[] {
  return [...values].sort((left, right) => left - right);
}

// This group is detached from the declaration.

export function detachedComment(): void {}

// This group is blocked by a tool directive.
// eslint-disable-next-line @typescript-eslint/no-empty-function
export function blockedComment(): void {}

export function parse(value: string): string;
export function parse(value: number): number;
export function parse(value: string | number): string | number {
  return value;
}

export async function completesAsynchronously(): Promise<void> {
  await Promise.resolve();
}

export class DecoratedService {
  // Survives a decorator between the group and declaration.
  @trace
  run(): void {}
}

function trace(_target: object, _propertyKey: string | symbol): void {}
