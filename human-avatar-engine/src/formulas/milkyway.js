// milkyway.js — נוסחת שביל החלב: ספירלה לוגריתמית r(θ) = r0·e^(θ·tanφ)
// זו הנוסחה שמתארת את זרועות הגלקסיה (זווית פתיחה ~12.5° בשביל החלב).
// כאן היא משמשת כמנוע תנועה ופיזור משקולות: נשימה, גלי תנועה לאורך עמוד
// השדרה, ודעיכת מורפים — תנועה אורגנית במקום סינוסים מכניים.

export const MILKY_WAY = Object.freeze({
  pitchDeg: 12.5,  // זווית הפתיחה של זרועות שביל החלב
  arms: 4,         // ארבע זרועות עיקריות
  r0: 1.0,
});

const rad = (d) => (d * Math.PI) / 180;

/** רדיוס הספירלה הלוגריתמית בזווית θ (רדיאנים). */
export function spiralRadius(theta, { r0 = MILKY_WAY.r0, pitchDeg = MILKY_WAY.pitchDeg } = {}) {
  return r0 * Math.exp(theta * Math.tan(rad(pitchDeg)));
}

/** הזווית שבה הספירלה מגיעה לרדיוס r (ההופכית). */
export function spiralTheta(r, { r0 = MILKY_WAY.r0, pitchDeg = MILKY_WAY.pitchDeg } = {}) {
  return Math.log(r / r0) / Math.tan(rad(pitchDeg));
}

/**
 * משקל זרוע גלקטית: עוצמה בזווית θ עבור מערך של n זרועות.
 * אונות cos² — חלקות, מחזוריות, סכומן קבוע. טווח [0,1].
 */
export function armWeight(theta, arms = MILKY_WAY.arms) {
  return Math.cos((theta * arms) / 2) ** 2;
}

/**
 * פיזור ספירלי לאורך שרשרת (למשל עמוד שדרה בן n חוליות):
 * חוליה i מקבלת פאזה לפי אורך הקשת של הספירלה — האצה אקספוננציאלית
 * עדינה במקום פיזור לינארי. מחזיר מערך פאזות [0..2π).
 */
export function chainPhases(n, { pitchDeg = MILKY_WAY.pitchDeg, turns = 0.75 } = {}) {
  const k = Math.tan(rad(pitchDeg));
  const thetaMax = turns * 2 * Math.PI;
  // אורך קשת של ספירלה לוגריתמית: L(θ) ∝ e^(kθ) — מנרמלים ל-[0,1]
  const L = (t) => (Math.exp(k * t) - 1) / (Math.exp(k * thetaMax) - 1);
  const phases = [];
  for (let i = 0; i < n; i++) phases.push(L((i / Math.max(1, n - 1)) * thetaMax) * 2 * Math.PI);
  return phases;
}

/**
 * עקומת נשימה גלקטית: אוסצילציה איטית שמורכבת משתי זרועות ספירלה
 * בפאזות שונות — נשימה א־סימטרית וחיה. t בשניות, מחזיר [-1,1].
 */
export function breathingCurve(t, { period = 4.2, pitchDeg = MILKY_WAY.pitchDeg } = {}) {
  const w = (2 * Math.PI) / period;
  const k = Math.tan(rad(pitchDeg));
  const a = Math.sin(w * t);
  const b = Math.sin(w * t * (1 + k) + Math.PI / 3); // הזרוע השנייה, מוסטת לפי זווית הפתיחה
  return 0.72 * a + 0.28 * b;
}

/**
 * דעיכה ספירלית לפיזור מורפים: משקל שיורד אקספוננציאלית עם המרחק
 * מהמרכז (כמו צפיפות הכוכבים בדיסקה הגלקטית: Σ(r) = Σ0·e^(−r/h)).
 * d — מרחק מנורמל [0..1], h — אורך סקאלה.
 */
export function discFalloff(d, h = 0.35) {
  return Math.exp(-d / h);
}

/** נקודה (x,z) על זרוע ספירלית — לציור מסלולים ואפקטים סביב הדמות. */
export function spiralPoint(theta, opts) {
  const r = spiralRadius(theta, opts);
  return { x: r * Math.cos(theta), z: r * Math.sin(theta) };
}
