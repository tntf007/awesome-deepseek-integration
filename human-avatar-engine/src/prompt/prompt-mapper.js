// prompt-mapper.js — פרומפט → פרמטרי גוף.
// שני מסלולים:
//   1. parsePrompt — לקסיקון עברית/אנגלית + חילוץ מספרים, רץ מקומית בלי רשת.
//   2. createLLMMapper — חיבור למודל שפה (DeepSeek / Claude) שמחזיר JSON
//      לפי הסכמה, בשביל תיאורים חופשיים ("לוחם ויקינגי רחב וכבד").

import { defaultBodyParams, clampBodyParams } from '../formulas/proportions.js';

// [regex, שינוי]
const RULES = [
  [/גבוה מאוד|very tall/i, { height: +0.18 }],
  [/גבוה|tall/i, { height: +0.10 }],
  [/נמוך מאוד|very short/i, { height: -0.18 }],
  [/נמוך|short/i, { height: -0.10 }],
  [/שרירי מאוד|bodybuilder|מפותח/i, { muscle: +0.9, shoulderWidth: +0.25 }],
  [/שרירי|muscular|אתלטי|athletic/i, { muscle: +0.55, shoulderWidth: +0.12 }],
  [/רזה מאוד|צנום|skinny/i, { muscle: -0.5, weight: -0.7 }],
  [/רזה|דק|thin|slim/i, { weight: -0.4 }],
  [/מלא מאוד|heavy|כבד/i, { weight: +0.7 }],
  [/מלא|עגלגל|chubby/i, { weight: +0.4 }],
  [/כתפיים רחבות|broad shoulders|רחב/i, { shoulderWidth: +0.2 }],
  [/כתפיים צרות|narrow/i, { shoulderWidth: -0.15 }],
  [/ידיים ארוכות|long arms/i, { armLength: +0.12 }],
  [/ידיים קצרות|short arms/i, { armLength: -0.1 }],
  [/רגליים ארוכות|long legs/i, { legLength: +0.12 }],
  [/רגליים קצרות|short legs/i, { legLength: -0.1 }],
  [/ראש גדול|big head/i, { headScale: +0.18 }],
  [/ראש קטן|small head/i, { headScale: -0.12 }],
  [/ילד|child/i, { height: -0.4, headScale: +0.25, muscle: -0.4 }],
  [/ענק|giant/i, { height: +0.4, shoulderWidth: +0.2 }],
];

/**
 * מפרש פרומפט טקסטואלי לפרמטרי גוף. דטרמיניסטי, רץ מקומית.
 * @param {string} text הפרומפט
 * @param {object} base פרמטרים קיימים לעדכון (ברירת מחדל: דמות ייחוס)
 */
export function parsePrompt(text, base = defaultBodyParams()) {
  const p = { ...base };

  // גובה מפורש: "180 ס"מ", "1.82 מטר", "182cm"
  const cm = text.match(/(\d{3})\s*(?:ס"?מ|cm)/i);
  const meters = text.match(/([12][.,]\d{1,2})\s*(?:מטר|m\b)/i);
  let explicitHeight = false;
  if (cm) { p.height = parseInt(cm[1], 10) / 100; explicitHeight = true; }
  else if (meters) { p.height = parseFloat(meters[1].replace(',', '.')); explicitHeight = true; }

  for (const [re, delta] of RULES) {
    if (!re.test(text)) continue;
    for (const [k, dv] of Object.entries(delta)) {
      if (k === 'height' && explicitHeight) continue; // גובה מפורש גובר על מילות מפתח
      p[k] = (p[k] ?? 0) + dv;
    }
  }
  return clampBodyParams(p);
}

/** הסכמה שמודל השפה מתבקש להחזיר — משמשת גם לוולידציה. */
export const BODY_PARAMS_SCHEMA = {
  type: 'object',
  properties: {
    height: { type: 'number', minimum: 1.2, maximum: 2.3, description: 'גובה במטרים' },
    headScale: { type: 'number', minimum: 0.75, maximum: 1.35 },
    shoulderWidth: { type: 'number', minimum: 0.7, maximum: 1.5 },
    armLength: { type: 'number', minimum: 0.8, maximum: 1.25 },
    legLength: { type: 'number', minimum: 0.8, maximum: 1.25 },
    torsoLength: { type: 'number', minimum: 0.85, maximum: 1.2 },
    muscle: { type: 'number', minimum: -1, maximum: 1 },
    weight: { type: 'number', minimum: -1, maximum: 1 },
  },
};

/**
 * יוצר ממפה מבוסס LLM. מקבל פונקציה callModel(systemPrompt, userPrompt)
 * שמחזירה טקסט — כך אפשר לחבר DeepSeek, Claude או כל מודל אחר בלי
 * שהמנוע יכיר ספק מסוים.
 *
 * דוגמה (DeepSeek):
 *   const mapper = createLLMMapper(async (sys, usr) => {
 *     const r = await fetch('https://api.deepseek.com/chat/completions', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
 *       body: JSON.stringify({ model: 'deepseek-chat', messages: [
 *         { role: 'system', content: sys }, { role: 'user', content: usr }] }),
 *     });
 *     return (await r.json()).choices[0].message.content;
 *   });
 */
export function createLLMMapper(callModel) {
  const system = [
    'אתה ממיר תיאור דמות לפרמטרי גוף. החזר JSON בלבד, בלי טקסט נוסף,',
    'לפי הסכמה הזו (ערכים יחסיים, 1.0 = ממוצע):',
    JSON.stringify(BODY_PARAMS_SCHEMA.properties),
  ].join('\n');

  return async function mapPrompt(text) {
    const raw = await callModel(system, text);
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonText) throw new Error('model did not return JSON');
    const parsed = JSON.parse(jsonText);
    return clampBodyParams({ ...defaultBodyParams(), ...parsed });
  };
}
