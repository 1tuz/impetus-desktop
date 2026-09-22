/**
 * Desktop theme catalog — named packs with dark+light variants.
 * Structure tokens live in `app.css` / `src/lib/tokens` (not per-theme).
 */

export type SemanticVars = {
  "--bg": string;
  "--surface": string;
  "--surface-alt": string;
  "--text": string;
  "--muted": string;
  "--border": string;
  "--accent": string;
  "--accent-text": string;
  "--success": string;
  "--warning": string;
  "--danger": string;
};

/** Semantic + compatibility aliases applied to `:root`. */
export type ThemeVars = SemanticVars & {
  "--rail": string;
  "--panel": string;
  "--elevated": string;
  "--border-soft": string;
  "--faint": string;
  "--ok": string;
  "--warn": string;
  "--user": string;
  "--assistant": string;
  "--accent-dim": string;
};

export type AppearancePref = "dark" | "light" | "system";
export type ResolvedAppearance = "dark" | "light";

export type ThemeMeta = {
  id: string;
  label: string;
  blurb: string;
  vars: ThemeVars;
  scheme: ResolvedAppearance;
};

export type ThemePack = {
  id: string;
  label: string;
  blurb: string;
  /** Variant id for dark appearance; omit for light-only packs. */
  dark?: string;
  /** Variant id for light appearance; omit for dark-only packs. */
  light?: string;
};

const PACK_KEY = "impetus.desktop.theme.pack";
const APPEARANCE_KEY = "impetus.desktop.theme.appearance";
/** Legacy single theme-id key — migrated once. */
const LEGACY_THEME_KEY = "impetus.desktop.theme";

export const DEFAULT_PACK_ID = "zinc";
export const DEFAULT_APPEARANCE: AppearancePref = "dark";
/** @deprecated use DEFAULT_PACK_ID — kept for callers that still pass a theme id default */
export const DEFAULT_THEME_ID = "zinc-calm";
export const DEFAULT_LIGHT_THEME_ID = "zinc-light";

type Rgb = [number, number, number];

function rgb(r: number, g: number, b: number): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function parseColor(input: string): Rgb | null {
  const rgbMatch = input.match(
    /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i,
  );
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  const rgbaMatch = input.match(
    /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i,
  );
  if (rgbaMatch) {
    return [Number(rgbaMatch[1]), Number(rgbaMatch[2]), Number(rgbaMatch[3])];
  }
  const h = input.replace("#", "");
  if (h.length === 6 && /^[0-9a-f]+$/i.test(h)) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  return null;
}

function scaleColor(input: string, factor: number, fallback = input): string {
  const c = parseColor(input);
  if (!c) return fallback;
  return rgb(
    Math.round(c[0] * factor),
    Math.round(c[1] * factor),
    Math.round(c[2] * factor),
  );
}

function dimAccent(color: string): string {
  return scaleColor(color, 0.7);
}

