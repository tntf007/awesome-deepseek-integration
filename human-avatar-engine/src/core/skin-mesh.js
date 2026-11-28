// skin-mesh.js — שלב 1 במפת הדרכים: מש גוף רציף עם עור.
// במקום קפסולות נפרדות: משטח אחד רציף שנוצר משדה מרחק חתום (SDF) של כל
// מקטעי הגוף עם מיזוג חלק (smooth-min) במפרקים, מחולץ ברשת Surface Nets,
// ואז כל קודקוד מקבל משקולות עור אמיתיות (skinIndices/skinWeights) —
// THREE.SkinnedMesh שמתעוות עם השלד ב-GPU כמו בכל מנוע משחק.

import * as THREE from 'three';
import { SEGMENTS } from './body-layer.js';
import { volumeScales } from '../formulas/proportions.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3();

/** מרחק נקודה ממקטע ab, והפרמטר t לאורך המקטע. */
function segDistance(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return { d: Math.sqrt(dx * dx + dy * dy + dz * dz), t };
}

/** מיזוג חלק של שני מרחקים — העור מתמזג במפרקים במקום להתקפל. */
function smin(a, b, k) {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b * (1 - h) + a * h - k * h * (1 - h);
}

/** אוסף את מקטעי הקפסולות במרחב המודל, בתנוחת המנוחה הנוכחית. */
function collectSegments(skeleton, params) {
  const vs = volumeScales(params ?? {});
  const segs = [];
  for (const [parentName, childName, rTop, rBottom, group] of SEGMENTS) {
    const parent = skeleton.bones.get(parentName);
    const child = skeleton.bones.get(childName);
    if (!parent || !child) continue;
    parent.getWorldPosition(_a);
    child.getWorldPosition(_b);
    const r = ((rTop + rBottom) / 2) * (vs[group] ?? 1);
    segs.push({
      ax: _a.x, ay: _a.y, az: _a.z, bx: _b.x, by: _b.y, bz: _b.z,
      r, boneA: parent, boneB: child, name: `${parentName}->${childName}`,
    });
  }
  return segs;
}

/**
 * בונה גיאומטריית עור רציפה + משקולות עור.
 * cell — גודל תא הדגימה במטרים (קטן יותר = חלק יותר, איטי יותר).
 */
