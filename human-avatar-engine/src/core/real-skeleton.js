// real-skeleton.js — טוען את השלד האמיתי (BodyParts3D, סריקת MRI של אדם)
// ומלביש אותו על הריג. ה-GLB נבנה ע"י tools/build-real-skeleton.mjs: כל ילד
// הוא קבוצת עצמות ממוזגת שמרכזה במפרק האנטומי האמיתי, עם userData שאומר
// לאיזו עצם ריג היא נצמדת ואיך לסקול אותה.
//
// מקור הנתונים: BodyParts3D / Anatomography,
// © The Database Center for Life Science, רישיון CC-BY-SA 2.1 Japan.

import { REFERENCE_HEIGHT } from './skeleton.js';

/**
 * טוען GLB של שלד אמיתי. מחזיר ידית עם attach / conformRig / refit / setVisible.
 * @param {string} url כתובת הקובץ (יחסית לדף)
 * @param {{GLTFLoader: any}} deps הזרקת GLTFLoader (מגיע מ-three/addons)
 */
export async function loadRealSkeleton(url, { GLTFLoader, buffer = null }) {
  const loader = new GLTFLoader();
  const gltf = buffer
    ? await loader.parseAsync(buffer, '')
    : await loader.loadAsync(url);
  const root = gltf.scene;
  // ה-userData של השורש יכול לשבת על הסצנה או על הקבוצה שבתוכה
  let meta = root.userData?.stature ? root.userData : null;
  if (!meta) root.traverse((o) => { if (!meta && o.userData?.stature) meta = o.userData; });
  const stature = meta?.stature ?? 1.638;
  const joints = meta?.joints ?? null;
  const parts = [];
  // GLTFExporter עשוי לעטוף בסצנה; המזהה הוא userData.parent על כל mesh
  root.traverse((o) => { if (o.isMesh && o.userData?.parent) parts.push(o); });
  if (parts.length === 0) throw new Error('real skeleton GLB has no tagged parts');

  let attachedTo = null;

  return {
    parts,
    stature,
    joints,

    /**
     * מכוונן את היסטי המנוחה של הריג למפרקים האמיתיים של השלד הסרוק,
     * כך שכל עצם מתיישבת בדיוק על המפרק שלה — בלי רווחים בכתף או בברך.
     * אחרי הקריאה יש להריץ applyProportions (setParams של ה-viewer עושה זאת).
     */
    conformRig(skeleton) {
      if (!joints) return false;
      const k = REFERENCE_HEIGHT / stature;
      const J = (n) => joints[n];
      const set = (name, x, y, z) => skeleton.restOffsets.get(name).set(x * k, y * k, z * k);
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const len = (v) => Math.hypot(v[0], v[1], v[2]);

      // upperChest לא נמדד ישירות — אמצע הדרך בין T12 ל-C7
      const upperChest = J('chest').map((c, i) => (c + J('neck')[i]) / 2);

      set('hips', 0, J('hips')[1], 0);
      const d1 = sub(J('spine'), J('hips')); set('spine', 0, d1[1], d1[2]);
      const d2 = sub(J('chest'), J('spine')); set('chest', 0, d2[1], d2[2]);
      const d3 = sub(upperChest, J('chest')); set('upperChest', 0, d3[1], d3[2]);
      const d4 = sub(J('neck'), upperChest); set('neck', 0, d4[1], d4[2]);
      const d5 = sub(J('head'), J('neck')); set('head', 0, d5[1], d5[2]);
      set('headTop', 0, Math.max(0.12, stature - J('head')[1]), 0);

      for (const side of ['L', 'R']) {
        const sgn = side === 'L' ? 1 : -1;
        // המקטעים של הזרוע סובבו ל-T-pose סביב ציר Z — אותו סיבוב חל על ההיסטים
        const rot = (v) => (side === 'L' ? [-v[1], v[0], v[2]] : [v[1], -v[0], v[2]]);

        const sh = sub(J(`upperArm${side}`), upperChest);
        set(`shoulder${side}`, sh[0] * 0.3, sh[1] * 0.3, sh[2] * 0.3);
        set(`upperArm${side}`, sh[0] * 0.7, sh[1] * 0.7, sh[2] * 0.7);
        const elbow = rot(sub(J(`lowerArm${side}`), J(`upperArm${side}`)));
        set(`lowerArm${side}`, elbow[0], elbow[1], elbow[2]);
        const wrist = rot(sub(J(`hand${side}`), J(`lowerArm${side}`)));
        set(`hand${side}`, wrist[0], wrist[1], wrist[2]);
        set(`handTip${side}`, sgn * (meta?.handLen?.[side] ?? 0.18) * 0.85, 0, 0);

        const hip = sub(J(`upperLeg${side}`), J('hips'));
        set(`upperLeg${side}`, hip[0], hip[1], hip[2]);
        const knee = sub(J(`lowerLeg${side}`), J(`upperLeg${side}`));
        set(`lowerLeg${side}`, knee[0], knee[1], knee[2]);
        const ankle = sub(J(`foot${side}`), J(`lowerLeg${side}`));
        set(`foot${side}`, ankle[0], ankle[1], ankle[2]);
        const ankleY = J(`foot${side}`)[1];
        set(`toes${side}`, 0, -(ankleY - 0.025), (meta?.footLen?.[side] ?? 0.24) * 0.6);
      }
      return true;
    },

    /** מצמיד כל קבוצת עצמות לעצם הריג שלה. */
    attach(skeleton) {
      attachedTo = skeleton;
      for (const m of parts) {
        const bone = skeleton.bones.get(m.userData.parent);
        if (!bone) continue;
        m.removeFromParent();
        bone.add(m);
      }
      this.refit(skeleton, { height: 1.75 });
    },

    /**
     * מתאים מיקום וסקאלה לפרופורציות הריג הנוכחיות:
     * גפיים — לפי אורך המקטע; גוף מרכזי — לפי יחס הקומה.
     */
    refit(skeleton, params = {}) {
      const globalScale = (params.height ?? 1.75) / stature;
      for (const m of parts) {
        const ud = m.userData;
        const parentBone = skeleton.bones.get(ud.parent);
        if (!parentBone) continue;
        // עוגן: הקבוצה יושבת על מפרק העוגן (למשל שכמה על מפרק הזרוע)
        if (ud.anchor && ud.anchor !== ud.parent) {
          const anchorBone = skeleton.bones.get(ud.anchor);
          if (anchorBone && anchorBone.parent === parentBone) m.position.copy(anchorBone.position);
        } else {
          m.position.set(0, 0, 0);
        }
        if (ud.kind === 'limb' && ud.tipBone && ud.tipLen > 0) {
          const tip = skeleton.bones.get(ud.tipBone);
          const rigLen = tip ? tip.position.length() : 0;
          m.scale.setScalar(rigLen > 0 ? rigLen / ud.tipLen : globalScale);
        } else {
          m.scale.setScalar(globalScale);
        }
      }
    },

    setVisible(v) { for (const m of parts) m.visible = v; },

    detach() {
      for (const m of parts) m.removeFromParent();
      attachedTo = null;
    },

    isAttached: () => attachedTo !== null,
  };
}