function softBorderFrom(border: string): string {
  const rgba = border.match(
    /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i,
  );
  if (rgba) {
    const a = Math.max(0, Number(rgba[4]) * 0.75);
    return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${a})`;
  }
  return scaleColor(border, 0.75, border);
}

function faintFromMuted(muted: string): string {
  return scaleColor(muted, 0.65, muted);
}

function mixRgb(a: string, b: string): string {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (pa && pb) {
    return rgb(
      Math.round((pa[0] + pb[0]) / 2),
      Math.round((pa[1] + pb[1]) / 2),
      Math.round((pa[2] + pb[2]) / 2),
    );
  }
  return a;
}

/** Map semantic palette → full ThemeVars including legacy aliases. */
function withCompat(s: SemanticVars): ThemeVars {
  return {
    ...s,
    "--rail": s["--surface"],
    "--panel": s["--surface"],
    "--elevated": s["--surface-alt"],
    "--border-soft": softBorderFrom(s["--border"]),
    "--faint": faintFromMuted(s["--muted"]),
    "--ok": s["--success"],
    "--warn": s["--warning"],
    "--user": s["--surface-alt"],
    "--assistant": mixRgb(s["--surface"], s["--bg"]),
    "--accent-dim": dimAccent(s["--accent"]),
  };
}

type Palette = {
  background: Rgb;
  surface: Rgb;
  surfaceAlt: Rgb;
  border: Rgb | string;
  muted: Rgb;
  text: Rgb;
  accent: Rgb;
  accentText: Rgb;
  green: Rgb;
  yellow: Rgb;
  red: Rgb;
};

function fromPalette(p: Palette): ThemeVars {
  const border =
    typeof p.border === "string" ? p.border : rgb(...p.border);
  return withCompat({
    "--bg": rgb(...p.background),
    "--surface": rgb(...p.surface),
    "--surface-alt": rgb(...p.surfaceAlt),
    "--text": rgb(...p.text),
    "--muted": rgb(...p.muted),
    "--border": border,
    "--accent": rgb(...p.accent),
    "--accent-text": rgb(...p.accentText),
    "--success": rgb(...p.green),
    "--warning": rgb(...p.yellow),
    "--danger": rgb(...p.red),
  });
}

/** Hex semantic shortcut (meow ocean / calm packs). */
function fromHex(s: {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentText: string;
  success: string;
  warning: string;
  danger: string;
}): ThemeVars {
  return withCompat({
    "--bg": s.bg,
    "--surface": s.surface,
    "--surface-alt": s.surfaceAlt,
    "--text": s.text,
    "--muted": s.muted,
    "--border": s.border,
    "--accent": s.accent,
    "--accent-text": s.accentText,
    "--success": s.success,
    "--warning": s.warning,
    "--danger": s.danger,
  });
}

/** Concrete variant palettes (ids referenced by packs). */
export const THEME_CATALOG: ThemeMeta[] = [
  {
    id: "ocean-dark",
    label: "Ocean Dark",
    blurb: "calm desktop · meow ocean dark",
    scheme: "dark",
    vars: fromHex({
      bg: "#0f1620",
      surface: "#1a2333",
      surfaceAlt: "#232f45",
      text: "#e6ecf5",
      muted: "#8b9bb5",
      border: "rgba(150, 175, 220, 0.16)",
      accent: "#5b8cff",
      accentText: "#0c1a35",
      success: "#4ad88a",
      warning: "#f0a53e",
      danger: "#f27070",
    }),
  },
  {
    id: "ocean-light",
    label: "Ocean Light",
    blurb: "calm daylight · meow ocean light",
    scheme: "light",
    vars: fromHex({
      bg: "#f5f7fb",
      surface: "#ffffff",
      surfaceAlt: "#eef2f9",
      text: "#1a2233",
      muted: "#5c6b83",
      border: "rgba(20, 40, 80, 0.12)",
      accent: "#2f6feb",
      accentText: "#ffffff",
      success: "#18a058",
      warning: "#d97b12",
      danger: "#d64545",
    }),
  },
  {
    id: "zinc-calm",
    label: "Zinc Dark",
    blurb: "Cursor-quiet monochrome · default dark",
    scheme: "dark",
    vars: fromHex({
      bg: "#09090b",
      surface: "#18181b",
      surfaceAlt: "#27272a",
      text: "#f4f4f5",
      muted: "#a1a1aa",
      border: "rgba(255, 255, 255, 0.08)",
      accent: "#e4e4e7",
      accentText: "#09090b",
      success: "#86efac",
      warning: "#fde047",
      danger: "#fca5a5",
    }),
  },
  {
    id: "zinc-light",
    label: "Zinc Light",
    blurb: "Cursor-quiet daylight · default light",
    scheme: "light",
    vars: fromHex({
      bg: "#fafafa",
      surface: "#ffffff",
      surfaceAlt: "#f4f4f5",
      text: "#18181b",
      muted: "#71717a",
      border: "rgba(24, 24, 27, 0.1)",
      accent: "#27272a",
      accentText: "#fafafa",
      success: "#16a34a",
      warning: "#ca8a04",
      danger: "#dc2626",
    }),
  },
  {
    id: "github-dark",
    label: "GitHub Dark",
    blurb: "familiar dark IDE chrome",
    scheme: "dark",
    vars: fromHex({
      bg: "#0d1117",
      surface: "#161b22",
      surfaceAlt: "#21262d",
      text: "#e6edf3",
      muted: "#8b949e",
      border: "rgba(240, 246, 252, 0.1)",
      accent: "#2f81f7",
      accentText: "#ffffff",
      success: "#3fb950",
      warning: "#d29922",
      danger: "#f85149",
    }),
  },
  {
    id: "github-light",
    label: "GitHub Light",
    blurb: "familiar light IDE paper",
    scheme: "light",
    vars: fromHex({
      bg: "#ffffff",
      surface: "#f6f8fa",
      surfaceAlt: "#eef1f4",
      text: "#1f2328",
      muted: "#656d76",
      border: "rgba(31, 35, 40, 0.12)",
      accent: "#0969da",
      accentText: "#ffffff",
      success: "#1a7f37",
      warning: "#9a6700",
      danger: "#cf222e",
    }),
  },
  {
    id: "solarized-light",
    label: "Solarized Light",
    blurb: "Schoonover daylight",
    scheme: "light",
    vars: fromHex({
      bg: "#fdf6e3",
      surface: "#eee8d5",
      surfaceAlt: "#e6dfc8",
      text: "#657b83",
      muted: "#93a1a1",
      border: "rgba(101, 123, 131, 0.28)",
      accent: "#268bd2",
      accentText: "#fdf6e3",
      success: "#859900",
      warning: "#b58900",
      danger: "#dc322f",
    }),
  },
  {
    id: "catppuccin-latte",
    label: "Catppuccin Latte",
    blurb: "pastel mocha light twin",
    scheme: "light",
    vars: fromHex({
      bg: "#eff1f5",
      surface: "#e6e9ef",
      surfaceAlt: "#dce0e8",
      text: "#4c4f69",
      muted: "#6c6f85",
      border: "rgba(76, 79, 105, 0.18)",
      accent: "#8839ef",
      accentText: "#eff1f5",
      success: "#40a02b",
      warning: "#df8e1d",
      danger: "#d20f39",
    }),
  },
  {
    id: "gruvbox-light",
    label: "Gruvbox Light",
    blurb: "warm retro paper",
    scheme: "light",
    vars: fromHex({
      bg: "#fbf1c7",
      surface: "#ebdbb2",
      surfaceAlt: "#d5c4a1",
      text: "#3c3836",
      muted: "#7c6f64",
      border: "rgba(60, 56, 54, 0.18)",
      accent: "#af3a03",
      accentText: "#fbf1c7",
      success: "#79740e",
      warning: "#b57614",
      danger: "#9d0006",
    }),
  },
  {
    id: "nord-light",
    label: "Nord Light",
    blurb: "arctic snow storm",
    scheme: "light",
    vars: fromHex({
      bg: "#eceff4",
      surface: "#e5e9f0",
      surfaceAlt: "#d8dee9",
      text: "#2e3440",
      muted: "#4c566a",
      border: "rgba(76, 86, 106, 0.2)",
      accent: "#5e81ac",
      accentText: "#eceff4",
      success: "#a3be8c",
      warning: "#ebcb8b",
      danger: "#bf616a",
    }),
  },
  {
    id: "impetus",
    label: "Impetus Neon",
    blurb: "optional · signature void + magenta thrust",
    scheme: "dark",
    vars: fromPalette({
      background: [6, 8, 18],
      surface: [12, 16, 32],
      surfaceAlt: [22, 18, 48],
      border: [72, 48, 120],
      muted: [140, 148, 180],
      text: [236, 240, 255],
      accent: [255, 46, 196],
      accentText: [255, 255, 255],
      green: [80, 250, 180],
      yellow: [255, 214, 102],
      red: [255, 85, 140],
    }),
  },
  {
    id: "impetus-light",
    label: "Impetus Neon Light",
    blurb: "optional · soft paper + magenta accent",
    scheme: "light",
    vars: fromHex({
      bg: "#f7f4ff",
      surface: "#ffffff",
      surfaceAlt: "#efe8ff",
      text: "#1a1430",
      muted: "#6b6288",
      border: "rgba(90, 40, 140, 0.14)",
      accent: "#d12bb8",
      accentText: "#ffffff",
      success: "#0f9f6e",
      warning: "#c98100",
      danger: "#d63a7a",
    }),
  },
  {
    id: "impetus-stars",
    label: "Impetus Stars",
    blurb: "optional · deeper black, soft starlight",
    scheme: "dark",
    vars: fromPalette({
      background: [3, 4, 12],
      surface: [10, 12, 24],
      surfaceAlt: [18, 22, 40],
      border: [48, 64, 96],
      muted: [120, 132, 160],
      text: [220, 228, 245],
      accent: [180, 160, 255],
      accentText: [12, 10, 28],
      green: [120, 220, 180],
      yellow: [240, 220, 160],
      red: [255, 120, 140],
    }),
  },
  {
    id: "impetus-stars-light",
    label: "Impetus Stars Light",
    blurb: "optional · pale sky + soft violet",
    scheme: "light",
    vars: fromHex({
      bg: "#f4f6fc",
      surface: "#ffffff",
      surfaceAlt: "#e8ecf8",
      text: "#141828",
      muted: "#5c6480",
      border: "rgba(40, 50, 90, 0.12)",
      accent: "#6b5cff",
      accentText: "#ffffff",
      success: "#1a9e6e",
      warning: "#c99920",
      danger: "#d45670",
    }),
  },
  {
    id: "impetus-galaxy",
    label: "Impetus Galaxy",
    blurb: "optional · galactic core magenta",
    scheme: "dark",
    vars: fromPalette({
      background: [2, 3, 14],
      surface: [8, 10, 28],
      surfaceAlt: [28, 14, 42],
      border: [90, 40, 130],
      muted: [130, 140, 190],
      text: [230, 236, 255],
      accent: [232, 56, 200],
      accentText: [255, 255, 255],
      green: [70, 230, 190],
      yellow: [255, 200, 120],
      red: [255, 70, 130],
    }),
  },
  {
    id: "impetus-galaxy-light",
    label: "Impetus Galaxy Light",
    blurb: "optional · lilac mist + core pink",
    scheme: "light",
    vars: fromHex({
      bg: "#faf5ff",
      surface: "#ffffff",
      surfaceAlt: "#f3e8ff",
      text: "#1c1028",
      muted: "#6e5a80",
      border: "rgba(120, 40, 140, 0.14)",
      accent: "#c026a8",
      accentText: "#ffffff",
      success: "#0d9a78",
      warning: "#d4880a",
      danger: "#e04570",
    }),
  },
  {
    id: "dracula",
    label: "Dracula",
    blurb: "classic purple geek dark",
    scheme: "dark",
    vars: fromPalette({
      background: [40, 42, 54],
      surface: [52, 55, 70],
      surfaceAlt: [68, 71, 90],
      border: [98, 114, 164],
      muted: [152, 159, 177],
      text: [248, 248, 242],
      accent: [189, 147, 249],
      accentText: [40, 42, 54],
      green: [80, 250, 123],
      yellow: [241, 250, 140],
      red: [255, 85, 85],
    }),
  },
  {
    id: "dracula-light",
    label: "Dracula Light",
    blurb: "classic purple on soft paper",
    scheme: "light",
    vars: fromHex({
      bg: "#f8f8f2",
      surface: "#ffffff",
      surfaceAlt: "#ededeb",
      text: "#282a36",
      muted: "#6272a4",
      border: "rgba(68, 71, 90, 0.18)",
      accent: "#7c3aed",
      accentText: "#ffffff",
      success: "#2ea043",
      warning: "#b58900",
      danger: "#e64553",
    }),
  },
  {
    id: "nord",
    label: "Nord",
    blurb: "arctic polar night",
    scheme: "dark",
    vars: fromPalette({
      background: [46, 52, 64],
      surface: [59, 66, 82],
      surfaceAlt: [67, 76, 94],
      border: [76, 86, 106],
      muted: [129, 161, 193],
      text: [236, 239, 244],
      accent: [136, 192, 208],
      accentText: [46, 52, 64],
      green: [163, 190, 140],
      yellow: [235, 203, 139],
      red: [191, 97, 106],
    }),
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    blurb: "warm retro terminal",
    scheme: "dark",
    vars: fromPalette({
      background: [40, 40, 40],
      surface: [60, 56, 54],
      surfaceAlt: [80, 73, 69],
      border: [124, 111, 100],
      muted: [168, 153, 132],
      text: [235, 219, 178],
      accent: [254, 128, 25],
      accentText: [40, 40, 40],
      green: [184, 187, 38],
      yellow: [250, 189, 47],
      red: [251, 73, 52],
    }),
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    blurb: "cool city neon blue",
    scheme: "dark",
    vars: fromPalette({
      background: [26, 27, 38],
      surface: [36, 40, 59],
      surfaceAlt: [41, 46, 66],
      border: [65, 72, 104],
      muted: [120, 130, 170],
      text: [192, 202, 245],
      accent: [122, 162, 247],
      accentText: [26, 27, 38],
      green: [158, 206, 106],
      yellow: [224, 175, 104],
      red: [247, 118, 142],
    }),
  },
  {
    id: "tokyo-night-light",
    label: "Tokyo Night Light",
    blurb: "Tokyo Day · cool paper blue",
    scheme: "light",
    vars: fromHex({
      bg: "#e1e2e7",
      surface: "#d5d6db",
      surfaceAlt: "#c8c9d0",
      text: "#3760bf",
      muted: "#6172b0",
      border: "rgba(55, 96, 191, 0.18)",
      accent: "#2e7de9",
      accentText: "#ffffff",
      success: "#587539",
      warning: "#8c6c3e",
      danger: "#f52a65",
    }),
  },
  {
    id: "catppuccin",
    label: "Catppuccin Mocha",
    blurb: "pastel mocha dark",
    scheme: "dark",
    vars: fromPalette({
      background: [30, 30, 46],
      surface: [49, 50, 68],
      surfaceAlt: [69, 71, 90],
      border: [88, 91, 112],
      muted: [166, 173, 200],
      text: [205, 214, 244],
      accent: [203, 166, 247],
      accentText: [30, 30, 46],
      green: [166, 227, 161],
      yellow: [249, 226, 175],
      red: [243, 139, 168],
    }),
  },
  {
    id: "solarized",
    label: "Solarized Dark",
    blurb: "Ethan Schoonover classic",
    scheme: "dark",
    vars: fromPalette({
      background: [0, 43, 54],
      surface: [7, 54, 66],
      surfaceAlt: [0, 61, 73],
      border: [88, 110, 117],
      muted: [131, 148, 150],
      text: [238, 232, 213],
      accent: [38, 139, 210],
      accentText: [253, 246, 227],
      green: [133, 153, 0],
      yellow: [181, 137, 0],
      red: [220, 50, 47],
    }),
  },
  {
    id: "monokai",
    label: "Monokai",
    blurb: "loud editor neon",
    scheme: "dark",
    vars: fromPalette({
      background: [39, 40, 34],
      surface: [50, 51, 44],
      surfaceAlt: [73, 72, 62],
      border: [117, 113, 94],
      muted: [117, 113, 94],
      text: [248, 248, 242],
      accent: [174, 129, 255],
      accentText: [39, 40, 34],
      green: [166, 226, 46],
      yellow: [230, 219, 116],
      red: [249, 38, 114],
    }),
  },
  {
    id: "monokai-light",
    label: "Monokai Light",
    blurb: "loud editor on cream paper",
    scheme: "light",
    vars: fromHex({
      bg: "#faf8f5",
      surface: "#ffffff",
      surfaceAlt: "#f0ece4",
      text: "#272822",
      muted: "#75715e",
      border: "rgba(39, 40, 34, 0.14)",
      accent: "#7e57c2",
      accentText: "#ffffff",
      success: "#6a9e18",
      warning: "#a68a0d",
      danger: "#e91e63",
    }),
  },
  {
    id: "one-dark",
    label: "One Dark",
    blurb: "Atom / VS Code familiar",
    scheme: "dark",
    vars: fromPalette({
      background: [40, 44, 52],
      surface: [49, 54, 63],
      surfaceAlt: [57, 63, 74],
      border: [76, 82, 99],
      muted: [171, 178, 191],
      text: [171, 178, 191],
      accent: [198, 120, 221],
      accentText: [40, 44, 52],
      green: [152, 195, 121],
      yellow: [229, 192, 123],
      red: [224, 108, 117],
    }),
  },
  {
    id: "one-light",
    label: "One Light",
    blurb: "Atom / VS Code daylight twin",
    scheme: "light",
    vars: fromHex({
      bg: "#fafafa",
      surface: "#ffffff",
      surfaceAlt: "#f0f0f0",
      text: "#383a42",
      muted: "#696c77",
      border: "rgba(56, 58, 66, 0.12)",
      accent: "#a626a4",
      accentText: "#ffffff",
      success: "#50a14f",
      warning: "#c18401",
      danger: "#e45649",
    }),
  },
  {
    id: "matrix",
    label: "Matrix",
    blurb: "phosphor green on black",
    scheme: "dark",
    vars: fromPalette({
      background: [0, 8, 0],
      surface: [0, 18, 0],
      surfaceAlt: [0, 32, 0],
      border: [0, 80, 20],
      muted: [40, 120, 50],
      text: [160, 255, 170],
      accent: [0, 255, 70],
      accentText: [0, 20, 0],
      green: [0, 220, 60],
      yellow: [180, 255, 80],
      red: [255, 60, 60],
    }),
  },
  {
    id: "matrix-light",
    label: "Matrix Light",
    blurb: "phosphor green on pale terminal",
    scheme: "light",
    vars: fromHex({
      bg: "#eef8ee",
      surface: "#ffffff",
      surfaceAlt: "#dcefdc",
      text: "#0a2a0a",
      muted: "#3d7a45",
      border: "rgba(0, 100, 30, 0.16)",
      accent: "#008c2e",
      accentText: "#ffffff",
      success: "#0a9e3a",
      warning: "#7a9e20",
      danger: "#c62828",
    }),
  },
];

/** Named packs — Prefs list + ⌘⇧T cycle. Every pack has dark+light where possible. */
export const THEME_PACKS: ThemePack[] = [
  {
    id: "zinc",
    label: "Zinc",
    blurb: "Cursor-quiet monochrome · default",
    dark: "zinc-calm",
    light: "zinc-light",
  },
  {
    id: "ocean",
    label: "Ocean",
    blurb: "calm meow desktop blues",
    dark: "ocean-dark",
    light: "ocean-light",
  },
  {
    id: "github",
    label: "GitHub",
    blurb: "familiar IDE chrome",
    dark: "github-dark",
    light: "github-light",
  },
  {
    id: "nord",
    label: "Nord",
    blurb: "arctic polar / snow storm",
    dark: "nord",
    light: "nord-light",
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    blurb: "warm retro terminal",
    dark: "gruvbox",
    light: "gruvbox-light",
  },
  {
    id: "solarized",
    label: "Solarized",
    blurb: "Ethan Schoonover classic",
    dark: "solarized",
    light: "solarized-light",
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    blurb: "pastel mocha / latte",
    dark: "catppuccin",
    light: "catppuccin-latte",
  },
  {
    id: "dracula",
    label: "Dracula",
    blurb: "classic purple geek",
    dark: "dracula",
    light: "dracula-light",
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    blurb: "cool city neon / day",
    dark: "tokyo-night",
    light: "tokyo-night-light",
  },
  {
    id: "monokai",
    label: "Monokai",
    blurb: "loud editor neon",
    dark: "monokai",
    light: "monokai-light",
  },
  {
    id: "one-dark",
    label: "One Dark",
    blurb: "Atom / VS Code familiar",
    dark: "one-dark",
    light: "one-light",
  },
  {
    id: "matrix",
    label: "Matrix",
    blurb: "phosphor green terminal",
    dark: "matrix",
    light: "matrix-light",
  },
  {
    id: "impetus",
    label: "Impetus Neon",
    blurb: "signature void + magenta",
    dark: "impetus",
    light: "impetus-light",
  },
  {
    id: "impetus-stars",
    label: "Impetus Stars",
    blurb: "deeper black / pale sky",
    dark: "impetus-stars",
    light: "impetus-stars-light",
  },
  {
    id: "impetus-galaxy",
    label: "Impetus Galaxy",
    blurb: "galactic core magenta",
    dark: "impetus-galaxy",
    light: "impetus-galaxy-light",
  },
];

/** Legacy theme-id → pack id (migration + aliases). */
const VARIANT_TO_PACK: Record<string, string> = {
  zinc: "zinc",
  "zinc-calm": "zinc",
  "zinc-light": "zinc",
  "ocean-dark": "ocean",
  "ocean-light": "ocean",
  "github-dark": "github",
  "github-light": "github",
  nord: "nord",
  "nord-light": "nord",
  gruvbox: "gruvbox",
  "gruvbox-light": "gruvbox",
  solarized: "solarized",
  "solarized-light": "solarized",
  catppuccin: "catppuccin",
  "catppuccin-latte": "catppuccin",
  dracula: "dracula",
  "dracula-light": "dracula",
  "tokyo-night": "tokyo-night",
  "tokyo-night-light": "tokyo-night",
  monokai: "monokai",
  "monokai-light": "monokai",
  "one-dark": "one-dark",
  "one-light": "one-dark",
  matrix: "matrix",
  "matrix-light": "matrix",
  impetus: "impetus",
  "impetus-light": "impetus",
  "impetus-stars": "impetus-stars",
  "impetus-stars-light": "impetus-stars",
  "impetus-galaxy": "impetus-galaxy",
  "impetus-galaxy-light": "impetus-galaxy",
};

export function themeById(id: string): ThemeMeta | undefined {
  const needle = id.trim().toLowerCase();
  return THEME_CATALOG.find(
    (t) => t.id === needle || t.label.toLowerCase() === needle,
  );
}

export function packById(id: string): ThemePack | undefined {
  const needle = id.trim().toLowerCase();
  return THEME_PACKS.find((p) => p.id === needle);
}

export function packForVariant(themeId: string): ThemePack | undefined {
  const packId = VARIANT_TO_PACK[themeId.trim().toLowerCase()];
  return packId ? packById(packId) : undefined;
}

export function isLightTheme(id: string): boolean {
  const theme = themeById(id);
  if (theme?.scheme) return theme.scheme === "light";
  return (
    id.includes("light") ||
    id.includes("latte") ||
    id === "ocean-light"
  );
}

export function resolveSystemAppearance(): ResolvedAppearance {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveAppearance(pref: AppearancePref): ResolvedAppearance {
  if (pref === "system") return resolveSystemAppearance();
  return pref;
}

/**
 * Pick variant id for pack + resolved appearance.
 * One-sided packs fall back to Zinc for the missing side (System still works).
 */
export function variantIdFor(
  packId: string,
  appearance: AppearancePref,
): string {
  const pack = packById(packId) ?? packById(DEFAULT_PACK_ID)!;
  const side = resolveAppearance(appearance);
  const own = side === "dark" ? pack.dark : pack.light;
  if (own && themeById(own)) return own;

  const zinc = packById(DEFAULT_PACK_ID)!;
  const fallback = side === "dark" ? zinc.dark! : zinc.light!;
  return fallback;
}

export function swatchForPack(pack: ThemePack): string {
  const id = pack.dark ?? pack.light ?? DEFAULT_THEME_ID;
  return themeById(id)?.vars["--accent"] ?? "#e4e4e7";
}

/** Sun/moon: Dark↔Light within current pack. Leaves System for Prefs only. */
export function toggleAppearancePref(
  appearance: AppearancePref,
): AppearancePref {
  const resolved = resolveAppearance(appearance);
  return resolved === "dark" ? "light" : "dark";
}

/** @deprecated use toggleAppearancePref + applyThemePrefs — kept for old call sites */
export function toggleAppearanceId(current: string): string {
  const pack = packForVariant(current) ?? packById(DEFAULT_PACK_ID)!;
  const nextSide: AppearancePref = isLightTheme(current) ? "dark" : "light";
  return variantIdFor(pack.id, nextSide);
}

export function cyclePackId(currentPackId: string): string {
  const idx = THEME_PACKS.findIndex((p) => p.id === currentPackId);
  const next = THEME_PACKS[(idx + 1) % THEME_PACKS.length];
  return next?.id ?? DEFAULT_PACK_ID;
}

/** @deprecated use cyclePackId — cycles packs, not every variant */
export function cycleThemeId(current: string): string {
  const pack = packForVariant(current) ?? packById(DEFAULT_PACK_ID)!;
  const nextPack = cyclePackId(pack.id);
  const side: AppearancePref = isLightTheme(current) ? "light" : "dark";
  return variantIdFor(nextPack, side);
}

export type ThemePrefs = {
  packId: string;
  appearance: AppearancePref;
  themeId: string;
};

function persistPrefs(packId: string, appearance: AppearancePref): void {
  try {
    localStorage.setItem(PACK_KEY, packId);
    localStorage.setItem(APPEARANCE_KEY, appearance);
    localStorage.setItem(LEGACY_THEME_KEY, variantIdFor(packId, appearance));
  } catch {
    /* private mode / locked storage */
  }
}

export function applyThemePrefs(
  packId: string,
  appearance: AppearancePref,
): ThemePrefs {
  const pack = packById(packId) ?? packById(DEFAULT_PACK_ID)!;
  const themeId = variantIdFor(pack.id, appearance);
  const theme = themeById(themeId) ?? themeById(DEFAULT_THEME_ID)!;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.vars)) {
    root.style.setProperty(key, value);
  }
  root.setAttribute("data-theme", theme.id);
  const light = theme.scheme === "light";
  root.style.setProperty("color-scheme", light ? "light" : "dark");
  persistPrefs(pack.id, appearance);
  return { packId: pack.id, appearance, themeId: theme.id };
}

/** Apply by concrete variant id (infers pack; keeps appearance if passed). */
export function applyTheme(
  id: string,
  appearance?: AppearancePref,
): string {
  const pack = packForVariant(id) ?? packById(DEFAULT_PACK_ID)!;
  const side =
    appearance ??
    (isLightTheme(id) ? ("light" as const) : ("dark" as const));
  return applyThemePrefs(pack.id, side).themeId;
}

export function readStoredPrefs(): {
  packId: string;
  appearance: AppearancePref;
} {
  try {
    const rawPack = localStorage.getItem(PACK_KEY);
    const rawAppearance = localStorage.getItem(APPEARANCE_KEY);
    if (rawPack && packById(rawPack)) {
      const appearance = parseAppearance(rawAppearance);
      return { packId: rawPack, appearance };
    }

    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy) {
      const pack = packForVariant(legacy);
      if (pack) {
        const appearance: AppearancePref = isLightTheme(legacy)
          ? "light"
          : "dark";
        persistPrefs(pack.id, appearance);
        return { packId: pack.id, appearance };
      }
    }
  } catch {
    /* ignore */
  }
  return { packId: DEFAULT_PACK_ID, appearance: DEFAULT_APPEARANCE };
}

function parseAppearance(raw: string | null): AppearancePref {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return DEFAULT_APPEARANCE;
}

/** @deprecated use readStoredPrefs */
export function readStoredThemeId(): string {
  const { packId, appearance } = readStoredPrefs();
  return variantIdFor(packId, appearance);
}

/** Listen for OS scheme changes when appearance === system. Returns unsubscribe. */
export function watchSystemAppearance(
  onChange: (resolved: ResolvedAppearance) => void,
): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => onChange(mq.matches ? "dark" : "light");
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
