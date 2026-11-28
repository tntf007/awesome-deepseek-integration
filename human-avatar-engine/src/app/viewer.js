// viewer.js — שכבת האפליקציה: סצנה, תאורה, מצלמה, לולאת רנדור,
// וחיבור כל המודולים: שלד → שכבת גוף שקופה → מודל חיצוני → מעקב/אנימציה.

import * as THREE from 'three';
import { createSkeleton, createSkeletonView } from '../core/skeleton.js';
import { createAnatomicalView } from '../core/anatomy.js';
import { createBodyLayer } from '../core/body-layer.js';
import { loadRealSkeleton } from '../core/real-skeleton.js';
import { createSkinMesh } from '../core/skin-mesh.js';
import { applyAnthropometry } from '../core/anthropometry.js';
import { ansurMeasurements } from '../data/ansur-proportions.js';
import { bindModelToSkeleton } from '../core/model-attach.js';
import { applyProportions, defaultBodyParams } from '../formulas/proportions.js';
import { breathingCurve, chainPhases, spiralPoint, MILKY_WAY } from '../formulas/milkyway.js';
import { parsePrompt } from '../prompt/prompt-mapper.js';
import { applyPoseFrame } from '../tracking/retarget.js';
import { LandmarkFilterBank } from '../formulas/filters.js';

/** בקר מסלול מינימלי: גרירה = סיבוב, גלגלת/צביטה = זום. */
function orbit(camera, dom, target) {
  let theta = 0.35, phi = 1.25, dist = 3.2, down = null;
  const apply = () => {
    camera.position.set(
      target.x + dist * Math.sin(phi) * Math.sin(theta),
      target.y + dist * Math.cos(phi),
      target.z + dist * Math.sin(phi) * Math.cos(theta),
    );
    camera.lookAt(target);
  };
  const pointers = new Map();
  dom.addEventListener('pointerdown', (e) => { pointers.set(e.pointerId, e); down = { x: e.clientX, y: e.clientY }; dom.setPointerCapture(e.pointerId); });
  dom.addEventListener('pointerup', (e) => { pointers.delete(e.pointerId); down = null; });
  dom.addEventListener('pointermove', (e) => {
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const prev = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pointers.set(e.pointerId, e);
      const [a2, b2] = [...pointers.values()];
      const cur = Math.hypot(a2.clientX - b2.clientX, a2.clientY - b2.clientY);
      dist = Math.min(8, Math.max(1.2, dist * (prev / Math.max(1, cur))));
      apply(); return;
    }
    if (!down) return;
    theta -= (e.clientX - down.x) * 0.006;
    phi = Math.min(2.6, Math.max(0.3, phi - (e.clientY - down.y) * 0.006));
    down = { x: e.clientX, y: e.clientY };
    apply();
  });
  dom.addEventListener('wheel', (e) => { e.preventDefault(); dist = Math.min(8, Math.max(1.2, dist * (1 + e.deltaY * 0.001))); apply(); }, { passive: false });
  apply();
  return { apply };
}

