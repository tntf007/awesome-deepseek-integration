// retarget.js — המתמטיקה שממירה נקודות ציון ממצלמה לרוטציות עצמות.
// MediaPipe Pose מחזיר 33 נקודות (x ימינה, y למטה, z לעומק); כאן הן
// הופכות לכיווני מקטעים בעולם של three.js ומשם לרוטציות מקומיות.

import * as THREE from 'three';

// אינדקסים של MediaPipe Pose Landmarks
export const LM = {
  nose: 0, leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
};

// אילו מקטעים אנחנו מניעים: עצם מנוע ← (נקודת התחלה, נקודת סוף, כיוון מנוחה בעולם)
// הדמות מוצגת במראה: שמאל הצופה = צד L של הדמות.
const SEGMENT_RULES = [
  { bone: 'upperArmL', from: 'leftShoulder', to: 'leftElbow', rest: [1, 0, 0] },
  { bone: 'lowerArmL', from: 'leftElbow', to: 'leftWrist', rest: [1, 0, 0] },
  { bone: 'upperArmR', from: 'rightShoulder', to: 'rightElbow', rest: [-1, 0, 0] },
  { bone: 'lowerArmR', from: 'rightElbow', to: 'rightWrist', rest: [-1, 0, 0] },
  { bone: 'upperLegL', from: 'leftHip', to: 'leftKnee', rest: [0, -1, 0] },
  { bone: 'lowerLegL', from: 'leftKnee', to: 'leftAnkle', rest: [0, -1, 0] },
  { bone: 'upperLegR', from: 'rightHip', to: 'rightKnee', rest: [0, -1, 0] },
  { bone: 'lowerLegR', from: 'rightKnee', to: 'rightAnkle', rest: [0, -1, 0] },
];

const _v1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

/** ממיר נקודת MediaPipe (מנורמלת) לווקטור עולם של three.js, במראה. */
export function lmToWorld(lm) {
  return new THREE.Vector3(-(lm.x - 0.5) * 2, -(lm.y - 0.5) * 2, -lm.z);
}

/**
 * מכוון עצם כך שציר המנוחה שלה (בעולם) יצביע בכיוון היעד.
 * הרוטציה מחושבת בעולם ומומרת למרחב המקומי של ההורה.
 */
export function aimBoneWorld(bone, restDirWorld, targetDirWorld) {
  _q1.setFromUnitVectors(restDirWorld, targetDirWorld); // רוטציית העולם הרצויה
  bone.parent.getWorldQuaternion(_q2);                   // המרה למרחב המקומי של ההורה
  bone.quaternion.copy(_q2.clone().invert().multiply(_q1));
}

/**
 * מחיל פריים של נקודות Pose על השלד.
 * @param landmarks מערך 33 נקודות {x,y,z,visibility}
 * @param skeleton השלד מ-createSkeleton
 * @param filterBank LandmarkFilterBank אופציונלי לייצוב
 * @param tSec זמן בשניות (לפילטרים)
 * @param blend 0..1 — עוצמת ההחלה (למיזוג עם אנימציית סרק)
 */
export function applyPoseFrame(landmarks, skeleton, filterBank, tSec, blend = 1) {
  if (!landmarks || landmarks.length < 33) return;

  const pt = (key) => {
    const lm = landmarks[LM[key]];
    if (filterBank) {
      const f = filterBank.filter(key, lm.x, lm.y, lm.z, tSec);
      return lmToWorld(f);
    }
    return lmToWorld(lm);
  };

  // סיבוב פלג גוף עליון מתוך קו הכתפיים
  const shL = pt('leftShoulder'), shR = pt('rightShoulder');
  const hipL = pt('leftHip'), hipR = pt('rightHip');
  const shoulderDir = _v1.copy(shL).sub(shR).normalize();
  const chest = skeleton.bones.get('upperChest');
  _q1.setFromUnitVectors(new THREE.Vector3(1, 0, 0), shoulderDir);
  chest.quaternion.slerp(_q1, 0.35 * blend);

  // ראש מתוך אוזניים ואף
  const earL = pt('leftEar'), earR = pt('rightEar'), nose = pt('nose');
  const head = skeleton.bones.get('head');
  const headRight = _v1.copy(earL).sub(earR).normalize();
  const earMid = earL.clone().add(earR).multiplyScalar(0.5);
  const headFwd = nose.clone().sub(earMid).normalize();
  const headUp = new THREE.Vector3().crossVectors(headFwd, headRight).normalize();
  const m = new THREE.Matrix4().makeBasis(headRight, headUp, new THREE.Vector3().crossVectors(headRight, headUp));
  _q1.setFromRotationMatrix(m);
  head.quaternion.slerp(_q1, 0.5 * blend);

  // גפיים
  const pts = {
    leftShoulder: shL, rightShoulder: shR, leftHip: hipL, rightHip: hipR,
    leftElbow: pt('leftElbow'), rightElbow: pt('rightElbow'),
    leftWrist: pt('leftWrist'), rightWrist: pt('rightWrist'),
    leftKnee: pt('leftKnee'), rightKnee: pt('rightKnee'),
    leftAnkle: pt('leftAnkle'), rightAnkle: pt('rightAnkle'),
  };

  for (const rule of SEGMENT_RULES) {
    const bone = skeleton.bones.get(rule.bone);
    const a = pts[rule.from], b = pts[rule.to];
    const vis = landmarks[LM[rule.from]].visibility ?? 1;
    if (vis < 0.4) continue; // נקודה מוסתרת — לא נוגעים
    const dir = _v1.copy(b).sub(a).normalize();
    const rest = new THREE.Vector3(...rule.rest);
    // עולם→מקומי של ההורה
    bone.parent.getWorldQuaternion(_q2);
    const qWorld = new THREE.Quaternion().setFromUnitVectors(rest, dir);
    const qLocal = _q2.clone().invert().multiply(qWorld);
    bone.quaternion.slerp(qLocal, 0.6 * blend);
  }
}

/** בלנדשייפים של הפנים (MediaPipe) → פרמטרי הבעה פשוטים. */
export function faceBlendshapesToParams(categories) {
  const get = (n) => categories.find((c) => c.categoryName === n)?.score ?? 0;
  return {
    jawOpen: get('jawOpen'),
    smile: (get('mouthSmileLeft') + get('mouthSmileRight')) / 2,
    browUp: (get('browOuterUpLeft') + get('browOuterUpRight')) / 2,
    eyeBlinkL: get('eyeBlinkLeft'),
    eyeBlinkR: get('eyeBlinkRight'),
  };
}
