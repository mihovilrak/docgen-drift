export const Provider = (
  { children, fallback }: { children: string; fallback: string },
  [first]: readonly string[],
  label: string,
): string => `${label}:${first ?? fallback}:${children}`;
