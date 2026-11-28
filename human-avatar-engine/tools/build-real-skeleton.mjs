// build-real-skeleton.mjs — בונה שלד אמיתי מ-BodyParts3D.
// מקור: BodyParts3D / Anatomography, © The Database Center for Life Science,
// רישיון CC-BY-SA 2.1 Japan. רשתות פוליגונים של עצמות שסומנו מסריקת MRI
// של גוף אדם אמיתי (מבוגר), קובץ STL לכל עצם, מזוהה ב-FMA ID.
//
// מה הסקריפט עושה:
//   1. קורא ~198 קובצי STL של עצמות השלד.
//   2. מדלל כל רשת (vertex clustering) ושומר על הצורה האנטומית.
//   3. ממיר צירים: Z-up (מ"מ) → Y-up (מטרים), הפנים אל +Z.
//   4. מקבץ לקבוצות לפי עצמות הריג (ראש, חזה, ירך שמאל...).
//   5. מחשב צירי מפרקים אמיתיים מהעצמות (ראש הירך, הברך, הכתף...).
//   6. מסובב את הזרועות מעמידה אנטומית (ידיים למטה) ל-T-pose של הריג.
//   7. מייצא GLB אחד עם userData לעיגון בזמן ריצה.
//
// שימוש: node tools/build-real-skeleton.mjs <stl-dir> <parts_list_e.txt> <out.glb>

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// FileReader polyfill ל-Node (ה-exporter משתמש בו לאריזת GLB)
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    });
  }
};

const [stlDir, partsList, outPath] = process.argv.slice(2);

// ===== 1. שיוך עצם → קבוצת ריג =====
const EXPLICIT = {
  // ראש
  FMA52734: 'head', FMA52788: 'head', FMA52789: 'head', FMA52738: 'head',
  FMA52739: 'head', FMA52735: 'head', FMA52892: 'head', FMA52893: 'head',
  FMA53649: 'head', FMA53650: 'head', FMA53647: 'head', FMA53648: 'head',
  FMA53655: 'head', FMA53656: 'head', FMA53645: 'head', FMA53646: 'head',
  FMA52740: 'head', FMA9710: 'head', FMA52748: 'head',
  // צוואר
  FMA52749: 'neck', FMA12519: 'neck', FMA12520: 'neck', FMA12521: 'neck',
  FMA12522: 'neck', FMA12523: 'neck', FMA12524: 'neck', FMA12525: 'neck',
  // בית חזה: חוליות גב, צלעות, עצם החזה, סחוס
  FMA9165: 'chest', FMA9187: 'chest', FMA9209: 'chest', FMA9248: 'chest',
  FMA9922: 'chest', FMA9945: 'chest', FMA9968: 'chest', FMA9991: 'chest',
  FMA10014: 'chest', FMA10037: 'chest', FMA10059: 'chest', FMA10081: 'chest',
  FMA7486: 'chest', FMA7487: 'chest', FMA7488: 'chest', BP24: 'chest', BP28: 'chest',
  // מותן
  FMA13072: 'spine', FMA13073: 'spine', FMA13074: 'spine', FMA13075: 'spine', FMA13076: 'spine',
  // אגן
  FMA16202: 'hips', FMA16586: 'hips', FMA16587: 'hips',
  // חגורת כתפיים
  FMA13323: 'shoulderL', FMA13396: 'shoulderL', FMA13322: 'shoulderR', FMA13395: 'shoulderR',
  // זרועות
  FMA23131: 'upperArmL', FMA23130: 'upperArmR',
  FMA23465: 'lowerArmL', FMA23468: 'lowerArmL', FMA23464: 'lowerArmR', FMA23467: 'lowerArmR',
  // רגליים
  FMA24475: 'upperLegL', FMA24474: 'upperLegR',
  FMA24478: 'lowerLegL', FMA24481: 'lowerLegL', FMA24487: 'lowerLegL',
  FMA24477: 'lowerLegR', FMA24480: 'lowerLegR', FMA24486: 'lowerLegR',
};
// צלעות — שמאל/ימין לא משנה לקיבוץ (כולן chest)
for (const id of ['FMA7857','FMA7882','FMA7909','FMA7957','FMA8066','FMA8175','FMA8229','FMA8283','FMA8364','FMA8445','FMA8531','FMA8533','FMA7987','FMA8012','FMA8039','FMA8148','FMA8093','FMA8202','FMA8256','FMA8310','FMA8391','FMA8472','FMA8532','FMA8534']) EXPLICIT[id] = 'chest';

