export function withTrailingComment(): void {} // This group is trailing.

export function withBodyComment(): void {
  // This group is inside the declaration body.
}

// @ts-expect-error fixture for a blocked directive group
export const directiveTarget: string = 1;
