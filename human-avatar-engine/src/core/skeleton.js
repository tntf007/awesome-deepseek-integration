// skeleton.js — הליבה: שלד אנושי תלת־ממדי
// היררכיית עצמות סטנדרטית (תואמת שמות VRM-humanoid), פרופורציות לפי קאנון 8 הראשים.
// כל ההיסטים במטרים, מכוילים לדמות בגובה 1.75m ומוכפלים לפי params.height.

import * as THREE from 'three';

export const REFERENCE_HEIGHT = 1.75;

// [שם, הורה, x, y, z] — היסט מקומי מההורה. צד שמאל/ימין במראה (ציר X חיובי = שמאל הדמות).
export const BONE_DEFS = [
  ['hips',        null,         0.000,  0.950,  0.000],
  ['spine',       'hips',       0.000,  0.100,  0.000],
  ['chest',       'spine',      0.000,  0.140,  0.000],
  ['upperChest',  'chest',      0.000,  0.120,  0.000],
  ['neck',        'upperChest', 0.000,  0.130,  0.000],
  ['head',        'neck',       0.000,  0.090,  0.000],
  ['headTop',     'head',       0.000,  0.220,  0.000],

  ['shoulderL',   'upperChest', 0.045,  0.100,  0.000],
  ['upperArmL',   'shoulderL',  0.130,  0.000,  0.000],
  ['lowerArmL',   'upperArmL',  0.265,  0.000,  0.000],
  ['handL',       'lowerArmL',  0.250,  0.000,  0.000],
  ['handTipL',    'handL',      0.095,  0.000,  0.000],

  ['shoulderR',   'upperChest', -0.045, 0.100,  0.000],
  ['upperArmR',   'shoulderR',  -0.130, 0.000,  0.000],
  ['lowerArmR',   'upperArmR',  -0.265, 0.000,  0.000],
  ['handR',       'lowerArmR',  -0.250, 0.000,  0.000],
  ['handTipR',    'handR',      -0.095, 0.000,  0.000],

  ['upperLegL',   'hips',       0.090, -0.060,  0.000],
  ['lowerLegL',   'upperLegL',  0.000, -0.420,  0.000],
  ['footL',       'lowerLegL',  0.000, -0.400,  0.000],
  ['toesL',       'footL',      0.000, -0.070,  0.130],

  ['upperLegR',   'hips',       -0.090, -0.060, 0.000],
  ['lowerLegR',   'upperLegR',  0.000, -0.420,  0.000],
  ['footR',       'lowerLegR',  0.000, -0.400,  0.000],
  ['toesR',       'footR',      0.000, -0.070,  0.130],
];

/**
 * בונה שלד: היררכיית THREE.Bone אמיתית.
 * מחזיר { root, bones: Map<name,Bone>, restOffsets: Map<name,Vector3>, height }.
 */
export function createSkeleton({ height = REFERENCE_HEIGHT } = {}) {
  const s = height / REFERENCE_HEIGHT;
  const bones = new Map();
  const restOffsets = new Map();
  let root = null;

  for (const [name, parentName, x, y, z] of BONE_DEFS) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x * s, y * s, z * s);
    restOffsets.set(name, bone.position.clone());
    bones.set(name, bone);
    if (parentName) {
      bones.get(parentName).add(bone);
    } else {
      root = bone;
    }
  }
  return { root, bones, restOffsets, height };
}

/** מאפס את השלד לתנוחת המנוחה (T-pose). */
export function resetToRestPose(skeleton) {
  for (const [name, bone] of skeleton.bones) {
    bone.position.copy(skeleton.restOffsets.get(name));
    bone.quaternion.identity();
    bone.scale.setScalar(1);
  }
}

/**
 * שכבה 1 — ויזואליזציית השלד עצמו: מפרקים (כדורים) + עצמות (גלילים מחודדים).
 * כל mesh מוצמד לעצם ההורה שלו ולכן עוקב אחרי האנימציה אוטומטית.
 * מחזיר { group, segments } — segments לשימוש חוזר בשכבת הגוף.
 */
export function createSkeletonView(skeleton, {
  jointColor = 0x9ad7ff,
  boneColor = 0xdfe9f5,
  emissive = 0x16334d,
} = {}) {
  const group = new THREE.Group();
  group.name = 'skeleton-view';
  const jointMat = new THREE.MeshStandardMaterial({ color: jointColor, emissive, roughness: 0.35 });
  const boneMat = new THREE.MeshStandardMaterial({ color: boneColor, roughness: 0.55 });
  const segments = [];

  for (const [name, bone] of skeleton.bones) {
    // מפרק
    const jr = name === 'head' ? 0.028 : name.startsWith('hand') || name.startsWith('toes') ? 0.012 : 0.02;
    const joint = new THREE.Mesh(new THREE.SphereGeometry(jr, 14, 10), jointMat);
    joint.name = `joint:${name}`;
    bone.add(joint);

    // עצם: מההורה אל העצם הזו
    const parent = bone.parent;
    if (parent && parent.isBone) {
      const off = skeleton.restOffsets.get(name);
      const len = off.length();
      if (len > 0.02) {
        const geo = new THREE.CylinderGeometry(0.008, 0.016, len, 8);
        geo.translate(0, len / 2, 0); // הבסיס בראשית — מצביע מההורה החוצה
        const seg = new THREE.Mesh(geo, boneMat);
        seg.name = `bone:${parent.name}->${name}`;
        seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), off.clone().normalize());
        parent.add(seg);
        segments.push({ parentBone: parent, childName: name, length: len, mesh: seg });
      }
    }
  }
  return { group, segments };
}
