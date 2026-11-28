// build-ansur-proportions.mjs — מחולל מערך הפרופורציות מתוך ANSUR II.
// מקור: ANSUR II (2012 U.S. Army Anthropometric Survey) — נתונים ציבוריים,
// 4,082 גברים + 1,986 נשים, מדידות במ"מ.
// שימוש: node tools/build-ansur-proportions.mjs <MALE.csv> <FEMALE.csv>
// פלט: src/data/ansur-proportions.js

import { readFileSync, writeFileSync } from 'node:fs';

const COLS = [
  'stature', 'acromialheight', 'cervicaleheight', 'trochanterionheight',
  'kneeheightmidpatella', 'lateralmalleolusheight', 'acromionradialelength',
  'radialestylionlength', 'handlength', 'biacromialbreadth', 'hipbreadth',
  'tragiontopofhead', 'footlength', 'buttockheight', 'weightkg',
];

function parseCsv(path) {
  const text = readFileSync(path, 'latin1');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''));
  const idx = Object.fromEntries(COLS.map((c) => [c, header.indexOf(c)]));
  for (const c of COLS) if (idx[c] < 0) console.warn(`column missing: ${c}`);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const row = {};
    let ok = true;
    for (const c of COLS) {
      if (idx[c] < 0) continue;
      const v = parseFloat(cells[idx[c]]);
      if (!Number.isFinite(v)) { ok = false; break; }
      row[c] = v;
    }
    if (ok) rows.push(row);
  }
  return rows;
}

function stats(rows, col) {
  const vals = rows.map((r) => r[col]).filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return { mean: +mean.toFixed(1), p5: q(0.05), p50: q(0.5), p95: q(0.95) };
}

const [maleCsv, femaleCsv] = process.argv.slice(2);
if (!maleCsv || !femaleCsv) { console.error('usage: node build-ansur-proportions.mjs MALE.csv FEMALE.csv'); process.exit(1); }

const out = {};
for (const [sex, path] of [['male', maleCsv], ['female', femaleCsv]]) {
  const rows = parseCsv(path);
  const s = {};
  for (const c of COLS) s[c] = stats(rows, c);
  s.n = rows.length;
  out[sex] = s;
  console.log(`${sex}: n=${rows.length}, stature mean=${s.stature.mean}mm`);
}

const js = `// ansur-proportions.js — נוצר אוטומטית על ידי tools/build-ansur-proportions.mjs
// מקור הנתונים: ANSUR II — the 2012 U.S. Army Anthropometric Survey
// (Gordon et al., Natick/TR-15/007; נתונים ציבוריים, 93 מדידות, 6,068 נבדקים).
// כל הערכים במילימטרים; mean / p5 / p50 / p95 לכל מדידה, לפי מין.
// אל תערכו ידנית — הריצו את המחולל מחדש.

export const ANSUR2 = ${JSON.stringify(out, null, 2)};

/** מחזיר אובייקט מדידות (מ"מ) לפי מין ואחוזון ('mean' | 'p5' | 'p50' | 'p95'). */
export function ansurMeasurements(sex = 'male', q = 'mean') {
  const src = ANSUR2[sex];
  const m = {};
  for (const [k, v] of Object.entries(src)) if (typeof v === 'object') m[k] = v[q];
  return m;
}
`;
writeFileSync(new URL('../src/data/ansur-proportions.js', import.meta.url), js);
console.log('written: src/data/ansur-proportions.js');
