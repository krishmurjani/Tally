/**
 * Stable colour per category: a tint with strongly contrasting text (contrast > 7:1 in both themes), picked by the category's
 * position in the owner's category list so the same category always looks the same.
 */
const HUES = [212, 24, 158, 42, 332, 128, 256, 4, 190, 292, 78, 220, 14];

export interface CategoryTone {
  background: string;
  color: string;
  dot: string;
  /** Tile border and bar fill. */
  border: string;
  bar: string;
}

export function categoryTone(name: string | null, order: string[]): CategoryTone {
  if (!name) return { background: "var(--color-warn-50)", color: "var(--color-warn)", dot: "var(--color-warn)", border: "var(--color-line)", bar: "var(--color-warn)" };
  const i = Math.max(0, order.indexOf(name));
  const h = HUES[i % HUES.length]!;
  return { background: `hsl(${h} var(--tone-bg))`, color: `hsl(${h} var(--tone-ink))`, dot: `hsl(${h} var(--tone-dot))`, border: `hsl(${h} var(--tone-border))`, bar: `hsl(${h} var(--tone-bar))` };
}
