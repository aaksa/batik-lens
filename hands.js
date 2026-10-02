// Hand tracking for the portal — MediaPipe's hand landmarker, 21 points per hand, up to two hands.
// Loaded on demand the first time a camera or video is playing.

import { FilesetResolver, HandLandmarker } from './vendor/mediapipe/vision_bundle.mjs';

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.hands = []; // [{ lm: [{x, y, z}] (0..1 of the image), side: 'Left' | 'Right' }]
  }

  async init() {
    const fileset = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/hand_landmarker.task', delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
  }

  // Returns the hands in the current video frame (reuses the last result between frames).
  detect(video, now) {
    if (!this.landmarker || video.readyState < 2) return this.hands;
    if (video.currentTime === this.lastVideoTime) return this.hands;
    this.lastVideoTime = video.currentTime;
    const r = this.landmarker.detectForVideo(video, now);
    this.hands = (r.landmarks || []).map((lm, i) => ({
      lm,
      side: r.handedness?.[i]?.[0]?.categoryName || '',
    }));
    return this.hands;
  }
}