export function createViewer(canvas, { background = 0x0a0f1a } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  scene.fog = new THREE.Fog(background, 6, 14);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 50);
  const ctrl = orbit(camera, canvas, new THREE.Vector3(0, 0.95, 0));

  // תאורה
  scene.add(new THREE.HemisphereLight(0xbcd7ff, 0x1a1408, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2.5, 4, 2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x5f9cff, 0.9);
  rim.position.set(-2, 2.5, -2.5);
  scene.add(rim);

  // רצפה + גריד
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0f1626, roughness: 0.9 }),
  );
  scene.add(floor);
  scene.add(new THREE.GridHelper(8, 32, 0x24467a, 0x16233c));

  // ספירלת שביל החלב על הרצפה — המסלול שמגדיר את קצב המערכת
  const spiralPts = [];
  for (let a = 0; a < MILKY_WAY.arms; a++) {
    const pts = [];
    for (let t = 0; t <= 2.4 * Math.PI; t += 0.08) {
      const p = spiralPoint(t, { r0: 0.22 });
      const rot = (a * 2 * Math.PI) / MILKY_WAY.arms;
      pts.push(new THREE.Vector3(
        p.x * Math.cos(rot) - p.z * Math.sin(rot), 0.012,
        p.x * Math.sin(rot) + p.z * Math.cos(rot)));
    }
    spiralPts.push(pts);
  }
  const spiralGroup = new THREE.Group();
  for (const pts of spiralPts) {
    spiralGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts.filter((p) => p.length() < 3.9)),
      new THREE.LineBasicMaterial({ color: 0x2c5b9e, transparent: true, opacity: 0.55 })));
  }
  scene.add(spiralGroup);

  // ===== המנוע =====
  const skeleton = createSkeleton();
  const skelView = createSkeletonView(skeleton);   // שלד סכמטי (מפרקים+גלילים)
  const anatomy = createAnatomicalView(skeleton);  // שלד אנטומי אמיתי
  const body = createBodyLayer(skeleton);
  scene.add(skeleton.root);

  // עותק של היסטי ברירת המחדל — לשחזור אחרי כיול ANSUR
  const defaultRest = new Map([...skeleton.restOffsets].map(([k, v]) => [k, v.clone()]));
  let realSkel = null; // השלד האמיתי (BodyParts3D) — נטען עצלנית

  // עור רציף (SkinnedMesh) — נבנה עצלנית במעבר הראשון למצב 'skin'
  const skin = createSkinMesh(skeleton);
  let bodyMode = 'capsules'; // 'capsules' | 'skin'

  let skeletonStyle = 'anatomic';
  const applySkeletonStyle = () => {
    const schematic = skeletonStyle === 'schematic';
    for (const [, bone] of skeleton.bones) bone.traverse((o) => {
      if (o.isMesh && (o.name.startsWith('joint:') || o.name.startsWith('bone:'))) o.visible = schematic;
    });
    anatomy.setVisible(skeletonStyle === 'anatomic');
    realSkel?.setVisible(skeletonStyle === 'real');
  };
  applySkeletonStyle();

  let params = defaultBodyParams();
  applyProportions(skeleton, params);
  body.rebuild();
  body.applyParams(params);

  // אנימציית סרק: נשימה גלקטית לאורך עמוד השדרה
  const spineChain = ['spine', 'chest', 'upperChest', 'neck', 'head'];
  const phases = chainPhases(spineChain.length);
  let idleOn = true;
  let trackingBlend = 0; // 0 = סרק מלא, 1 = מצלמה מלאה

  // מודל חיצוני מולבש
  let modelBinding = null;
  let modelScene = null;

  const filterBank = new LandmarkFilterBank({ minCutoff: 0.8, beta: 0.01 });
  let lastPose = null;

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }
  }

  const clock = new THREE.Clock();
  function frame() {
    resize();
    const t = clock.getElapsedTime();

    if (idleOn && trackingBlend < 1) {
      const amp = 0.035 * (1 - trackingBlend);
      spineChain.forEach((name, i) => {
        const bone = skeleton.bones.get(name);
        const v = breathingCurve(t + phases[i] / (2 * Math.PI));
        bone.rotation.x = v * amp;
        bone.rotation.z = breathingCurve(t * 0.7 + phases[i]) * amp * 0.4;
      });
      const sway = breathingCurve(t * 0.5) * 0.015 * (1 - trackingBlend);
      skeleton.bones.get('hips').rotation.z = sway;
    }

    if (lastPose && trackingBlend > 0) {
      applyPoseFrame(lastPose.landmarks, skeleton, filterBank, lastPose.t, trackingBlend);
    }

    spiralGroup.rotation.y = t * 0.03; // הגלקסיה מסתובבת לאט
    if (modelBinding) modelBinding.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    scene, camera, renderer, skeleton, body,
    getParams: () => ({ ...params }),

    /** פרומפט טקסט → עדכון גוף (כולל זיהוי גבר/אישה → כיול ANSUR) */
    applyPromptText(text) {
      if (/אישה|נקבה|woman|female/i.test(text)) this.setAnthropometry('female');
      else if (/גבר|איש בוגר|\bman\b|male/i.test(text)) this.setAnthropometry('male');
      params = parsePrompt(text, params);
      this.setParams(params);
      return params;
    },

    /**
     * כיול מנתוני אמת: 'male' / 'female' (ממוצעי ANSUR II, 6,068 נמדדים)
     * או null לחזרה לפרופורציות ברירת המחדל.
     */
    setAnthropometry(sex, quantile = 'mean') {
      if (sex) {
        const stature = applyAnthropometry(skeleton, ansurMeasurements(sex, quantile));
        params.height = stature;
      } else {
        for (const [k, v] of defaultRest) skeleton.restOffsets.get(k).copy(v);
        params.height = 1.75;
      }
      return this.setParams(params);
    },

    /**
     * טוען ומציג את השלד האמיתי (BodyParts3D MRI). חייב GLTFLoader ו-url
     * של assets/real-skeleton.glb. בטוח לקריאה חוזרת.
     */
    async enableRealSkeleton({ GLTFLoader, url, buffer = null }) {
      if (!realSkel) {
        realSkel = await loadRealSkeleton(url, { GLTFLoader, buffer });
        realSkel.attach(skeleton);
      }
      realSkel.refit(skeleton, params);
      skeletonStyle = 'real';
      applySkeletonStyle();
      return realSkel.parts.length;
    },

    setParams(p) {
      params = applyProportions(skeleton, p);
      body.rebuild();
      body.applyParams(params);
      anatomy.rebuild();
      realSkel?.refit(skeleton, params);
      if (bodyMode === 'skin' && skin.mesh) scene.add(skin.rebuild(params));
      applySkeletonStyle();
      ctrl.apply();
      return params;
    },

    /** 'capsules' — שכבת הקפסולות השקופה; 'skin' — עור רציף (SkinnedMesh) */
    setBodyMode(mode) {
      bodyMode = mode;
      if (mode === 'skin') {
        if (!skin.mesh) scene.add(skin.rebuild(params));
        skin.setVisible(true);
        body.setVisible(false);
      } else {
        skin.setVisible(false);
        body.setVisible(true);
      }
      return bodyMode;
    },
    getBodyMode: () => bodyMode,
    setSkinOpacity: (v) => skin.setOpacity(v),

    /** 'real' | 'anatomic' | 'schematic' | 'none' */
    setSkeletonStyle(style) { skeletonStyle = style; applySkeletonStyle(); },
    getSkeletonStyle: () => skeletonStyle,

    setBodyOpacity(v) { if (bodyMode === 'skin') skin.setOpacity(v); else body.setOpacity(v); },
    setIdle: (v) => { idleOn = v; },

    /** עדכון ממעקב מצלמה (נקרא מה-tracker) */
    onPoseFrame(landmarks, tSec) { lastPose = { landmarks, t: tSec }; },
    setTrackingBlend(v) { trackingBlend = Math.min(1, Math.max(0, v)); },

    /** הלבשת מודל GLB מ-ArrayBuffer (קובץ שהועלה) */
    async attachModel(arrayBuffer, { GLTFLoader }) {
      if (modelScene) { modelScene.removeFromParent(); modelScene = null; modelBinding = null; }
      const loader = new GLTFLoader();
      const gltf = await loader.parseAsync(arrayBuffer, '');
      modelScene = gltf.scene;
      scene.add(modelScene);
      const box = new THREE.Box3().setFromObject(modelScene);
      modelBinding = bindModelToSkeleton(modelScene, skeleton);
      modelBinding.fitToSkeleton(box, params.height);
      return { mapped: modelBinding.mapped.length, missing: modelBinding.missing };
    },

    detachModel() {
      if (modelScene) { modelScene.removeFromParent(); modelScene = null; modelBinding = null; }
    },
  };
}
