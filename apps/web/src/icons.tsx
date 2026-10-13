// Product glyphs, rendered through the shared <Icon>. koboyo (first source)
// had no key in this build session, so these are plain 24px stroke paths in
// currentColor, one per concept. Swap each for its koboyo glyph once the key
// is set; the call sites only use the names below.
import { Icon } from "@maxifyhiring/ui";

function Svg({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

// One <path> per glyph: shapes inside one icon never stack as siblings.
const paths = {
  pipeline: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 4v16M15 4v16",
  decide: "M9 11l3 3 8-8M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9",
  calendar: "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM16 3v4M8 3v4M3 10h18",
  audit: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6",
  search: "M11 4a7 7 0 1 1 0 14a7 7 0 1 1 0-14zM20 20l-4-4",
  alert: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18zM12 8v5M12 16.5v.01",
  warning: "M10.3 4.3L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0zM12 9.5v4M12 17v.01",
  check: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18zM8.5 12.5l2.5 2.5 4.5-5",
  clock: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18zM12 7v5l3 2",
  back: "M15 18l-6-6 6-6",
  next: "M9 18l6-6-6-6",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  reset: "M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4",
  close: "M6 6l12 12M18 6L6 18",
  info: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18zM12 11v5M12 7.5v.01",
} as const;

export type GlyphName = keyof typeof paths;

export function Glyph({ name, size = 20, label }: { name: GlyphName; size?: number; label?: string }) {
  return (
    <Icon size={size} label={label} color="currentColor">
      <Svg d={paths[name]} />
    </Icon>
  );
}
