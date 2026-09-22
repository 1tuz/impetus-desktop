/**
 * Self-check: pack ↔ appearance toggle never jumps to a different pack.
 * Run: pnpm exec tsx scripts/theme-pack-selfcheck.ts
 */
import {
  THEME_PACKS,
  cyclePackId,
  packForVariant,
  toggleAppearanceId,
  toggleAppearancePref,
  variantIdFor,
} from "../src/lib/themes.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

for (const pack of THEME_PACKS) {
  assert(pack.dark || pack.light, `${pack.id}: need at least one side`);
  if (pack.dark) {
    const lightId = variantIdFor(pack.id, "light");
    const back = toggleAppearanceId(lightId);
    const backPack = packForVariant(back);
    // If pack has light twin, toggle must stay in pack; else Zinc fallback is OK.
    if (pack.light) {
      assert(
        backPack?.id === pack.id,
        `${pack.id}: dark→light→dark jumped to ${backPack?.id} (${back})`,
      );
      assert(
        lightId === pack.light,
        `${pack.id}: light variant expected ${pack.light}, got ${lightId}`,
      );
    }
  }
  if (pack.light && pack.dark) {
    const darkId = variantIdFor(pack.id, "dark");
    const lightId = toggleAppearanceId(darkId);
    assert(lightId === pack.light, `${pack.id}: toggle dark→light = ${lightId}`);
    const restored = toggleAppearanceId(lightId);
    assert(restored === pack.dark, `${pack.id}: toggle light→dark = ${restored}`);
  }
}

// Nord memory bug regression: never land on zinc when pack is nord.
{
  const nordDark = variantIdFor("nord", "dark");
  const nordLight = toggleAppearanceId(nordDark);
  const back = toggleAppearanceId(nordLight);
  assert(nordLight === "nord-light", `nord light got ${nordLight}`);
  assert(back === "nord", `nord restore got ${back}`);
  assert(packForVariant(back)?.id === "nord", "nord pack lost");
}

// Pref toggle: system resolves then becomes explicit opposite.
assert(toggleAppearancePref("dark") === "light", "dark→light pref");
assert(toggleAppearancePref("light") === "dark", "light→dark pref");

// Cycle packs stays on packs list.
{
  let id = "zinc";
  const seen = new Set<string>();
  for (let i = 0; i < THEME_PACKS.length; i++) {
    id = cyclePackId(id);
    seen.add(id);
  }
  assert(seen.size === THEME_PACKS.length, "cycle must visit every pack");
  assert(id === "zinc", "cycle must return to start");
}

console.log(`ok — ${THEME_PACKS.length} packs, toggle memory intact`);
