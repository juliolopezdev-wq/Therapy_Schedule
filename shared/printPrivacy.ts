/** Remove only a separate trailing surname initial from a staff display name. */
export function nameWithoutTrailingInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1 && /^[A-Za-z]\.?$/.test(parts[parts.length - 1])) {
    return parts.slice(0, -1).join(" ");
  }
  return trimmed;
}
