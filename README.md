# Batik Lens

Frame a portal with your hands and everything inside it becomes batik.

Batik Lens is a webcam app that runs entirely in the browser. Your left index finger and right thumb
are the corners of a portal; inside it, the picture is rebuilt from the pieces of a regional batik
motif, and your face is traced in the motif too. Pinch with your right hand to keep a region and
move on to the next batik, building up a collage.

The five batik, from five provinces:

| Batik | Province |
| --- | --- |
| Parang | DI Yogyakarta |
| Kawung | Central Java |
| Toraja | South Sulawesi |
| Sasirangan | South Kalimantan |
| Besurek | Bengkulu |

A kain window (or its own screen, `kain.html`) shows the active batik as a hanging cloth.

## Run it

It's a static site with no build step. Serve the folder and open it:

```bash
python3 -m http.server 5173
```

Then visit http://localhost:5173. The camera needs `localhost` or HTTPS.

## How it's made

- `portal.js`: the hand portal, gestures, kept regions and the main loop
- `batik.js`: the five batik, drawn procedurally with Canvas 2D
- `cloth.js` / `kain.html`: the hanging cloth, a Three.js shader
- `hands.js` / `face.js`: MediaPipe hand and face tracking

Third-party files are listed in [VENDOR-NOTES.md](VENDOR-NOTES.md). All processing happens on your
device; no video leaves the browser.
