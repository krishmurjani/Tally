/**
 * A small line icon for a category. Matched on the name (so renamed or custom categories still get a sensible one),
 * with a neutral tag as the fallback. Drawn on a 20×20 grid in the current text colour.
 */
const P = {
  home: "M3.5 9.5L10 4l6.5 5.5M5 8.5V16h10V8.5M8.5 16v-4h3v4",
  flame: "M10 3c.5 2.6 3.5 4 3.5 7.2a3.5 3.5 0 0 1-7 0c0-1.3.6-2.2 1.3-3C8.4 8 9.5 6.4 10 3z",
  bolt: "M11 3L5 11h4l-1 6 6-8h-4l1-6z",
  cart: "M3 4h2l1.5 8h8l1.5-6H6M8 16a.8.8 0 1 0 0 .01M14 16a.8.8 0 1 0 0 .01",
  train: "M6 4h8a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 14 13H6a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 6 4zM4.5 8.5h11M7.5 13l-1.5 3M12.5 13l1.5 3M7.5 10.6h.01M12.5 10.6h.01",
  phone: "M7 3h6a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM9 15h2",
  wifi: "M3 8a10 10 0 0 1 14 0M5.5 10.8a6.5 6.5 0 0 1 9 0M8 13.5a3 3 0 0 1 4 0M10 16.2h.01",
  shirt: "M7 3.5l-4 2 1.5 3L6 8v8h8V8l1.5.5 1.5-3-4-2c-.4 1-1.2 1.5-3 1.5S7.4 4.5 7 3.5z",
  fork: "M6 3v5a2 2 0 0 0 2 2v7M6 3v5M8 3v5M14.5 17V3c-2 1.2-3 3.4-3 6v2h3",
  gift: "M3.5 8h13v3h-13zM4.5 11v6h11v-6M10 8v9M10 8C8 8 6.6 6.8 7 5.5 7.4 4.2 9.2 4.6 10 8c.8-3.4 2.6-3.8 3-2.5.4 1.3-1 2.5-3 2.5z",
  sofa: "M5 9V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M3.5 11a1.5 1.5 0 0 1 3 0v1.5h7V11a1.5 1.5 0 0 1 3 0v4.5h-13zM5 16v1M15 16v1",
  person: "M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 17c.4-3 2.7-4.5 6-4.5s5.6 1.5 6 4.5",
  plane: "M17 10.5L11.5 9 8 3.5 6.5 4l1.5 5-3 1-1.5-1.5L2 9.2l2 2.6L3 14l.8.6 2.4-.7 2.4 2.1.6-.6-1-2.7L12 13l4.5 1z",
  tag: "M3.5 4.5v5l7.5 7.5 5.5-5.5L9 4H4a.5.5 0 0 0-.5.5zM7 7.5h.01",
  dots: "M5 10h.01M10 10h.01M15 10h.01",
  car: "M4 12l1.2-4A1.5 1.5 0 0 1 6.6 7h6.8a1.5 1.5 0 0 1 1.4 1l1.2 4v3h-2v-1.5H6V15H4v-3zM6.5 12h.01M13.5 12h.01",
  coffee: "M4 7h9v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V7zM13 8h1.5a2 2 0 0 1 0 4H13M6.5 3.5v1.5M9.5 3.5v1.5",
  heart: "M10 16.5S3.5 12.7 3.5 8.2A3.2 3.2 0 0 1 10 6.6a3.2 3.2 0 0 1 6.5 1.6c0 4.5-6.5 8.3-6.5 8.3z",
  book: "M4 4.5h5a2 2 0 0 1 2 2V16a2 2 0 0 0-2-2H4zM16 4.5h-5a2 2 0 0 0-2 2",
} as const;

type Name = keyof typeof P;

/** First match wins. Order matters: the specific words before the broad ones. */
const RULES: [RegExp, Name][] = [
  [/rent|mortgage|housing/, "home"],
  [/gas|heat|fuel oil/, "flame"],
  [/electric|power|utilit/, "bolt"],
  [/grocer|supermarket|food shop/, "cart"],
  [/transport|transit|train|bus|metro|taxi|uber|lyft|commute/, "train"],
  [/car|auto|parking/, "car"],
  [/phone|mobile|cell/, "phone"],
  [/wi-?fi|internet|broadband/, "wifi"],
  [/laundry|clean|clothes|clothing/, "shirt"],
  [/dining|restaurant|takeout|eat/, "fork"],
  [/coffee|cafe/, "coffee"],
  [/gift|present/, "gift"],
  [/household|home supplies|furnit|supplies/, "sofa"],
  [/travel|trip|flight|hotel|vacation/, "plane"],
  [/health|medical|doctor|pharm|gym|fitness/, "heart"],
  [/book|school|educat|course|tuition/, "book"],
  [/personal|self/, "person"],
  [/general|misc|other|uncategor/, "dots"],
];

export function categoryIconName(category: string): Name {
  const n = category.toLowerCase();
  return RULES.find(([re]) => re.test(n))?.[1] ?? "tag";
}

export function CategoryIcon({ name, size = 18, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={P[categoryIconName(name)]} />
    </svg>
  );
}
