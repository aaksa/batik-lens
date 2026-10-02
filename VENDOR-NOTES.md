# Third-party files

Downloaded into this project so the app works offline.

| Path | What | Version | License |
| --- | --- | --- | --- |
| `vendor/mediapipe/` | MediaPipe Tasks Vision runtime + WASM | 1.0.1 | Apache-2.0 |
| `models/hand_landmarker.task` | MediaPipe hand landmarker model (the hand portal) | float16/1 | Apache-2.0 |
| `models/face_landmarker.task` | MediaPipe face landmarker model (the batik face portrait) | float16/1 | Apache-2.0 |

Everything else is first-party code. The batik motifs are drawn procedurally with the browser's
Canvas 2D API; no images are used.

Fonts (Google Fonts, Open Font License) come from the CDN and are not stored here.

## Credited techniques

- Hand portal — [RetroLens](https://github.com/syahdanfx/Retrolens) by syahdanfx (portal geometry
  and gestures, reimplemented for the browser).
