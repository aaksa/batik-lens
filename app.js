// Batik Lens — the app shell: video sources, the visible canvas, pause, save and record.
//
// portal.js runs the hand portal and the main loop; batik.js draws the batik lenses inside it.

const MAX_OUT_WIDTH = 1080;

const $ = (id) => document.getElementById(id);
const mainCanvas = $('out');
const mainCtx = mainCanvas.getContext('2d');

const state = {
  source: 'demo',
  sourceEl: null,
  srcW: 720, srcH: 900,
  running: true,
  raf: 0,
  recorder: null,
};

const ui = { mirror: $('mirror'), invert: $('invert') };

// Status messages show over the picture for a few seconds; errors stay until the next message.
let statusTimer;
function setStatus(msg, isError = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.toggle('show', !!msg);
  clearTimeout(statusTimer);
  if (msg && !isError) statusTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

// Show each slider's value next to it.
function syncOutputs() {
  document.querySelectorAll('output[for]').forEach((o) => (o.textContent = $(o.htmlFor).value));
}
document.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', syncOutputs));

// The canvas takes the source's shape, up to 1080 px wide, and is shown as large as the window
// allows without cropping.
function fitCanvas() {
  const w = Math.min(MAX_OUT_WIDTH, state.srcW);
  const h = Math.round((w * state.srcH) / state.srcW);
  if (mainCanvas.width !== w || mainCanvas.height !== h) { mainCanvas.width = w; mainCanvas.height = h; }
  fitDisplay();
}

function fitDisplay() {
  const s = Math.min(window.innerWidth / mainCanvas.width, window.innerHeight / mainCanvas.height);
  mainCanvas.style.width = `${Math.floor(mainCanvas.width * s)}px`;
  mainCanvas.style.height = `${Math.floor(mainCanvas.height * s)}px`;
}
window.addEventListener('resize', fitDisplay);

// ---------- Sources ----------

function markSource(name) {
  $('srcDemo').setAttribute('aria-pressed', name === 'demo');
  $('srcCam').setAttribute('aria-pressed', name === 'webcam');
}

function stopCurrentSource() {
  const el = state.sourceEl;
  if (el instanceof HTMLVideoElement) {
    el.pause();
    if (el.srcObject) el.srcObject.getTracks().forEach((t) => t.stop());
    if (el.src.startsWith('blob:')) URL.revokeObjectURL(el.src);
  }
}

function setSource(kind, el, w, h) {
  stopCurrentSource();
  state.source = kind;
  state.sourceEl = el;
  state.srcW = w; state.srcH = h;
  markSource(kind);
  fitCanvas();
  if (!state.running) togglePause();
}

// Demo: colourful drifting blobs, so the batik has light and dark to build from before a camera is on.
const demo = document.createElement('canvas');
demo.width = 720; demo.height = 900;
const dctx = demo.getContext('2d');
const blobs = Array.from({ length: 7 }, (_, i) => ({
  hue: (i * 51) % 360, r: 140 + (i % 3) * 60,
  sx: 0.00021 + i * 0.00007, sy: 0.00017 + i * 0.00005, ph: i * 1.7,
}));
function drawDemo(now) {
  dctx.globalCompositeOperation = 'source-over';
  dctx.fillStyle = '#050308';
  dctx.fillRect(0, 0, demo.width, demo.height);
  dctx.globalCompositeOperation = 'lighter';
  for (const b of blobs) {
    const x = demo.width * (0.5 + 0.38 * Math.sin(now * b.sx + b.ph));
    const y = demo.height * (0.5 + 0.38 * Math.cos(now * b.sy + b.ph * 1.3));
    const g = dctx.createRadialGradient(x, y, 0, x, y, b.r);
    g.addColorStop(0, `hsl(${(b.hue + now * 0.01) % 360} 90% 60%)`);
    g.addColorStop(1, 'transparent');
    dctx.fillStyle = g;
    dctx.fillRect(0, 0, demo.width, demo.height);
  }
}

$('srcDemo').addEventListener('click', () => {
  ui.mirror.checked = false;
  setSource('demo', demo, demo.width, demo.height);
});

// The app starts on the webcam. Until the browser has asked for (and been given) the camera, the
// demo shows; if the camera is refused or missing, the demo simply stays.
async function startWebcam() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 } }, audio: false });
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    await v.play();
    ui.mirror.checked = true;
    setSource('webcam', v, v.videoWidth, v.videoHeight);
    return true;
  } catch (err) {
    setStatus('No webcam: allow camera access in your browser, then choose Webcam in Settings. Showing the demo for now.', true);
    return false;
  }
}
$('srcCam').addEventListener('click', startWebcam);

$('srcFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('image/')) {
    const img = new Image();
    img.onload = () => setSource('image', img, img.naturalWidth, img.naturalHeight);
    img.onerror = () => setStatus(`Couldn't open ${file.name}.`, true);
    img.src = url;
  } else {
    const v = document.createElement('video');
    v.muted = true; v.loop = true; v.playsInline = true; v.src = url;
    v.onloadedmetadata = async () => {
      await v.play();
      ui.mirror.checked = false;
      setSource('video', v, v.videoWidth, v.videoHeight);
    };
    v.onerror = () => setStatus(`Couldn't play ${file.name}. Try an MP4 or WebM file.`, true);
  }
  e.target.value = '';
});

// ---------- Actions ----------

function togglePause() {
  state.running = !state.running;
  $('pause').textContent = state.running ? 'Pause' : 'Play';
  const el = state.sourceEl;
  if (el instanceof HTMLVideoElement) state.running ? el.play() : el.pause();
  if (state.running) state.raf = requestAnimationFrame(loop);
  else cancelAnimationFrame(state.raf);
}
$('pause').addEventListener('click', togglePause);

function download(blob, ext) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.download = `batik-lens-${stamp}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('png').addEventListener('click', () => snapshot());

function snapshot() {
  mainCanvas.toBlob((b) => download(b, 'png'), 'image/png');
}

$('rec').addEventListener('click', () => {
  const btn = $('rec');
  if (state.recorder) { state.recorder.stop(); return; }
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    .find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) { setStatus('Video recording isn\'t supported in this browser.', true); return; }
  const rec = new MediaRecorder(mainCanvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 12_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    download(new Blob(chunks, { type }), type.includes('mp4') ? 'mp4' : 'webm');
    state.recorder = null;
    btn.textContent = 'Record video';
    btn.classList.remove('recording');
    setStatus('Video saved to your downloads.');
  };
  rec.start();
  state.recorder = rec;
  btn.textContent = 'Stop and save video';
  btn.classList.add('recording');
  setStatus('Recording…');
});
