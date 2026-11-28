// proportions.js — נוסחאות פרופורציה: יחס הזהב, קאנון 8 הראשים, האדם הוויטרובי.
// ממיר פרמטרים סמנטיים (גובה, רוחב כתפיים, שריר, משקל...) לשינויים
// גיאומטריים על השלד: מיקומי עצמות (אורכים) וסקאלות נפח לשכבת הגוף.

export const PHI = (1 + Math.sqrt(5)) / 2; // 1.618... יחס הזהב

/** פרמטרי ברירת מחדל של גוף — הכול יחסי ל-1.0 = דמות ייחוס. */
export function defaultBodyParams() {
  return {
    height: 1.75,      // מטרים
    headScale: 1.0,
    shoulderWidth: 1.0,
    armLength: 1.0,
    legLength: 1.0,
    torsoLength: 1.0,
    muscle: 0.0,       // -1 (רזה מאוד) .. +1 (שרירי מאוד)
    weight: 0.0,       // -1 (צנום) .. +1 (מלא)
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function clampBodyParams(p) {
  return {
    height: clamp(p.height ?? 1.75, 1.2, 2.3),
    headScale: clamp(p.headScale ?? 1, 0.75, 1.35),
    shoulderWidth: clamp(p.shoulderWidth ?? 1, 0.7, 1.5),
    armLength: clamp(p.armLength ?? 1, 0.8, 1.25),
    legLength: clamp(p.legLength ?? 1, 0.8, 1.25),
    torsoLength: clamp(p.torsoLength ?? 1, 0.85, 1.2),
    muscle: clamp(p.muscle ?? 0, -1, 1),
    weight: clamp(p.weight ?? 0, -1, 1),
  };
}

// לאיזו קטגוריית אורך שייכת כל עצם
const LENGTH_CATEGORY = {
  spine: 'torso', chest: 'torso', upperChest: 'torso', neck: 'torso',
  headTop: 'head',
  upperArmL: 'arm', lowerArmL: 'arm', handL: 'arm', handTipL: 'arm',
  upperArmR: 'arm', lowerArmR: 'arm', handR: 'arm', handTipR: 'arm',
  shoulderL: 'shoulder', shoulderR: 'shoulder',
  upperLegL: 'legRoot', lowerLegL: 'leg', footL: 'leg',
  upperLegR: 'legRoot', lowerLegR: 'leg', footR: 'leg',
};

/**
 * מחיל פרמטרים על שלד: מזיז עצמות (שינוי אורך אמיתי, לא מתיחת סקאלה
 * שמעוותת ילדים) ומעדכן את גובה האגן כך שהרגליים יישארו על הרצפה.
 */
export function applyProportions(skeleton, rawParams) {
  const p = clampBodyParams(rawParams);
  const s = p.height / 1.75;

  for (const [name, bone] of skeleton.bones) {
    const rest = skeleton.restOffsets.get(name).clone().multiplyScalar(s);
    const cat = LENGTH_CATEGORY[name];
    if (cat === 'torso') rest.multiplyScalar(p.torsoLength);
    else if (cat === 'arm') rest.multiplyScalar(p.armLength);
    else if (cat === 'leg') rest.multiplyScalar(p.legLength);
    else if (cat === 'shoulder') rest.x *= p.shoulderWidth;
    else if (cat === 'legRoot') { rest.x *= 0.9 + 0.1 * p.shoulderWidth; rest.multiplyScalar(p.legLength); }
    bone.position.copy(rest);
    if (name === 'head') bone.scale.setScalar(p.headScale);
  }

  // גובה אגן = סכום שרשרת הרגל כלפי מטה, כדי שכפות הרגליים יישבו על y≈0
  const legDrop = legChainDrop(skeleton);
  skeleton.bones.get('hips').position.y = legDrop;
  return p;
}

function legChainDrop(skeleton) {
  let y = 0;
  for (const n of ['upperLegL', 'lowerLegL', 'footL']) y -= skeleton.bones.get(n).position.y;
  return y + 0.04; // גובה כף הרגל מהקרקע
}

/**
 * סקאלות נפח לשכבת הגוף לפי שריר/משקל — יחס הזהב קובע את חלוקת
 * ההשפעה בין פלג גוף עליון לתחתון (שריר משפיע פי φ על החזה/זרועות).
 */
export function volumeScales(rawParams) {
  const p = clampBodyParams(rawParams);
  const m = p.muscle, w = p.weight;
  const upper = 1 + 0.22 * m * (PHI - 1) * PHI + 0.18 * w; // חזה, כתפיים, זרועות
  const core = 1 + 0.10 * m + 0.30 * w;                     // בטן, אגן
  const lower = 1 + 0.22 * m * (PHI - 1) + 0.16 * w;        // רגליים
  const neckHead = 1 + 0.06 * m + 0.06 * w;
  return { upper, core, lower, neckHead };
}
