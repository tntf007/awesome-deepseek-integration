// camera-tracker.js — מעקב מצלמה בזמן אמת: MediaPipe Pose + Face.
// רץ בדפדפן (צריך הרצה מקומית עם שרת סטטי — ראו README). טוען את מודלי
// ה-WASM מה-CDN, פותח מצלמה, ומזרים נקודות ציון אל ה-callbacks.

const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export class CameraTracker {
  constructor({ onPose, onFace, onStatus } = {}) {
    this.onPose = onPose;
    this.onFace = onFace;
    this.onStatus = onStatus ?? (() => {});
    this.video = null;
    this.running = false;
    this.poseLandmarker = null;
    this.faceLandmarker = null;
  }

  async start({ withFace = true } = {}) {
    this.onStatus('loading-models');
    const visionModule = await import(`${MP_BASE}/vision_bundle.mjs`);
    const { FilesetResolver, PoseLandmarker, FaceLandmarker } = visionModule;
    const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);

    this.poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    if (withFace) {
      this.faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        outputFaceBlendshapes: true,
        numFaces: 1,
      });
    }

    this.onStatus('opening-camera');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    this.video = document.createElement('video');
    this.video.srcObject = stream;
    this.video.playsInline = true;
    await this.video.play();

    this.running = true;
    this.onStatus('tracking');
    this._loop();
    return this.video;
  }

  _loop() {
    if (!this.running) return;
    const t = performance.now();
    if (this.video.readyState >= 2) {
      const pose = this.poseLandmarker.detectForVideo(this.video, t);
      if (pose.landmarks?.[0] && this.onPose) this.onPose(pose.landmarks[0], t / 1000);
      if (this.faceLandmarker) {
        const face = this.faceLandmarker.detectForVideo(this.video, t);
        if (face.faceBlendshapes?.[0] && this.onFace) {
          this.onFace(face.faceBlendshapes[0].categories, face.facialTransformationMatrixes?.[0], t / 1000);
        }
      }
    }
    requestAnimationFrame(() => this._loop());
  }

  stop() {
    this.running = false;
    this.video?.srcObject?.getTracks().forEach((tr) => tr.stop());
    this.onStatus('stopped');
  }
}
