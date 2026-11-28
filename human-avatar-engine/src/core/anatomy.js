// anatomy.js — שלד אנטומי אמיתי, נבנה פרוצדורלית.
// במקום גלילים סכמטיים: גולגולת ולסת, חוליות, כלוב צלעות ועצם חזה, אגן,
// עצמות ארוכות עם אפיפיזות (ראש ירך, קונדילים), שוקה+שוקית, חישור+גומד,
// בריח ושכמה, כפות ידיים ורגליים. כל mesh מוצמד לעצם ההיררכיה המתאימה
// ולכן עוקב אחרי אנימציה, מעקב מצלמה ושינויי פרופורציה.

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

function boneMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.6, metalness: 0.02 });
}
function socketMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x23201a, roughness: 0.9 });
}

/**
 * עצם ארוכה אנטומית: גוף (דיאפיזה) צר באמצע עם התרחבות בקצוות (אפיפיזות),
 * דרך LatheGeometry על פרופיל חלק, + כיפות קצה.
 * הציר: מ-0 עד length על +Y.
 */
function longBoneGeometry(length, rShaft, rTop, rBottom, { bow = 0 } = {}) {
  const ctrl = [
    [0.000, rBottom * 0.55],
    [0.030, rBottom],
    [0.120, rShaft * 1.15],
    [0.350, rShaft],
    [0.650, rShaft],
    [0.880, rShaft * 1.15],
    [0.970, rTop],
    [1.000, rTop * 0.55],
  ];
  const pts = ctrl.map(([t, r]) => new THREE.Vector2(r, t * length));
  const curve = new THREE.SplineCurve(pts);
  const profile = curve.getPoints(24);
  const geo = new THREE.LatheGeometry(profile, 14);
  if (bow !== 0) {
    // קימור קל של הגוף (כמו עצם ירך אמיתית)
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = y / length;
      pos.setZ(i, pos.getZ(i) + Math.sin(t * Math.PI) * bow);
    }
    geo.computeVertexNormals();
  }
  return geo;
}

/** ממקם mesh כך שיימתח מהראשית של העצם אל ההיסט של הילד. */
function alignToSegment(mesh, childOffset) {
  mesh.quaternion.setFromUnitVectors(UP, childOffset.clone().normalize());
}

function tube(points, radius, mat, segments = 32) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 7, false), mat);
}

/**
 * בונה את השלד האנטומי על שלד קיים.
 * מחזיר { setVisible, rebuild, material } — rebuild אחרי שינוי פרופורציות.
 */
