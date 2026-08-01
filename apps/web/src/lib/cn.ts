/**
 * Joins class names, dropping falsy entries. Deliberately not `clsx` — this is
 * the whole of what we need from it.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
