/**
 * Stable colour per category: a light tint with dark text (contrast > 7:1), picked by the category's
 * position in the owner's category list so the same category always looks the same.
 */
const HUES = [212, 24, 158, 42, 332, 128, 256, 4, 190, 292, 78, 220, 14];

export interface CategoryTone {
  background: string;
  color: string;
  dot: string;
}

export function categoryTone(name: string | null, order: string[]): CategoryTone {
  if (!name) return { background: "#fdf6e3", color: "#7a5000", dot: "#c98500" };
  const i = Math.max(0, order.indexOf(name));
  const h = HUES[i % HUES.length]!;
  return { background: `hsl(${h} 70% 92%)`, color: `hsl(${h} 55% 24%)`, dot: `hsl(${h} 60% 45%)` };
}
