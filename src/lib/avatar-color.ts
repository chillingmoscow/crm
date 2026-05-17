import { paletteDot, PALETTE_COLORS } from "./palette.ts";

const NAMED = PALETTE_COLORS.filter((c) => c.name !== "default").map(
  (c) => c.name,
);

/** Deterministic on-palette dot class for an avatar fallback. */
export function avatarDotClass(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return paletteDot(NAMED[Math.abs(h) % NAMED.length]);
}
