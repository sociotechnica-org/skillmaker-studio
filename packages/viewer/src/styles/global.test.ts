import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stylesPath = resolve(import.meta.dir, "global.css");
const skillPagePath = resolve(import.meta.dir, "../app/next/SkillPage.tsx");
const markdownPath = resolve(import.meta.dir, "../app/components/Markdown.tsx");
const styles = readFileSync(stylesPath, "utf8");
const skillPage = readFileSync(skillPagePath, "utf8");
const markdown = readFileSync(markdownPath, "utf8");

function blockAfter(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${marker} block`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  throw new Error(`Unclosed ${marker} block`);
}

function value(block: string, token: string): string {
  const match = block.match(new RegExp(`${token}:\\s*([^;]+);`, "i"));
  if (match === null) throw new Error(`Missing ${token}`);
  return match[1].trim();
}

function color(block: string, token: string): string {
  const resolved = value(block, token);
  if (!/^#[0-9a-f]{6}$/i.test(resolved)) throw new Error(`${token} is not a hex colour`);
  return resolved;
}

function tokens(className: string): Set<string> {
  return new Set(className.trim().split(/\s+/));
}

function classValue(source: string, name: string): Set<string> {
  const match = source.match(new RegExp(`const ${name}\\s*=\\s*\\n?\\s*"([^"]+)";`));
  if (match === null) throw new Error(`Missing ${name}`);
  return tokens(match[1]);
}

function hasAll(actual: Set<string>, expected: ReadonlyArray<string>): boolean {
  return expected.every((token) => actual.has(token));
}

function relativeLuminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g);
  if (channels === null) throw new Error(`Invalid hex colour: ${hex}`);
  const linear = channels.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function composite(foreground: string, background: string, opacity: number): string {
  const result = [0, 2, 4].map((index) => {
    const front = Number.parseInt(foreground.slice(index + 1, index + 3), 16);
    const back = Number.parseInt(background.slice(index + 1, index + 3), 16);
    return Math.round(front * opacity + back * (1 - opacity)).toString(16).padStart(2, "0");
  });
  return `#${result.join("")}`;
}

describe("dark-mode well token (#192)", () => {
  const theme = blockAfter(styles, "\n@theme");
  const dark = blockAfter(styles, "\n.dark {");

  test("declares the tabbed-section ground once for each theme", () => {
    expect((styles.match(/--color-well:/g) ?? []).length).toBe(2);
    expect((theme.match(/--color-well:/g) ?? []).length).toBe(1);
    expect((dark.match(/--color-well:/g) ?? []).length).toBe(1);
    expect(color(theme, "--color-well")).toBe("#f6eee0");
    expect(color(dark, "--color-well")).toBe("#1b150d");
  });

  test("keeps all four Skill page consumers token-driven", () => {
    const active = classValue(skillPage, "TAB_ACTIVE");
    const idle = classValue(skillPage, "TAB_IDLE");
    const content = tokens(skillPage.match(/className="([^"]*bg-well[^"]*)"/)?.[1] ?? "");
    const menuRow = tokens(skillPage.match(/className="([^"]*hover:bg-well[^"]*)"/)?.[1] ?? "");
    const wellUtilities = skillPage.match(/(?<![\w-])(hover:)?bg-well(?:\/70)?(?![\w-])/g) ?? [];

    expect(hasAll(active, ["bg-well", "text-ink"])).toBe(true);
    expect(hasAll(idle, ["bg-canvas", "text-ink-muted", "hover:bg-well/70", "hover:text-ink"])).toBe(true);
    expect(content.has("bg-well")).toBe(true);
    expect(menuRow.has("hover:bg-well")).toBe(true);
    expect(wellUtilities).toHaveLength(4);

    for (const classTokens of [active, idle, content, menuRow]) {
      expect([...classTokens].some((token) => token.startsWith("dark:bg-"))).toBe(false);
      expect([...classTokens].some((token) => /^((hover:)?(bg|text)-\[#|text-(black|white)$)/.test(token))).toBe(false);
    }
  });

  test("preserves readable text and code pairings on the corrected well", () => {
    const light = {
      canvas: value(theme, "--color-canvas").replace("var(--color-neutral-100)", color(theme, "--color-neutral-100")),
      well: color(theme, "--color-well"),
      ink: value(theme, "--color-ink").replace("var(--color-neutral-900)", color(theme, "--color-neutral-900")),
      inkMuted: color(theme, "--color-ink-muted"),
      heading: color(theme, "--color-neutral-900"),
      body: color(theme, "--color-neutral-700"),
      code: color(theme, "--color-neutral-100"),
    };
    const night = {
      canvas: color(dark, "--color-canvas"),
      well: color(dark, "--color-well"),
      ink: color(dark, "--color-ink"),
      inkMuted: color(dark, "--color-ink-muted"),
      heading: color(theme, "--color-neutral-100"),
      body: color(theme, "--color-neutral-300"),
      code: color(theme, "--color-neutral-900"),
    };

    expect(markdown).toContain("text-neutral-900 dark:text-neutral-100");
    expect(markdown).toContain("text-neutral-700 dark:text-neutral-300");
    expect(markdown).toContain("bg-neutral-100 px-1 font-mono text-[0.9em] dark:bg-neutral-900");
    expect(markdown).toContain("bg-neutral-100 p-2 font-mono text-[0.9em] dark:bg-neutral-900");

    for (const palette of [light, night]) {
      // #192 keeps the four well consumers on token pairings instead of
      // component-local dark overrides: active tab, body, idle hover, menu row.
      expect(contrast(palette.ink, palette.well)).toBeGreaterThanOrEqual(7);
      expect(contrast(palette.inkMuted, palette.well)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.ink, composite(palette.well, palette.canvas, 0.7))).toBeGreaterThanOrEqual(7);
      expect(contrast(palette.inkMuted, composite(palette.well, palette.canvas, 0.7))).toBeGreaterThanOrEqual(4.5);
    }

    expect(contrast(night.heading, night.well)).toBeGreaterThanOrEqual(7);
    expect(contrast(night.body, night.well)).toBeGreaterThanOrEqual(7);
    expect(contrast(light.ink, light.code)).toBeGreaterThanOrEqual(7);
    expect(contrast(night.ink, night.code)).toBeGreaterThanOrEqual(7);
  });
});
