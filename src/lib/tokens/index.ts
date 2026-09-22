export {
  SPACE,
  RADIUS,
  TEXT,
  FONT_WEIGHT,
  SHADOW,
  MOTION,
  Z,
  STRUCTURE_VAR_NAMES,
  cssVar,
  type StructureVarName,
} from "./structure";

/** Semantic color CSS vars written by applyTheme(). */
export const SEMANTIC_VAR_NAMES = [
  "--bg",
  "--surface",
  "--surface-alt",
  "--text",
  "--muted",
  "--border",
  "--accent",
  "--accent-text",
  "--success",
  "--warning",
  "--danger",
] as const;

export type SemanticVarName = (typeof SEMANTIC_VAR_NAMES)[number];

/** Legacy aliases kept so existing shell CSS keeps working. */
export const COMPAT_VAR_NAMES = [
  "--rail",
  "--panel",
  "--elevated",
  "--border-soft",
  "--faint",
  "--ok",
  "--warn",
  "--user",
  "--assistant",
  "--accent-dim",
] as const;

export type CompatVarName = (typeof COMPAT_VAR_NAMES)[number];
