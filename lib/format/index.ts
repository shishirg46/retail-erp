export * from "./money";
export * from "./dates";
export * from "./tiers";

/** Short human-friendly reference derived from a UUID (first 8 hex chars, uppercased). */
export function shortRef(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
