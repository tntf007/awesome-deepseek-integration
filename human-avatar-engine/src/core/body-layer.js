// body-layer.js — שכבה 2: גוף שקוף נפחי מעל השלד.
// קפסולות פיזיקליות (זכוכית/הולוגרמה) מוצמדות לכל מקטע עצם, עם טבלת
// רדיוסים אנטומית. עוקבות אחרי השלד בזמן אמת ומגיבות לפרמטרי שריר/משקל.

import * as THREE from 'three';
import { volumeScales } from '../formulas/proportions.js';

// רדיוס לכל מקטע (מטרים) + קבוצת נפח — משותף גם לשכבת הקפסולות וגם לעור הרציף
export const SEGMENTS = [
  // [parent, child, radiusTop, radiusBottom, group]
  ['hips', 'spine', 0.125, 0.135, 'core'],
  ['spine', 'chest', 0.120, 0.125, 'core'],
  ['chest', 'upperChest', 0.125, 0.120, 'upper'],
  ['upperChest', 'neck', 0.090, 0.115, 'upper'],
  ['neck', 'head', 0.045, 0.050, 'neckHead'],
  ['head', 'headTop', 0.095, 0.075, 'neckHead'],
  ['shoulderL', 'upperArmL', 0.050, 0.055, 'upper'],
  ['upperArmL', 'lowerArmL', 0.042, 0.048, 'upper'],
  ['lowerArmL', 'handL', 0.030, 0.040, 'upper'],
  ['handL', 'handTipL', 0.022, 0.030, 'upper'],
  ['shoulderR', 'upperArmR', 0.050, 0.055, 'upper'],
  ['upperArmR', 'lowerArmR', 0.042, 0.048, 'upper'],
  ['lowerArmR', 'handR', 0.030, 0.040, 'upper'],
  ['handR', 'handTipR', 0.022, 0.030, 'upper'],
  ['upperLegL', 'lowerLegL', 0.055, 0.072, 'lower'],
  ['lowerLegL', 'footL', 0.038, 0.052, 'lower'],
  ['footL', 'toesL', 0.030, 0.035, 'lower'],
  ['upperLegR', 'lowerLegR', 0.055, 0.072, 'lower'],
  ['lowerLegR', 'footR', 0.038, 0.052, 'lower'],
  ['footR', 'toesR', 0.030, 0.035, 'lower'],
];

/**
 * יוצר את שכבת הגוף השקופה מעל שלד קיים.
 * מחזיר API: setOpacity, applyParams (שריר/משקל), setColor, rebuild.
 */
export function createBodyLayer(skeleton, {
  color = 0x66ccff,
  opacity = 0.22,
} = {}) {
  const material = new THREE.MeshPhysicalMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.15,
    metalness: 0.0,
    transmission: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const meshes = []; // { mesh, group, parent, childName }

  function build() {
    for (const { mesh } of meshes) mesh.removeFromParent();
    meshes.length = 0;
    for (const [parentName, childName, rTop, rBottom, group] of SEGMENTS) {
      const parent = skeleton.bones.get(parentName);
      const child = skeleton.bones.get(childName);
      if (!parent || !child) continue;
      const off = child.position.clone();
      const len = off.length();
      if (len < 0.01) continue;
      const geo = new THREE.CylinderGeometry(rTop, rBottom, len, 16, 1, false);
      geo.translate(0, len / 2, 0);
      // כיפות — קירוב קפסולה
      const capT = new THREE.SphereGeometry(rTop, 16, 8);
      capT.translate(0, len, 0);
      const mesh = new THREE.Mesh(geo, material);
      mesh.add(new THREE.Mesh(capT, material));
      mesh.name = `body:${parentName}->${childName}`;
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), off.clone().normalize());
      mesh.renderOrder = 1;
      parent.add(mesh);
      meshes.push({ mesh, group, parentName, childName });
    }
  }
  build();

  return {
    material,
    meshes,
    /** שקיפות השכבה (0 = נעלמת, 1 = אטומה) */
    setOpacity(v) { material.opacity = v; material.visible = v > 0.01; },
    setColor(hex) { material.color.set(hex); },
    /** עדכון נפחים לפי פרמטרי גוף (שריר/משקל) — סקאלה רוחבית בלבד */
    applyParams(params) {
      const vs = volumeScales(params);
      for (const { mesh, group } of meshes) {
        const s = vs[group] ?? 1;
        mesh.scale.set(s, 1, s);
      }
    },
    /** בנייה מחדש אחרי שינוי פרופורציות (אורכי עצמות השתנו) */
    rebuild: build,
    setVisible(v) { for (const { mesh } of meshes) mesh.visible = v; },
  };
}
