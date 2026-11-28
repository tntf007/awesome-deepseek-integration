// real-skeleton.js — טוען את השלד האמיתי (BodyParts3D, סריקת MRI של אדם)
// ומלביש אותו על הריג. ה-GLB נבנה ע"י tools/build-real-skeleton.mjs: כל ילד
// הוא קבוצת עצמות ממוזגת שמרכזה במפרק האנטומי האמיתי, עם userData שאומר
// לאיזו עצם ריג היא נצמדת ואיך לסקול אותה.
//
// מקור הנתונים: BodyParts3D / Anatomography,
// © The Database Center for Life Science, רישיון CC-BY-SA 2.1 Japan.

/**
 * טוען GLB של שלד אמיתי. מחזיר ידית עם attach / refit / setVisible.
 * @param {string} url כתובת הקובץ (יחסית לדף)
 * @param {{GLTFLoader: any}} deps הזרקת GLTFLoader (מגיע מ-three/addons)
 */
export async function loadRealSkeleton(url, { GLTFLoader, buffer = null }) {
  const loader = new GLTFLoader();
  const gltf = buffer
    ? await loader.parseAsync(buffer, '')
    : await loader.loadAsync(url);
  const root = gltf.scene;
  const stature = root.userData?.stature
    ?? root.children[0]?.parent?.userData?.stature ?? 1.638;
  const parts = [];
  // GLTFExporter עשוי לעטוף בסצנה; המזהה הוא userData.parent על כל mesh
  root.traverse((o) => { if (o.isMesh && o.userData?.parent) parts.push(o); });
  if (parts.length === 0) throw new Error('real skeleton GLB has no tagged parts');

  let attachedTo = null;

  return {
    parts,
    stature,

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
