export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown provider error";

/**
 * Extract a non-empty diagnostic message from an Error object when available.
 * @param error The value to inspect for an Error instance with a non-empty string diagnostic property.
 */
export const errorDiagnostic = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || !("diagnostic" in error)) return undefined;
  const diagnostic = (error as Error & { readonly diagnostic?: unknown })
    .diagnostic;
  return typeof diagnostic === "string" && diagnostic.trim() !== ""
    ? diagnostic
    : undefined;
};
