// model-attach.js — שכבה 3: הלבשת מודל חיצוני (GLB/GLTF/VRM) על השלד.
// מזהה את עצמות המודל לפי מפות שמות (Mixamo / VRM / כלליות), קושר אותן
// לעצמות המנוע, ובכל פריים מעתיק אליהן את הרוטציות — retargeting בסיסי
// שעובד כשתנוחות המנוחה דומות (T-pose).

// שם קנוני במנוע → שמות אפשריים במודלים נפוצים
const NAME_MAP = {
  hips: ['mixamorigHips', 'Hips', 'hips', 'J_Bip_C_Hips', 'pelvis'],
  spine: ['mixamorigSpine', 'Spine', 'spine', 'J_Bip_C_Spine'],
  chest: ['mixamorigSpine1', 'Spine1', 'chest', 'J_Bip_C_Chest'],
  upperChest: ['mixamorigSpine2', 'Spine2', 'upperChest', 'UpperChest', 'J_Bip_C_UpperChest'],
  neck: ['mixamorigNeck', 'Neck', 'neck', 'J_Bip_C_Neck'],
  head: ['mixamorigHead', 'Head', 'head', 'J_Bip_C_Head'],
  shoulderL: ['mixamorigLeftShoulder', 'LeftShoulder', 'shoulder_L', 'J_Bip_L_Shoulder'],
  upperArmL: ['mixamorigLeftArm', 'LeftArm', 'LeftUpperArm', 'upperarm_L', 'J_Bip_L_UpperArm'],
  lowerArmL: ['mixamorigLeftForeArm', 'LeftForeArm', 'LeftLowerArm', 'lowerarm_L', 'J_Bip_L_LowerArm'],
  handL: ['mixamorigLeftHand', 'LeftHand', 'hand_L', 'J_Bip_L_Hand'],
  shoulderR: ['mixamorigRightShoulder', 'RightShoulder', 'shoulder_R', 'J_Bip_R_Shoulder'],
  upperArmR: ['mixamorigRightArm', 'RightArm', 'RightUpperArm', 'upperarm_R', 'J_Bip_R_UpperArm'],
  lowerArmR: ['mixamorigRightForeArm', 'RightForeArm', 'RightLowerArm', 'lowerarm_R', 'J_Bip_R_LowerArm'],
  handR: ['mixamorigRightHand', 'RightHand', 'hand_R', 'J_Bip_R_Hand'],
  upperLegL: ['mixamorigLeftUpLeg', 'LeftUpLeg', 'LeftUpperLeg', 'thigh_L', 'J_Bip_L_UpperLeg'],
  lowerLegL: ['mixamorigLeftLeg', 'LeftLeg', 'LeftLowerLeg', 'calf_L', 'J_Bip_L_LowerLeg'],
  footL: ['mixamorigLeftFoot', 'LeftFoot', 'foot_L', 'J_Bip_L_Foot'],
  upperLegR: ['mixamorigRightUpLeg', 'RightUpLeg', 'RightUpperLeg', 'thigh_R', 'J_Bip_R_UpperLeg'],
  lowerLegR: ['mixamorigRightLeg', 'RightLeg', 'RightLowerLeg', 'calf_R', 'J_Bip_R_LowerLeg'],
  footR: ['mixamorigRightFoot', 'RightFoot', 'foot_R', 'J_Bip_R_Foot'],
};

function indexSceneBones(scene) {
  const byName = new Map();
  scene.traverse((o) => { if (o.isBone || o.type === 'Bone') byName.set(o.name, o); });
  if (byName.size === 0) scene.traverse((o) => byName.set(o.name, o)); // מודלים בלי Bone אמיתי
  return byName;
}

/**
 * קושר סצנת מודל טעונה לשלד המנוע.
 * מחזיר { update(), mapped, missing } — לקרוא ל-update() בכל פריים.
 */
export function bindModelToSkeleton(modelScene, skeleton) {
  const byName = indexSceneBones(modelScene);
  const bindings = [];
  const mapped = [];
  const missing = [];

  for (const [engineName, candidates] of Object.entries(NAME_MAP)) {
    const engineBone = skeleton.bones.get(engineName);
    if (!engineBone) continue;
    const modelBone = candidates.map((n) => byName.get(n)).find(Boolean);
    if (!modelBone) { missing.push(engineName); continue; }
    bindings.push({
      engineBone,
      modelBone,
      restModel: modelBone.quaternion.clone(), // תנוחת המנוחה של המודל
    });
    mapped.push(engineName);
  }

  return {
    mapped,
    missing,
    /** מעתיק רוטציות מהמנוע למודל: q_model = q_rest_model · q_engine_local */
    update() {
      for (const { engineBone, modelBone, restModel } of bindings) {
        modelBone.quaternion.copy(restModel).multiply(engineBone.quaternion);
      }
    },
    /** מנרמל את גובה המודל לגובה השלד וממקם אותו על הרצפה */
    fitToSkeleton(box3, targetHeight) {
      const h = box3.max.y - box3.min.y;
      if (h > 0.01) {
        const s = targetHeight / h;
        modelScene.scale.setScalar(s);
        modelScene.position.y = -box3.min.y * s;
      }
    },
  };
}
