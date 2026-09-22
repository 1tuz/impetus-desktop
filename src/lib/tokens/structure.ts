/**
 * Structure tokens — theme-agnostic rhythm (space / radius / type / shadow / motion / z).
 * Values live in `src/app.css` `:root`; this module is the typed mirror for TS callers.
 */

export const SPACE = {
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
} as const;

export const RADIUS = {
  sm: "6px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  full: "999px",
} as const;

export const TEXT = {
  xs: "11px",
  sm: "12px",
  base: "13px",
  md: "14px",
  lg: "16px",
  xl: "20px",
} as const;

export const FONT_WEIGHT = {
  regular: 400,
  medium: 500,
} as const;

export const SHADOW = {
  sm: "0 1px 2px rgba(0, 0, 0, 0.04)",
  md: "0 2px 8px rgba(0, 0, 0, 0.06)",
  lg: "0 8px 24px rgba(0, 0, 0, 0.1)",
} as const;

export const MOTION = {
  fast: "120ms",
  base: "200ms",
  slow: "320ms",
  ease: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

export const Z = {
  base: 1,
  sticky: 100,
  overlay: 200,
  modal: 300,
  toast: 400,
} as const;

/** CSS custom-property names for structure tokens (shared across themes). */
export const STRUCTURE_VAR_NAMES = [
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
  "--space-8",
  "--space-10",
  "--space-12",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--radius-xl",
  "--radius-full",
  "--text-xs",
  "--text-sm",
  "--text-base",
  "--text-md",
  "--text-lg",
  "--text-xl",
  "--font-regular",
  "--font-medium",
  "--shadow-sm",
  "--shadow-md",
  "--shadow-lg",
  "--motion-fast",
  "--motion-base",
  "--motion-slow",
  "--ease",
  "--z-base",
  "--z-sticky",
  "--z-overlay",
  "--z-modal",
  "--z-toast",
] as const;

export type StructureVarName = (typeof STRUCTURE_VAR_NAMES)[number];

export function cssVar(name: StructureVarName | string): string {
  return `var(${name})`;
}
