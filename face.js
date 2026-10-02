// Face tracking for the batik portrait — MediaPipe's face landmarker: 478 points per face,
// including the irises. Loaded on demand the first time a batik lens needs it.

import { FilesetResolver, FaceLandmarker } from './vendor/mediapipe/vision_bundle.mjs';

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.lastSrc = null;
    this.lastVideoTime = -1;
    this.ts = 0;
    this.face = null; // [{x, y, z}] in 0..1 of the image, or null
  }

  async init() {
    const fileset = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/face_landmarker.task', delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
    });
  }

  // Video: track every new frame. Still image: detect once and keep the result.
  detect(src, now) {
    if (!this.landmarker) return this.face;
    const video = src instanceof HTMLVideoElement;
    if (video) {
      if (src.readyState < 2 || src.currentTime === this.lastVideoTime) return this.face;
      this.lastVideoTime = src.currentTime;
    } else if (src === this.lastSrc) {
      return this.face;
    }
    this.lastSrc = src;
    this.ts = Math.max(this.ts + 1, Math.round(now)); // timestamps must keep increasing
    const r = this.landmarker.detectForVideo(src, this.ts);
    this.face = r.faceLandmarks?.[0] || null;
    return this.face;
  }
}
