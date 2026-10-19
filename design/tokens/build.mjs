// Regenerates tokens.css, tailwind-theme.css, tokens.ts and android/Colors.kt from tokens.json.
// Usage: node tokens/build.mjs   (Node 18+, no dependencies)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const t = JSON.parse(fs.readFileSync(path.join(here, 'tokens.json'), 'utf8'));

const strip = (o) => {
  if (Array.isArray(o)) return o.map(strip);
  if (o && typeof o === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(o)) if (!k.startsWith('$')) r[k] = strip(v);
    return r;
  }
  return o;
};
const T = strip(t);
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const header = () => 'Generated from tokens.json by tokens/build.mjs. Do not edit by hand.';

// ---------- CSS ----------
const themeVars = (set) => Object.entries(set).map(([k, v]) => `  --cc-${kebab(k)}: ${v};`).join('\n');
const pineVars = Object.entries(T.color.pine).map(([k, v]) => `  --cc-pine-${kebab(k)}: ${v};`).join('\n');
const px = (n) => (typeof n === 'number' ? n + 'px' : n);
const scalar = [];
scalar.push(`  --cc-font-sans: ${T.font.sans};`, `  --cc-font-mono: ${T.font.mono};`);
for (const [k, v] of Object.entries(T.type)) {
  scalar.push(`  --cc-type-${kebab(k)}-size: ${px(v.size)};`, `  --cc-type-${kebab(k)}-weight: ${v.weight};`, `  --cc-type-${kebab(k)}-tracking: ${v.tracking};`, `  --cc-type-${kebab(k)}-line: ${v.lineHeight};`);
}
for (const [k, v] of Object.entries(T.space)) scalar.push(`  --cc-space-${k}: ${px(v)};`);
for (const [k, v] of Object.entries(T.layout)) scalar.push(`  --cc-${kebab(k)}: ${px(v)};`);
for (const [k, v] of Object.entries(T.radius)) scalar.push(`  --cc-radius-${kebab(k)}: ${px(v)};`);
scalar.push(`  --cc-dock-blur: ${px(T.dock.blur)};`, `  --cc-dock-saturate: ${T.dock.saturate};`, `  --cc-dock-hairline: ${T.dock.hairline};`);

const css = `/* ${header()} */

:root {
  color-scheme: light;
${pineVars}
${themeVars(T.color.light)}
${scalar.join('\n')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${themeVars(T.color.dark).replace(/^ {2}/gm, '    ')}
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
${themeVars(T.color.dark)}
}

/* Base: sage or pine page, never white or black. */
html { background: var(--cc-bg); color: var(--cc-ink); font-family: var(--cc-font-sans); -webkit-font-smoothing: antialiased; }
body { margin: 0; background: var(--cc-bg); }
.cc-num { font-variant-numeric: tabular-nums; }

/* The glass dock. Contents always use the pine set (lime primary, pine-raised secondary). */
.cc-dock {
  border-radius: var(--cc-radius-dock);
  padding: ${T.dock.padding}px;
  background: var(--cc-dock);
  -webkit-backdrop-filter: blur(var(--cc-dock-blur)) saturate(var(--cc-dock-saturate));
  backdrop-filter: blur(var(--cc-dock-blur)) saturate(var(--cc-dock-saturate));
  box-shadow: var(--cc-dock-hairline), 0 ${T.dock.shadowOffsetY}px ${T.dock.shadowBlur}px var(--cc-dock-shadow);
  color: var(--cc-pine-mint);
}
`;
fs.writeFileSync(path.join(here, 'tokens.css'), css);

// ---------- Tailwind v4 bridge (optional) ----------
const twColours = [...Object.keys(T.color.light).filter((k) => !/shadow/i.test(k)).map((k) => `  --color-${kebab(k)}: var(--cc-${kebab(k)});`),
  ...Object.keys(T.color.pine).filter((k) => !/shadow/i.test(k)).map((k) => `  --color-pine-${kebab(k)}: var(--cc-pine-${kebab(k)});`)];
const tw = `/* ${header()}
   Optional. If the app uses Tailwind v4, import this after tokens.css:
     @import "tailwindcss";
     @import "../design/tokens/tokens.css";
     @import "../design/tokens/tailwind-theme.css";
   Then use bg-surface, text-ink-2, bg-pine-raised, rounded-card and so on. */
@theme inline {
${twColours.join('\n')}
${Object.keys(T.radius).map((k) => `  --radius-${kebab(k)}: var(--cc-radius-${kebab(k)});`).join('\n')}
  --font-sans: var(--cc-font-sans);
  --font-mono: var(--cc-font-mono);
}
`;
fs.writeFileSync(path.join(here, 'tailwind-theme.css'), tw);

// ---------- TypeScript ----------
const varMap = (keys, prefix) => '{\n' + keys.map((k) => `    ${k}: 'var(--cc-${prefix}${kebab(k)})',`).join('\n') + '\n  }';
const ts = `// ${header()}
export const tokens = ${JSON.stringify(T, null, 2)} as const;

/** Theme-aware colours as CSS variables (set by tokens.css). Use these in inline styles and SVG. */
export const cssVar = {
  theme: ${varMap(Object.keys(T.color.light), '')},
  pine: ${varMap(Object.keys(T.color.pine), 'pine-')},
} as const;

export type ThemeColour = keyof typeof tokens.color.light;
export type PineColour = keyof typeof tokens.color.pine;
export type Macro = 'protein' | 'carbs' | 'fat' | 'other';
`;
fs.writeFileSync(path.join(here, 'tokens.ts'), ts);

// ---------- Kotlin (Compose / Glance colours) ----------
const argb = (v) => {
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return '0xFF' + m[1].toUpperCase();
  m = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/i.exec(v);
  if (m) {
    const a = Math.round(parseFloat(m[4]) * 255);
    const h = (n) => Number(n).toString(16).padStart(2, '0').toUpperCase();
    return '0x' + h(a) + h(m[1]) + h(m[2]) + h(m[3]);
  }
  return null;
};
const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const ktObj = (name, set, doc) => {
  const lines = Object.entries(set).map(([k, v]) => { const a = argb(v); return a ? `    val ${pascal(k)} = Color(${a})` : null; }).filter(Boolean);
  return `/** ${doc} */\nobject ${name} {\n${lines.join('\n')}\n}\n`;
};
const kt = `// ${header()}
// Set the package to match the wrapper app before building.
package app.caloriecounter.design

import androidx.compose.ui.graphics.Color

${ktObj('PineColors', T.color.pine, 'Fixed colours for anything on pine: ring, widget, dock. Same in light and dark.')}
${ktObj('LightColors', T.color.light, 'Light theme content colours.')}
${ktObj('DarkColors', T.color.dark, 'Dark theme content colours.')}`;
fs.mkdirSync(path.join(here, '..', 'android'), { recursive: true });
fs.writeFileSync(path.join(here, '..', 'android', 'Colors.kt'), kt);

console.log('Wrote tokens.css, tailwind-theme.css, tokens.ts, android/Colors.kt');