function buildSkinGeometry(skeleton, params, { cell = 0.02, blend = 0.045 } = {}) {
  const segs = collectSegments(skeleton, params);

  // תחום הדגימה
  const bb = new THREE.Box3();
  for (const s of segs) {
    bb.expandByPoint(_p.set(s.ax, s.ay, s.az));
    bb.expandByPoint(_p.set(s.bx, s.by, s.bz));
  }
  const margin = 0.14;
  bb.min.subScalar(margin); bb.max.addScalar(margin);
  const nx = Math.ceil((bb.max.x - bb.min.x) / cell);
  const ny = Math.ceil((bb.max.y - bb.min.y) / cell);
  const nz = Math.ceil((bb.max.z - bb.min.z) / cell);
  const field = new Float32Array(nx * ny * nz).fill(1e9);
  const fi = (x, y, z) => x + nx * (y + ny * z);

  // מילוי השדה: כל מקטע כותב רק בתיבה שסביבו (מהיר בהרבה מסריקה מלאה)
  for (const s of segs) {
    const pad = s.r + blend + 2 * cell;
    const x0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - pad - bb.min.x) / cell));
    const x1 = Math.min(nx - 1, Math.ceil((Math.max(s.ax, s.bx) + pad - bb.min.x) / cell));
    const y0 = Math.max(0, Math.floor((Math.min(s.ay, s.by) - pad - bb.min.y) / cell));
    const y1 = Math.min(ny - 1, Math.ceil((Math.max(s.ay, s.by) + pad - bb.min.y) / cell));
    const z0 = Math.max(0, Math.floor((Math.min(s.az, s.bz) - pad - bb.min.z) / cell));
    const z1 = Math.min(nz - 1, Math.ceil((Math.max(s.az, s.bz) + pad - bb.min.z) / cell));
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = bb.min.x + x * cell, py = bb.min.y + y * cell, pz = bb.min.z + z * cell;
      const { d } = segDistance(px, py, pz, s.ax, s.ay, s.az, s.bx, s.by, s.bz);
      const idx = fi(x, y, z);
      const v = d - s.r;
      field[idx] = field[idx] > 1e8 ? v : smin(field[idx], v, blend);
    }
  }

  // Surface Nets: קודקוד לכל תא חוצה-אפס, במיקום ממוצע חציות הצלעות
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const ci = (x, y, z) => x + (nx - 1) * (y + (ny - 1) * z);
  const positions = [];
  const EDGES = [
    [0,0,0, 1,0,0], [0,0,0, 0,1,0], [0,0,0, 0,0,1],
    [1,0,0, 1,1,0], [1,0,0, 1,0,1], [0,1,0, 1,1,0], [0,1,0, 0,1,1],
    [0,0,1, 1,0,1], [0,0,1, 0,1,1], [1,1,0, 1,1,1], [1,0,1, 1,1,1], [0,1,1, 1,1,1],
  ];
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [x0, y0, z0, x1, y1, z1] of EDGES) {
      const v0 = field[fi(x + x0, y + y0, z + z0)];
      const v1 = field[fi(x + x1, y + y1, z + z1)];
      if ((v0 < 0) === (v1 < 0) || v0 > 1e8 || v1 > 1e8) continue;
      const t = v0 / (v0 - v1);
      sx += x + x0 + (x1 - x0) * t;
      sy += y + y0 + (y1 - y0) * t;
      sz += z + z0 + (z1 - z0) * t;
      n++;
    }
    if (n > 0) {
      cellVert[ci(x, y, z)] = positions.length / 3;
      positions.push(bb.min.x + (sx / n) * cell, bb.min.y + (sy / n) * cell, bb.min.z + (sz / n) * cell);
    }
  }

  // חיבור: לכל צלע פרימלית חוצה-אפס, ריבוע בין 4 התאים שחולקים אותה
  const indices = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c); else indices.push(a, b, c, a, c, d);
  };
  for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const v0 = field[fi(x, y, z)];
    if (v0 > 1e8) continue;
    const inside = v0 < 0;
    // צלע X
    let v1 = field[fi(x + 1, y, z)];
    if (v1 < 1e8 && (v1 < 0) !== inside) {
      quad(cellVert[ci(x, y - 1, z - 1)], cellVert[ci(x, y, z - 1)], cellVert[ci(x, y, z)], cellVert[ci(x, y - 1, z)], inside);
    }
    // צלע Y
    v1 = field[fi(x, y + 1, z)];
    if (v1 < 1e8 && (v1 < 0) !== inside) {
      quad(cellVert[ci(x - 1, y, z - 1)], cellVert[ci(x - 1, y, z)], cellVert[ci(x, y, z)], cellVert[ci(x, y, z - 1)], inside);
    }
    // צלע Z
    v1 = field[fi(x, y, z + 1)];
    if (v1 < 1e8 && (v1 < 0) !== inside) {
      quad(cellVert[ci(x - 1, y - 1, z)], cellVert[ci(x, y - 1, z)], cellVert[ci(x, y, z)], cellVert[ci(x - 1, y, z)], inside);
    }
  }

  // משקולות עור: לכל קודקוד — שני המקטעים הקרובים, משקל לפי קרבה,
  // והמשקל של כל מקטע מתפצל בין עצם ההורה לעצם הילד לפי המיקום לאורכו.
  const vCount = positions.length / 3;
  const skinIndex = new Uint16Array(vCount * 4);
  const skinWeight = new Float32Array(vCount * 4);
  const bones = [...skeleton.bones.values()];
  const boneIdx = new Map(bones.map((b, i) => [b, i]));

  for (let v = 0; v < vCount; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    let best = null, second = null;
    for (const s of segs) {
      const { d, t } = segDistance(px, py, pz, s.ax, s.ay, s.az, s.bx, s.by, s.bz);
      const score = d - s.r;
      const e = { score, t, s };
      if (!best || score < best.score) { second = best; best = e; }
      else if (!second || score < second.score) second = e;
    }
    const w1 = second ? Math.max(1e-4, second.score - best.score) : 1;
    const w2 = second ? Math.max(0, (best.s.r + 0.02) - (second.score - best.score)) * 0.5 : 0;
    const entries = [];
    const push = (e, w) => {
      if (!e || w <= 0) return;
      // פיצול לאורך המקטע: קרוב להתחלה — הורה; קרוב לסוף — ילד
      const tt = Math.max(0, Math.min(1, (e.t - 0.3) / 0.7));
      entries.push([boneIdx.get(e.s.boneA), w * (1 - tt)], [boneIdx.get(e.s.boneB), w * tt]);
    };
    push(best, w1); push(second, w2);
    entries.sort((a, b) => b[1] - a[1]);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += entries[k]?.[1] ?? 0;
    for (let k = 0; k < 4; k++) {
      skinIndex[v * 4 + k] = entries[k]?.[0] ?? 0;
      skinWeight[v * 4 + k] = sum > 0 ? (entries[k]?.[1] ?? 0) / sum : (k === 0 ? 1 : 0);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * יוצר עור רציף על השלד. מחזיר { mesh, rebuild, setOpacity, setVisible }.
 * הבנייה נעשית בתנוחת מנוחה (הרוטציות מתאפסות רגעית) כדי שה-bind יהיה נקי.
 */
export function createSkinMesh(skeleton, {
  params = {},
  color = 0xd9b8a0,
  opacity = 1.0,
  cell = 0.016,
} = {}) {
  const material = new THREE.MeshStandardMaterial({
    color, roughness: 0.62, metalness: 0,
    transparent: opacity < 1, opacity,
  });
  let mesh = null;

  function rebuild(newParams = params) {
    params = newParams;
    // איפוס רגעי לתנוחת מנוחה (שומרים ומחזירים את הרוטציות)
    const saved = [];
    for (const [, b] of skeleton.bones) { saved.push([b, b.quaternion.clone()]); b.quaternion.identity(); }
    skeleton.root.updateMatrixWorld(true);

    const geo = buildSkinGeometry(skeleton, params, { cell });
    const bones = [...skeleton.bones.values()];
    const old = mesh;
    mesh = new THREE.SkinnedMesh(geo, material);
    mesh.name = 'skin';
    mesh.frustumCulled = false;
    mesh.bind(new THREE.Skeleton(bones), new THREE.Matrix4());

    for (const [b, q] of saved) b.quaternion.copy(q);
    skeleton.root.updateMatrixWorld(true);

    if (old) { old.removeFromParent(); old.geometry.dispose(); }
    return mesh;
  }

  return {
    get mesh() { return mesh; },
    rebuild,
    setOpacity(v) { material.opacity = v; material.transparent = v < 1; material.visible = v > 0.02; },
    setColor(hex) { material.color.set(hex); },
    setVisible(v) { if (mesh) mesh.visible = v; },
    dispose() { if (mesh) { mesh.removeFromParent(); mesh.geometry.dispose(); } },
  };
}