export function createAnatomicalView(skeleton) {
  const mat = boneMaterial();
  const dark = socketMaterial();
  const attached = []; // meshes שהוצמדו לעצמות

  const add = (boneName, mesh) => {
    mesh.name = `anat:${boneName}:${mesh.name || 'part'}`;
    skeleton.bones.get(boneName).add(mesh);
    attached.push(mesh);
    return mesh;
  };
  const off = (name) => skeleton.bones.get(name).position.clone();

  function buildSkull() {
    const headLen = off('headTop').length();
    const s = headLen / 0.22; // התאמה לסקאלת הראש
    const skull = new THREE.Group();
    skull.name = 'skull';

    // קודקוד (קרניום): ספרה מעוותת
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.082 * s, 20, 16), mat);
    cranium.scale.set(0.92, 1.08, 1.06);
    cranium.position.set(0, 0.135 * s, -0.004);
    skull.add(cranium);

    // ארובות עיניים
    for (const side of [1, -1]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.0195 * s, 10, 8), dark);
      socket.position.set(side * 0.030 * s, 0.118 * s, 0.070 * s);
      skull.add(socket);
    }
    // עצמות לחיים
    for (const side of [1, -1]) {
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.014 * s, 8, 6), mat);
      cheek.scale.set(1.4, 0.7, 1.0);
      cheek.position.set(side * 0.048 * s, 0.095 * s, 0.058 * s);
      skull.add(cheek);
    }
    // חלל האף
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.009 * s, 0.024 * s, 4), dark);
    nose.rotation.x = Math.PI; // קודקוד למטה
    nose.position.set(0, 0.096 * s, 0.077 * s);
    skull.add(nose);

    // לסת עליונה + שיניים (פס בהיר)
    const maxilla = new THREE.Mesh(new THREE.BoxGeometry(0.052 * s, 0.020 * s, 0.030 * s), mat);
    maxilla.position.set(0, 0.062 * s, 0.058 * s);
    skull.add(maxilla);

    // לסת תחתונה (מנדיבולה): פרסה מצינור
    const jawPts = [];
    for (let t = 0; t <= 1; t += 0.1) {
      const a = Math.PI * (0.18 + 0.64 * t); // מהצד לצד דרך הסנטר
      jawPts.push(new THREE.Vector3(Math.cos(a) * 0.052 * s, 0.030 * s + Math.sin(Math.min(a, Math.PI - a)) * 0, 0.030 * s + Math.sin(a) * 0.042 * s));
    }
    const jaw = tube(jawPts, 0.0085 * s, mat, 20);
    jaw.name = 'jaw';
    skull.add(jaw);

    add('head', skull);
  }

  function buildSpine() {
    // חוליות לאורך השרשרת: מותני (גדולות) → גב → צוואר (קטנות)
    const chain = [
      { from: 'hips', to: 'spine', n: 3, r: 0.0195 },   // מותני
      { from: 'spine', to: 'chest', n: 3, r: 0.0180 },
      { from: 'chest', to: 'upperChest', n: 3, r: 0.0165 },
      { from: 'upperChest', to: 'neck', n: 3, r: 0.0150 },
      { from: 'neck', to: 'head', n: 3, r: 0.0115 },    // צוואר
    ];
    for (const { from, to, n, r } of chain) {
      const seg = off(to);
      const dir = seg.clone().normalize();
      for (let i = 0; i < n; i++) {
        const v = new THREE.Group();
        // גוף החוליה
        const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 1.05, 10), mat);
        v.add(body);
        // זיז אחורי (spinous process)
        const spike = new THREE.Mesh(new THREE.ConeGeometry(r * 0.38, r * 1.6, 6), mat);
        spike.rotation.x = Math.PI / 2;
        spike.position.z = -r * 1.35;
        v.add(spike);
        // זיזים רוחביים
        for (const side of [1, -1]) {
          const tp = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.22, r * 1.5, 5), mat);
          tp.rotation.z = Math.PI / 2;
          tp.position.x = side * r * 0.8;
          v.add(tp);
        }
        v.position.copy(dir.clone().multiplyScalar(seg.length() * ((i + 0.5) / n)));
        v.position.z -= 0.012; // עמוד השדרה יושב בגב
        v.quaternion.setFromUnitVectors(UP, dir);
        add(from, v);
      }
    }
  }

  function buildRibcage() {
    // 8 זוגות צלעות סביב בית החזה + עצם החזה — מוצמד ל-chest
    const chestLen = off('upperChest').length() + off('spine').length();
    const ribs = 8;
    const sternumPts = [];
    for (let i = 0; i < ribs; i++) {
      const t = i / (ribs - 1);
      const y = -0.04 + t * (chestLen + 0.14);
      const wx = 0.105 * (0.62 + 0.55 * Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.9))); // צר למטה ולמעלה
      const wz = wx * 0.72;
      const droop = 0.035 * (1 - t * 0.4);
      for (const side of [1, -1]) {
        const pts = [];
        for (let k = 0; k <= 10; k++) {
          const th = (k / 10) * Math.PI * 0.94;
          pts.push(new THREE.Vector3(
            side * Math.sin(th) * wx,
            y - (th / Math.PI) * droop,
            -Math.cos(th) * wz - 0.012,
          ));
        }
        add('chest', tube(pts, 0.0058, mat, 24));
      }
      if (t > 0.1) sternumPts.push(new THREE.Vector3(0, y - 0.94 * droop, wz - 0.012 + 0.004));
    }
    // עצם החזה (סטרנום)
    if (sternumPts.length > 1) add('chest', tube(sternumPts, 0.011, mat, 12));
  }

  function buildPelvis() {
    const hipSpan = Math.abs(off('upperLegL').x);
    // כנפי הכסל
    for (const side of [1, -1]) {
      const wing = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), mat);
      wing.scale.set(0.52, 0.95, 0.42);
      wing.position.set(side * hipSpan * 0.85, 0.035, -0.015);
      wing.rotation.y = side * 0.5;
      wing.rotation.z = -side * 0.22;
      add('hips', wing);
    }
    // עצם העצה (סקרום)
    const sacrum = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.085, 5), mat);
    sacrum.rotation.x = 0.35;
    sacrum.position.set(0, -0.025, -0.045);
    add('hips', sacrum);
    // חיבור הערווה
    const pubis = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, hipSpan * 1.1, 8), mat);
    pubis.rotation.z = Math.PI / 2;
    pubis.position.set(0, -0.055, 0.045);
    add('hips', pubis);
  }

  function buildClavicleScapula() {
    // בריח: צינור מקומר מהסטרנום לכתף; שכמה: משולש פחוס בגב
    for (const side of ['L', 'R']) {
      const sgn = side === 'L' ? 1 : -1;
      const sh = off(`shoulder${side}`);
      const clav = tube([
        new THREE.Vector3(sgn * 0.012, sh.y + 0.02, 0.055),
        new THREE.Vector3(sgn * 0.07, sh.y + 0.035, 0.045),
        new THREE.Vector3(sh.x + sgn * 0.1, sh.y + 0.025, 0.005),
      ], 0.0065, mat, 16);
      add('upperChest', clav);

      const scap = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.11, 3), mat);
      scap.scale.z = 0.22;
      scap.rotation.x = Math.PI; // קודקוד למטה
      scap.position.set(sgn * 0.06, -0.01, -0.012);
      add(`shoulder${side}`, scap);
    }
  }

  function buildLimbs() {
    // [עצם, שם ילד, רדיוסי גוף/קצוות, אפשרויות]
    const defs = [
      // הומרוס — זרוע עליונה, עם ראש כדורי בכתף
      ...['L', 'R'].flatMap((s) => [
        { bone: `upperArm${s}`, child: `lowerArm${s}`, rs: 0.013, rt: 0.022, rb: 0.024, head: 0.026, bow: 0.004 },
        // אמה: חישור + גומד — שתי עצמות מקבילות דקות
        { bone: `lowerArm${s}`, child: `hand${s}`, rs: 0.0085, rt: 0.013, rb: 0.016, twin: 0.013 },
        // ירך — העצם הארוכה בגוף, ראש ירך בולט פנימה וקונדילים בברך
        { bone: `upperLeg${s}`, child: `lowerLeg${s}`, rs: 0.017, rt: 0.030, rb: 0.030, head: 0.032, headIn: true, bow: 0.007 },
        // שוק: שוקה עבה + שוקית דקה
        { bone: `lowerLeg${s}`, child: `foot${s}`, rs: 0.013, rt: 0.020, rb: 0.026, twin: 0.017 },
      ]),
    ];
    for (const d of defs) {
      const seg = off(d.child);
      const len = seg.length();
      const sgn = d.bone.endsWith('L') ? 1 : -1;

      const g = new THREE.Group();
      const main = new THREE.Mesh(longBoneGeometry(len, d.rs, d.rt, d.rb, { bow: d.bow ?? 0 }), mat);
      g.add(main);

      if (d.head) { // ראש כדורי (ירך/כתף)
        const head = new THREE.Mesh(new THREE.SphereGeometry(d.head, 12, 10), mat);
        head.position.y = 0.012;
        if (d.headIn) head.position.x = -sgn * d.head * 0.8; // ראש הירך פונה פנימה למפרק
        g.add(head);
      }
      if (d.twin) { // עצם מקבילה (שוקית / גומד)
        const twin = new THREE.Mesh(longBoneGeometry(len * 0.96, d.rs * 0.45, d.rt * 0.5, d.rb * 0.45), mat);
        twin.position.set(sgn * d.twin, len * 0.02, -0.004);
        g.add(twin);
      }
      // קונדילים בקצה הרחוק (ברך/מרפק)
      if (d.head || d.twin) {
        for (const side of [1, -1]) {
          const c = new THREE.Mesh(new THREE.SphereGeometry(d.rt * 0.72, 8, 6), mat);
          c.position.set(side * d.rt * 0.5, len - 0.006, 0);
          g.add(c);
        }
      }
      alignToSegment(g, seg);
      add(d.bone, g);
    }
  }

  function buildHandsFeet() {
    for (const s of ['L', 'R']) {
      const sgn = s === 'L' ? 1 : -1;
      // כף יד: מסרקים + אצבעות מניפה
      const handLen = off(`handTip${s}`).length();
      const hand = new THREE.Group();
      for (let f = 0; f < 5; f++) {
        const spread = (f - 2) * 0.016;
        const flen = handLen * (f === 0 ? 0.6 : [0.85, 1.0, 1.05, 0.95, 0.75][f]);
        const finger = new THREE.Mesh(longBoneGeometry(flen, 0.0035, 0.004, 0.005), mat);
        const dir = new THREE.Vector3(sgn * Math.cos(spread * 6) , 0, Math.sin(spread * 6) * (f === 0 ? 3 : 1)).normalize();
        finger.quaternion.setFromUnitVectors(UP, dir);
        finger.position.z = spread * (f === 0 ? 2.2 : 1);
        hand.add(finger);
      }
      add(`hand${s}`, hand);

      // כף רגל: עקב + מסרקי רגל אל האצבעות
      const heel = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), mat);
      heel.scale.set(0.8, 0.9, 1.1);
      heel.position.set(0, -0.015, -0.025);
      add(`foot${s}`, heel);
      const toesOff = off(`toes${s}`);
      for (let f = 0; f < 5; f++) {
        const mt = new THREE.Mesh(longBoneGeometry(toesOff.length() * 0.95, 0.004, 0.0045, 0.0055), mat);
        mt.quaternion.setFromUnitVectors(UP, toesOff.clone().normalize());
        mt.position.x = sgn * (f - 2) * 0.012;
        add(`foot${s}`, mt);
      }
    }
  }

  function build() {
    clear();
    buildSkull();
    buildSpine();
    buildRibcage();
    buildPelvis();
    buildClavicleScapula();
    buildLimbs();
    buildHandsFeet();
  }

  function clear() {
    for (const m of attached) m.removeFromParent();
    attached.length = 0;
  }

  build();

  return {
    material: mat,
    setVisible(v) { for (const m of attached) m.visible = v; },
    /** בנייה מחדש אחרי applyProportions — אורכי העצמות השתנו */
    rebuild: build,
    dispose: clear,
  };
}
