// anthropometry.js — כיול השלד ממדידות גוף אמיתיות (ANSUR II).
// ממיר מדידות אנתרופומטריות (מ"מ, כמו שנמדדו על בני אדם אמיתיים) להיסטי
// עצמות של הריג: גבהים מהרצפה → אורכי מקטעים, רוחב כתפיים/אגן → היסטי X.

import { REFERENCE_HEIGHT } from './skeleton.js';

const mm = (v) => v / 1000;

/**
 * בונה טבלת היסטים (בשמות עצמות הריג) מתוך אובייקט מדידות ANSUR.
 * ההיסטים מנורמלים ל-REFERENCE_HEIGHT כך ש-applyProportions עם
 * height = stature האמיתי משחזר את המידות המקוריות במדויק.
 * מחזיר { offsets: Map<name,[x,y,z]>, stature } (מטרים).
 */
export function offsetsFromMeasurements(m) {
  const stature = mm(m.stature);
  const hipY = mm(m.trochanterionheight);
  const kneeY = mm(m.kneeheightmidpatella);
  const ankleY = mm(m.lateralmalleolusheight);
  const shoulderY = mm(m.acromialheight);
  const c7Y = mm(m.cervicaleheight);
  const headH = mm(m.tragiontopofhead);
  const headBaseY = stature - headH;          // בסיס הגולגולת ≈ גובה הטרגיון
  const neckLen = Math.max(0.04, headBaseY - c7Y);

  const halfShoulder = mm(m.biacromialbreadth) / 2;
  const halfHip = (m.hipbreadth ? mm(m.hipbreadth) : halfShoulder * 0.8) * 0.5 * 0.62; // מרכזי מפרקי ירך ~62% מרוחב האגן
  const upperArm = mm(m.acromionradialelength);
  const forearm = mm(m.radialestylionlength);
  const hand = mm(m.handlength);
  const foot = mm(m.footlength);

  // פלג גוף עליון: מתפלג בין האגן ל-C7 ביחסים קבועים
  const torso = c7Y - hipY;
  const spineL = torso * 0.22, chestL = torso * 0.30, upperChestL = torso * 0.26;
  const chestTopToShoulder = shoulderY - (hipY + spineL + chestL + upperChestL); // גובה הכתף מעל upperChest

  const o = new Map();
  const set = (n, x, y, z) => o.set(n, [x, y, z]);

  set('hips', 0, hipY, 0);
  set('spine', 0, spineL, 0);
  set('chest', 0, chestL, 0);
  set('upperChest', 0, upperChestL, 0);
  set('neck', 0, (c7Y - hipY) - spineL - chestL - upperChestL, 0); // משלים עד C7
  set('head', 0, neckLen, 0);
  set('headTop', 0, headH, 0);

  for (const [side, sgn] of [['L', 1], ['R', -1]]) {
    set(`shoulder${side}`, sgn * halfShoulder * 0.25, chestTopToShoulder + 0.02, 0);
    set(`upperArm${side}`, sgn * halfShoulder * 0.75, 0, 0);
    set(`lowerArm${side}`, sgn * upperArm, 0, 0);
    set(`hand${side}`, sgn * forearm, 0, 0);
    set(`handTip${side}`, sgn * hand * 0.55, 0, 0);

    set(`upperLeg${side}`, sgn * halfHip, 0, 0);
    set(`lowerLeg${side}`, 0, -(hipY - kneeY), 0);
    set(`foot${side}`, 0, -(kneeY - ankleY), 0);
    set(`toes${side}`, 0, -(ankleY - 0.03), foot * 0.55);
  }

  // נרמול ל-REFERENCE_HEIGHT: applyProportions מכפיל ב-height/REFERENCE
  const k = REFERENCE_HEIGHT / stature;
  for (const [n, v] of o) o.set(n, [v[0] * k, v[1] * k, v[2] * k]);

  return { offsets: o, stature };
}

/**
 * מחיל מדידות אמיתיות על שלד: מחליף את restOffsets של הריג.
 * אחרי הקריאה יש להריץ applyProportions({height: stature, ...}) ולבנות
 * מחדש את שכבות הגוף/האנטומיה.
 */
export function applyAnthropometry(skeleton, measurements) {
  const { offsets, stature } = offsetsFromMeasurements(measurements);
  for (const [name, v] of offsets) {
    const rest = skeleton.restOffsets.get(name);
    if (rest) rest.set(v[0], v[1], v[2]);
  }
  return stature;
}