const names = new Map();
for (const line of readFileSync(partsList, 'latin1').split(/\r?\n/)) {
  const [id, name] = line.split('\t');
  if (id && name) names.set(id.replace(/"/g, ''), name.trim());
}

function classify(id) {
  if (EXPLICIT[id]) return EXPLICIT[id];
  const n = (names.get(id) ?? '').toLowerCase();
  const side = /\bleft\b/.test(n) ? 'L' : /\bright\b/.test(n) ? 'R' : null;
  if (!side) return null;
  const isHand = /metacarpal|carpal|trapezium|trapezoid|capitate|hamate|scaphoid|lunate|triquetrum|pisiform|finger|thumb/.test(n);
  const isFoot = /metatarsal|tarsal|cuneiform|navicular|cuboid|talus|calcaneus|toe|hallux/.test(n);
  if (isHand) return `hand${side}`;
  if (isFoot) return `foot${side}`;
  return null;
}

// ===== 2. פענוח STL בינארי + דילול =====
function parseStl(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const base = 84 + i * 50 + 12;
    for (let v = 0; v < 9; v++) pos[i * 9 + v] = dv.getFloat32(base + v * 4, true);
  }
  return pos;
}

/** דילול ע"י קיבוץ קודקודים לתאי רשת; משמר צורה, מוריד ~80% מהמשולשים. */
function decimate(pos, cell) {
  const key = (x, y, z) => `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
  const clusters = new Map(); // key -> {sum, count, index}
  const triIdx = new Uint32Array(pos.length / 3);
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const k = key(x, y, z);
    let c = clusters.get(k);
    if (!c) { c = { x: 0, y: 0, z: 0, n: 0, i: clusters.size }; clusters.set(k, c); }
    c.x += x; c.y += y; c.z += z; c.n++;
    triIdx[v] = c.i;
  }
  const verts = new Float32Array(clusters.size * 3);
  for (const c of clusters.values()) {
    verts[c.i * 3] = c.x / c.n; verts[c.i * 3 + 1] = c.y / c.n; verts[c.i * 3 + 2] = c.z / c.n;
  }
  const indices = [];
  for (let t = 0; t < triIdx.length; t += 3) {
    const a = triIdx[t], b = triIdx[t + 1], c = triIdx[t + 2];
    if (a !== b && b !== c && a !== c) indices.push(a, b, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(indices);
  return geo;
}

// ===== 3. המרת צירים: (x,y,z)מ"מ Z-up → (x, z, -y)/1000 מטרים Y-up =====
const AXES = new THREE.Matrix4().set(
  0.001, 0, 0, 0,
  0, 0, 0.001, 0,
  0, -0.001, 0, 0,
  0, 0, 0, 1,
);

// ===== טעינה וקיבוץ =====
const groups = new Map(); // group -> [{id, geo}]
const bboxOf = new Map(); // id -> Box3 (אחרי המרה)
let totalTris = 0;

for (const id of Object.keys(EXPLICIT).concat([...names.keys()])) {
  if (groups.has(`done:${id}`)) continue;
  groups.set(`done:${id}`, true);
  const g = classify(id);
  if (!g) continue;
  const path = join(stlDir, `${id}.stl`);
  if (!existsSync(path)) continue;
  const raw = parseStl(readFileSync(path));
  // גודל תא דילול לפי גודל העצם (במ"מ): עצמות גדולות — תאים גסים יותר
  const tmp = new THREE.Box3();
  for (let v = 0; v < raw.length; v += 3) tmp.expandByPoint(new THREE.Vector3(raw[v], raw[v + 1], raw[v + 2]));
  const diag = tmp.getSize(new THREE.Vector3()).length();
  const cell = Math.min(6, Math.max(2.2, diag / 80));
  const geo = decimate(raw, cell);
  geo.applyMatrix4(AXES);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  bboxOf.set(id, geo.boundingBox.clone());
  totalTris += geo.index.count / 3;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push({ id, geo });
}
console.log(`loaded bones into ${[...groups.keys()].filter((k) => !k.startsWith('done:')).length} groups, ~${Math.round(totalTris / 1000)}K tris`);

// ===== 4. צירי מפרקים אמיתיים (מהעצמות עצמן, במרחב המומר) =====
const center = (b) => b.getCenter(new THREE.Vector3());
const topC = (b) => new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
const botC = (b) => new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
const femL = bboxOf.get('FMA24475'), femR = bboxOf.get('FMA24474');
const tibL = bboxOf.get('FMA24478'), tibR = bboxOf.get('FMA24477');
const humL = bboxOf.get('FMA23131'), humR = bboxOf.get('FMA23130');
const radL = bboxOf.get('FMA23465'), radR = bboxOf.get('FMA23464');

const PIVOTS = {
  hips: topC(femL).add(topC(femR)).multiplyScalar(0.5),
  spine: botC(bboxOf.get('FMA13076')),      // L5
  chest: botC(bboxOf.get('FMA10081')),      // T12
  neck: botC(bboxOf.get('FMA12525')),       // C7
  head: botC(bboxOf.get('FMA52735')),       // עורף
  shoulderL: topC(humL), shoulderR: topC(humR),
  upperArmL: topC(humL), upperArmR: topC(humR),
  lowerArmL: botC(humL), lowerArmR: botC(humR),     // מרפק
  handL: botC(radL), handR: botC(radR),             // שורש כף יד
  upperLegL: topC(femL), upperLegR: topC(femR),
  lowerLegL: botC(femL), lowerLegR: botC(femR),     // ברך
  footL: botC(tibL), footR: botC(tibR),             // קרסול
};

// אורכי מקטעים בנתונים (לסקאלת גפיים בזמן ריצה)
const seg = (a, b) => PIVOTS[a].distanceTo(PIVOTS[b]);
const TIPLEN = {
  upperArmL: seg('upperArmL', 'lowerArmL'), upperArmR: seg('upperArmR', 'lowerArmR'),
  lowerArmL: seg('lowerArmL', 'handL'), lowerArmR: seg('lowerArmR', 'handR'),
  upperLegL: seg('upperLegL', 'lowerLegL'), upperLegR: seg('upperLegR', 'lowerLegR'),
  lowerLegL: seg('lowerLegL', 'footL'), lowerLegR: seg('lowerLegR', 'footR'),
};
// כף יד/רגל: אורך הקבוצה עצמה
const groupLen = (g, axis) => {
  const b = new THREE.Box3();
  for (const { geo } of groups.get(g) ?? []) b.union(geo.boundingBox);
  return b.getSize(new THREE.Vector3())[axis];
};
TIPLEN.handL = groupLen('handL', 'y'); TIPLEN.handR = groupLen('handR', 'y');
TIPLEN.footL = groupLen('footL', 'z'); TIPLEN.footR = groupLen('footR', 'z');

// קומת הדגימה (לסקאלת הגוף המרכזי)
const DATA_STATURE = (() => {
  let maxY = 0;
  for (const b of bboxOf.values()) maxY = Math.max(maxY, b.max.y);
  return maxY;
})();
console.log('data stature ≈', DATA_STATURE.toFixed(3), 'm | femur head Y', PIVOTS.upperLegL.y.toFixed(3));

// ===== 5. בנייה: קבוצה = mesh אחד ממוזג, ממורכז על הציר, זרועות ל-T-pose =====
const ROT_ARM = { L: new THREE.Matrix4().makeRotationZ(Math.PI / 2), R: new THREE.Matrix4().makeRotationZ(-Math.PI / 2) };
const ARM_GROUPS = new Set(['upperArmL', 'lowerArmL', 'handL', 'upperArmR', 'lowerArmR', 'handR']);
// מה העצם-בת שאליה נמתח כל מקטע (לסקאלה בזמן ריצה)
const TIP_BONE = {
  upperArmL: 'lowerArmL', lowerArmL: 'handL', handL: 'handTipL',
  upperArmR: 'lowerArmR', lowerArmR: 'handR', handR: 'handTipR',
  upperLegL: 'lowerLegL', lowerLegL: 'footL', footL: 'toesL',
  upperLegR: 'lowerLegR', lowerLegR: 'footR', footR: 'toesR',
};
// עוגן: לאיזו עצם מוצמדת הקבוצה; חגורת הכתפיים נצמדת לעצם הכתף אך
// הציר שלה הוא מפרק הזרוע (origin של upperArm)
const ANCHOR = { shoulderL: 'upperArmL', shoulderR: 'upperArmR' };

const root = new THREE.Group();
root.name = 'real-skeleton';
root.userData = {
  source: 'BodyParts3D/Anatomography, The Database Center for Life Science',
  license: 'CC-BY-SA 2.1 Japan',
  units: 'meters',
  stature: +DATA_STATURE.toFixed(4),
  // מיקומי המפרקים האמיתיים — כדי שהריג יתכוונן אליהם בזמן ריצה
  joints: Object.fromEntries(Object.entries(PIVOTS).map(
    ([k, v]) => [k, [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]],
  )),
  handLen: { L: +TIPLEN.handL.toFixed(4), R: +TIPLEN.handR.toFixed(4) },
  footLen: { L: +TIPLEN.footL.toFixed(4), R: +TIPLEN.footR.toFixed(4) },
};

for (const [gName, parts] of groups) {
  if (gName.startsWith('done:') || !Array.isArray(parts)) continue;
  const pivot = PIVOTS[gName];
  const geos = parts.map(({ geo }) => geo);
  const merged = mergeGeometries(geos, false);
  merged.translate(-pivot.x, -pivot.y, -pivot.z); // הציר = מפרק אמיתי
  if (ARM_GROUPS.has(gName)) merged.applyMatrix4(ROT_ARM[gName.endsWith('L') ? 'L' : 'R']);
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.6 }));
  mesh.name = gName;
  mesh.userData = {
    parent: gName,
    anchor: ANCHOR[gName] ?? gName,
    kind: TIPLEN[gName] ? 'limb' : 'axial',
    tipBone: TIP_BONE[gName] ?? null,
    tipLen: TIPLEN[gName] ? +TIPLEN[gName].toFixed(4) : null,
    bones: parts.length,
  };
  root.add(mesh);
}

// ===== 6. ייצוא GLB =====
const exporter = new GLTFExporter();
exporter.parse(root, (glb) => {
  writeFileSync(outPath, Buffer.from(glb));
  console.log(`written ${outPath} (${(glb.byteLength / 1e6).toFixed(1)} MB), groups: ${root.children.length}`);
}, (err) => { console.error(err); process.exit(1); }, { binary: true });
