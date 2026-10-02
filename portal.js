// Portal — the main experience, after RetroLens (github.com/syahdanfx/Retrolens).
//
// One live portal at a time, with one batik in it. Each hand is one control point:
//   • your LEFT index fingertip is one corner, your RIGHT thumb tip the opposite one
//   • the portal only shows while both fingers are detected (or while you've drawn one with the mouse)
// Pinch with your right hand (thumb to index) or click inside the portal to KEEP it: that region stays on
// the picture as live batik, and the portal following your fingers moves on to the next batik.
// Kept regions pile up into a collage; Undo and Clear take them back off.
//
// The batik (batik.js) is anchored to the frame, not the portal, so a kept region and the live
// portal show the same continuous cloth. Each frame: the real picture, then the kept regions
// (each batik rendered once, only where it's needed), then the live portal, its rim and the hands.

const TIPS = [4, 8, 12, 16, 20]; // thumb, index, middle, ring, pinky
const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10],
  [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const PINCH_ON = 0.32, PINCH_OFF = 0.55; // thumb–index distance ÷ palm size, with hysteresis
const KEEP_FROM_MS = 140;                 // keep the portal as it was just before the pinch began
const IRIS_MS = 420;                      // lens change transition
const HOLD_MS = 150;                      // ride out a dropped tracking frame without blinking
const MAX_REGIONS = 24;

['portalHands', 'bSize', 'bBalance', 'bCrackle', 'bFace'].forEach((id) => (ui[id] = $(id)));

const portal = {
  mode: 'portal',          // 'portal' | 'full'
  lens: 0,                 // the live portal's batik, an index into LENSES
  prevLens: 0,
  changedAt: -1e9,
  tracker: null,
  trackerLoading: false,
  trackerFailed: false,
  hands: [],               // this frame's hands, in canvas px: { P: [[x, y] ×21], palm, pinch, side }
  live: null,              // the live portal on screen: { pts, alpha, source }
  lastHandPts: null,
  lastHandsAt: -1e9,
  history: [],             // the hand portal over the last moment: [{ t, pts }]
  regions: [],             // kept regions: { pts, lens, at }
  pinned: null,            // portal drawn with the mouse
  drag: null,
  pinchLatch: { left: false, right: false },
  lastKeepAt: 0,
  lastWheelAt: 0,
  clock0: performance.now(),
  openedAt: -1e9,          // when hands last opened the portal
  faceTracker: null,       // for the batik portrait (face.js)
  faceLoading: false,
  faceFailed: false,
  face: null,              // smoothed face points in canvas px, or null
  faceSeenAt: -1e9,
  faceLostAt: -1e9,
  size: [0, 0],
  canvases: new Map(),
  hintText: null,
};

// ---------- Lenses ----------

const lensAt = (i) => LENSES[((i % LENSES.length) + LENSES.length) % LENSES.length];

function setLens(i, how = 'click') {
  const n = LENSES.length;
  i = ((i % n) + n) % n;
  if (i !== portal.lens && how !== 'init') {
    portal.prevLens = portal.lens;
    portal.changedAt = performance.now();
  }
  portal.lens = i;
  const lens = LENSES[i];

  $('batikName').textContent = `${lens.name} · ${lens.place}`;
  $('batikAbout').textContent = lens.about;

  document.querySelectorAll('.chip').forEach((c) => {
    const on = +c.dataset.i === i;
    c.setAttribute('aria-selected', on);
    if (on && how !== 'init') c.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  });
  if (how === 'key' || how === 'wheel' || how === 'remote') toast(lens.name, lens.accent);
  refreshCloth();
  if (how !== 'remote') lensChannel?.postMessage({ type: 'lens', lens: i });
}

function batikOptions(geo) {
  return {
    mirror: ui.mirror.checked,
    invert: ui.invert.checked,
    size: +ui.bSize.value,
    balance: +ui.bBalance.value,
    crackle: +ui.bCrackle.value,
    focus: { x: mainCanvas.width / 2, y: mainCanvas.height / 2 }, // the cloth is anchored to the frame
    origin: geo.origin,      // where the drawing-in wave starts
    since: geo.since ?? 1e9, // ms since this batik appeared, for the drawing-in animation
    clock: geo.clock ?? 0,
    frame: geo.frame,        // renders in one frame share one reading of the picture
    cull: geo.boxes && ((x, y) => geo.boxes.some((b) => x > b.x - b.pad && x < b.x + b.w + b.pad
      && y > b.y - b.pad && y < b.y + b.h + b.pad)),
    face: ui.bFace.checked ? portal.face : null,
    faceSince: performance.now() - portal.faceSeenAt,
  };
}

// Render a batik, full frame, into `target` — or only around `geo.boxes`, which is all that shows.
function renderLens(lens, target, now, geo) {
  const w = mainCanvas.width, h = mainCanvas.height;
  if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
  const g = target.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  Batik.lenses[lens.id](g, state.sourceEl, w, h, batikOptions({ frame: now, ...geo }));
}

function lensCanvas(key) {
  let c = portal.canvases.get(key);
  if (!c) { c = document.createElement('canvas'); portal.canvases.set(key, c); }
  return c;
}

// ---------- Geometry ----------

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return { x: x / pts.length, y: y / pts.length };
}

function bounds(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// A box to draw batik pieces in: the shape's bounds plus room for pieces overhanging the edge.
const box = (pts) => ({ ...bounds(pts), pad: 70 * (mainCanvas.width / 720) * +ui.bSize.value });

function tracePoly(g, pts) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

function inside(pt, pts) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// The rectangle spanned by two opposite corners, starting at `a` and going round — so corners 0
// and 2 are always the two control points, and easing between frames never swaps corners.
const spanQuad = (a, b) => [[...a], [b[0], a[1]], [...b], [a[0], b[1]]];

function rectQuad(p, q) {
  const x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]);
  const y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1]);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

// ---------- Hands ----------

async function startTracker() {
  if (portal.tracker || portal.trackerLoading || portal.trackerFailed) return;
  portal.trackerLoading = true;
  setStatus('Loading hand tracking…');
  try {
    const { HandTracker } = await import('./hands.js');
    const t = new HandTracker();
    await t.init();
    portal.tracker = t;
    setStatus('Hand tracking ready. Hold up both hands.');
  } catch (err) {
    portal.trackerFailed = true;
    setStatus(`Hand tracking couldn't start: ${err.message}. You can still draw the portal with the mouse.`, true);
  } finally {
    portal.trackerLoading = false;
  }
}

// Tracked hands → canvas pixels, mirrored the same way as the picture. Which hand is which comes
// from where they are on screen: in the mirrored webcam view your left hand is on the left (in an
// unmirrored video, the person's left hand is on the right).
function readHands(raw, w, h) {
  const mirror = ui.mirror.checked;
  const hands = raw
    .map(({ lm }) => {
      const P = lm.map((p) => [(mirror ? 1 - p.x : p.x) * w, p.y * h]);
      const palm = dist(P[0], P[9]) || 1;
      return { P, palm, pinch: dist(P[4], P[8]) / palm, side: '' };
    })
    .sort((a, b) => a.P[0][0] - b.P[0][0]);
  if (hands.length === 2) {
    [hands[0].side, hands[1].side] = mirror ? ['left', 'right'] : ['right', 'left'];
  }
  return hands;
}

// The live portal from the two control points: left index fingertip, right thumb tip.
function handPortal(hands) {
  const left = hands.find((hd) => hd.side === 'left'), right = hands.find((hd) => hd.side === 'right');
  if (!left || !right) return null;
  return spanQuad(left.P[8], right.P[4]);
}

// Pinch thumb to index with the right hand: keep the portal where it was a moment before the
// pinch, so the pinch itself can't nudge the corner. The left hand only steers.
function readPinch(hands, now) {
  for (const hd of hands) {
    if (hd.side !== 'right') continue;
    if (hd.pinch < PINCH_ON) {
      if (!portal.pinchLatch[hd.side] && now - portal.lastKeepAt > 500 && portal.live?.source === 'hands') {
        const before = portal.history.find((e) => e.t >= now - KEEP_FROM_MS - 60) || portal.history[0];
        keepRegion(before ? before.pts : portal.live.pts);
      }
      portal.pinchLatch[hd.side] = true;
    } else if (hd.pinch > PINCH_OFF) {
      portal.pinchLatch[hd.side] = false;
    }
  }
}

// ---------- Face (for the batik portrait) ----------

async function startFaceTracker() {
  if (portal.faceTracker || portal.faceLoading || portal.faceFailed) return;
  portal.faceLoading = true;
  try {
    const { FaceTracker } = await import('./face.js');
    const t = new FaceTracker();
    await t.init();
    portal.faceTracker = t;
  } catch (err) {
    portal.faceFailed = true;
    setStatus(`Face tracking couldn't start (${err.message}). Batik will build from brightness only.`, true);
  } finally {
    portal.faceLoading = false;
  }
}

// Face points → canvas px (mirrored like the picture), eased between frames so the traced
// features don't shiver. A face that drops out for a moment is held briefly.
function trackFace(src, now, w, h) {
  if (!ui.bFace.checked || src === demo) { portal.face = null; return; }
  startFaceTracker();
  if (!portal.faceTracker) return;
  const raw = portal.faceTracker.detect(src, now);
  if (!raw) {
    if (now - portal.faceLostAt > 400) portal.face = null;
    return;
  }
  portal.faceLostAt = now;
  const mirror = ui.mirror.checked;
  const pts = raw.map((p) => [(mirror ? 1 - p.x : p.x) * w, p.y * h]);
  if (!portal.face || portal.face.length !== pts.length) {
    portal.face = pts;
    portal.faceSeenAt = now;
  } else {
    for (let i = 0; i < pts.length; i++) {
      portal.face[i][0] += (pts[i][0] - portal.face[i][0]) * 0.6;
      portal.face[i][1] += (pts[i][1] - portal.face[i][1]) * 0.6;
    }
  }
}

// ---------- Kept regions ----------

// Keep the region under the portal as live batik, and move the portal on to the next batik.
function keepRegion(pts) {
  const b = bounds(pts);
  if (b.w < 12 || b.h < 12) return;
  const now = performance.now();
  const kept = lensAt(portal.lens);
  portal.regions.push({ pts: pts.map((p) => [...p]), lens: portal.lens, at: now });
  if (portal.regions.length > MAX_REGIONS) portal.regions.shift();
  portal.lastKeepAt = now;
  toast(`${kept.name} kept`, kept.accent);
  setLens(portal.lens + 1, 'keep');
  updateKeepControls();
}

function undoRegion() {
  if (portal.regions.pop()) toast('Removed the last one', lensAt(portal.lens).accent);
  updateKeepControls();
}

function clearRegions() {
  if (portal.regions.length) toast('Cleared', lensAt(portal.lens).accent);
  portal.regions = [];
  updateKeepControls();
}

function updateKeepControls() {
  const n = portal.regions.length;
  $('keepCount').textContent = n ? `${n} kept` : 'None kept yet';
  $('keepUndo').disabled = !n;
  $('keepClear').disabled = !n;
}

// Each batik in use is rendered once per frame, only around the regions that use it.
function drawRegions(now) {
  if (!portal.regions.length) return;
  const g = mainCtx, w = mainCanvas.width;
  const byLens = new Map();
  for (const r of portal.regions) {
    if (!byLens.has(r.lens)) byLens.set(r.lens, []);
    byLens.get(r.lens).push(box(r.pts));
  }
  for (const [li, boxes] of byLens) {
    renderLens(lensAt(li), lensCanvas(`region:${li}`), now, { boxes, origin: centroid(portal.regions[0].pts), clock: now - portal.clock0 });
  }
  for (const r of portal.regions) {
    const lens = lensAt(r.lens), age = (now - r.at) / 600;
    g.save();
    tracePoly(g, r.pts);
    g.clip();
    g.drawImage(lensCanvas(`region:${r.lens}`), 0, 0);
    g.restore();
    // a fine seam, which flashes in the batik's colour just after it's kept
    g.save();
    tracePoly(g, r.pts);
    g.lineWidth = Math.max(1, w / 900) * (age < 1 ? 1 + 3 * (1 - age) : 1);
    g.strokeStyle = age < 1 ? lens.accent : 'rgba(243,231,203,0.45)';
    g.stroke();
    g.restore();
  }
}

// ---------- Where the live portal is ----------

function targetPortal(now, w, h) {
  const fromHands = handPortal(portal.hands);
  if (fromHands) {
    if (portal.live?.source !== 'hands' && portal.live?.source !== 'hands-held') portal.openedAt = now;
    portal.lastHandPts = fromHands;
    portal.lastHandsAt = now;
    return { pts: fromHands, alpha: 1, source: 'hands' };
  }
  if (portal.lastHandPts && now - portal.lastHandsAt < HOLD_MS) {
    return { pts: portal.lastHandPts, alpha: 1, source: 'hands-held' };
  }
  if (portal.pinned) return { pts: portal.pinned, alpha: 1, source: 'pinned' };
  return null; // no fingers, no portal
}

// Ease the hand portal so it glides rather than jitters; the others follow exactly.
function settle(t, now) {
  const prev = portal.live;
  if (!t) {
    portal.live = null;
    portal.history = [];
    return;
  }
  if (!prev || t.source !== 'hands' || prev.source === 'pinned') {
    portal.live = { ...t, pts: t.pts.map((p) => [...p]) };
  } else {
    const k = 0.55;
    portal.live = { ...t, pts: prev.pts.map((p, j) => [p[0] + (t.pts[j][0] - p[0]) * k, p[1] + (t.pts[j][1] - p[1]) * k]) };
  }
  if (portal.live.source === 'hands') {
    portal.history.push({ t: now, pts: portal.live.pts.map((p) => [...p]) });
    while (portal.history.length && portal.history[0].t < now - 600) portal.history.shift();
  } else {
    portal.history = [];
  }
}

// ---------- Drawing ----------

function paintSource(g, src, w, h) {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (ui.mirror.checked) { g.translate(w, 0); g.scale(-1, 1); }
  g.drawImage(src, 0, 0, w, h);
  g.restore();
}

function drawLive(now) {
  const p = portal.live, g = mainCtx;
  if (!p) return;
  const lens = lensAt(p.lens ?? portal.lens);
  const b = bounds(p.pts);
  if (b.w < 4 || b.h < 4) return;
  const geo = {
    boxes: [box(p.pts)],
    origin: centroid(p.pts),
    since: now - Math.max(portal.changedAt, portal.openedAt),
    clock: now - portal.clock0,
  };
  const canvas = lensCanvas('live');
  renderLens(lens, canvas, now, geo);

  g.save();
  g.globalAlpha = p.alpha;
  tracePoly(g, p.pts);
  g.clip();
  const iris = (now - portal.changedAt) / IRIS_MS;
  if (iris < 1) {
    // New batik: the old one stays, the new one opens from the middle like an iris.
    const old = lensCanvas('previous');
    renderLens(lensAt(portal.prevLens), old, now, { ...geo, since: 1e9 });
    g.drawImage(old, 0, 0);
    const reach = Math.max(...p.pts.map((q) => dist(q, [geo.origin.x, geo.origin.y])));
    const e = 1 - (1 - iris) ** 3;
    g.beginPath();
    g.arc(geo.origin.x, geo.origin.y, Math.max(1, reach * e), 0, Math.PI * 2);
    g.clip();
  }
  g.drawImage(canvas, 0, 0);
  g.restore();

  drawRim(p, lens, now, iris < 1 ? 1 - iris : 0);
}

function drawRim(p, lens, now, flash) {
  const g = mainCtx, w = mainCanvas.width;
  const lw = Math.max(2, w / 320) * (1 + flash * 1.5);
  g.save();
  g.globalAlpha = p.alpha;
  g.lineJoin = 'round';
  tracePoly(g, p.pts);
  g.shadowColor = lens.accent;
  g.shadowBlur = lw * 6;
  g.strokeStyle = lens.accent;
  g.lineWidth = lw * 1.5;
  g.setLineDash([lw * 6, lw * 4]);
  g.lineDashOffset = -now * 0.04;
  g.stroke();
  g.setLineDash([]);
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = Math.max(1, lw * 0.45);
  g.stroke();

  // The two control-point corners (left index, right thumb) are the big ones.
  p.pts.forEach(([x, y], k) => {
    const control = k === 0 || k === 2;
    const r = lw * (control ? 2.4 + 0.6 * Math.sin(now * 0.006 + k) : 1.4);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
    g.lineWidth = lw * 0.6;
    g.strokeStyle = lens.accent;
    g.stroke();
  });

  // Name tag above the portal.
  const top = p.pts.reduce((a, b) => (b[1] < a[1] ? b : a));
  const size = Math.max(11, w / 58);
  g.font = `600 ${size}px "JetBrains Mono", monospace`;
  const label = `${lens.name} · ${lens.place}`.toUpperCase();
  const tw = g.measureText(label).width + size * 1.2, th = size * 1.7;
  const cx = (Math.min(...p.pts.map((q) => q[0])) + Math.max(...p.pts.map((q) => q[0]))) / 2;
  const x = Math.min(Math.max(cx - tw / 2, 4), w - tw - 4);
  const y = Math.max(top[1] - th - lw * 3, 4);
  g.fillStyle = lens.accent;
  g.beginPath();
  g.roundRect(x, y, tw, th, th / 2);
  g.fill();
  g.fillStyle = '#140d09';
  g.textBaseline = 'middle';
  g.fillText(label, x + size * 0.6, y + th / 2 + 1);
  g.restore();
}

// Tracked hands: the control fingertips stand out, and on the right hand a ring between thumb and
// index fills as a pinch closes in.
function drawHands() {
  if (!ui.portalHands.checked || !portal.hands.length) return;
  const g = mainCtx, w = mainCanvas.width;
  const lw = Math.max(1.5, w / 520), accent = lensAt(portal.lens).accent;
  g.save();
  for (const hd of portal.hands) {
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = lw;
    g.beginPath();
    for (const [a, b] of HAND_LINKS) { g.moveTo(...hd.P[a]); g.lineTo(...hd.P[b]); }
    g.stroke();
    const control = hd.side === 'left' ? 8 : hd.side === 'right' ? 4 : -1;
    for (const t of TIPS) {
      g.beginPath();
      g.arc(hd.P[t][0], hd.P[t][1], lw * (t === control ? 4.2 : 1.8), 0, Math.PI * 2);
      g.fillStyle = t === control ? accent : 'rgba(255,255,255,0.8)';
      g.fill();
      if (t === control) { g.lineWidth = lw * 1.2; g.strokeStyle = '#fff'; g.stroke(); }
    }
    const closing = Math.max(0, Math.min(1, (1.1 - hd.pinch) / (1.1 - PINCH_ON)));
    if (closing > 0.05 && hd.side === 'right') {
      const [cx, cy] = mid(hd.P[4], hd.P[8]), r = hd.palm * 0.3;
      g.lineWidth = lw * 2.2;
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = closing >= 1 ? '#fff' : accent;
      g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + closing * Math.PI * 2); g.stroke();
    }
  }
  g.restore();
}

// ---------- The frame ----------

function frame(now) {
  if (state.source === 'demo') drawDemo(now);
  const src = state.sourceEl, w = mainCanvas.width, h = mainCanvas.height;

  // A new picture size means the kept regions no longer line up with anything.
  if (portal.size[0] !== w || portal.size[1] !== h) {
    portal.size = [w, h];
    portal.regions = [];
    portal.pinned = null;
    updateKeepControls();
  }

  if (src instanceof HTMLVideoElement) {
    startTracker();
    portal.hands = portal.tracker ? readHands(portal.tracker.detect(src, now), w, h) : [];
  } else {
    portal.hands = [];
  }
  trackFace(src, now, w, h);

  if (portal.mode === 'full') {
    const geo = { origin: { x: w / 2, y: h / 2 }, since: now - portal.changedAt, clock: now - portal.clock0 };
    renderLens(lensAt(portal.lens), mainCanvas, now, geo);
    drawRegions(now);
    portal.live = null;
  } else {
    paintSource(mainCtx, src, w, h);
    drawRegions(now);
    settle(targetPortal(now, w, h), now);
    readPinch(portal.hands, now);
    drawLive(now);
  }
  drawHands();
  updateHint();
}

function loop(now) {
  if (!state.running) return;
  frame(now);
  state.raf = requestAnimationFrame(loop);
}

// ---------- Messages over the picture ----------

let toastTimer;
function toast(text, accent) {
  const el = $('toast');
  el.textContent = text;
  el.style.setProperty('--accent', accent);
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1100);
}

function updateHint() {
  let text = '';
  const p = portal.live;
  if (portal.mode === 'portal' && !p) {
    const video = state.sourceEl instanceof HTMLVideoElement && portal.tracker;
    text = video
      ? (portal.hands.length === 1 ? 'Now the other hand: left index finger and right thumb are the corners'
        : 'Hold up both hands: your left index finger and right thumb are the corners')
      : 'Start the webcam and hold up both hands, or drag on the picture to draw the portal';
  } else if (portal.mode === 'portal' && p) {
    if (p.source === 'hands' && !portal.regions.length) {
      text = 'Pinch your right thumb and index finger to keep this batik here';
    } else if (p.source === 'pinned') {
      text = 'Click inside to keep it here · drag the corners to reshape · scroll to change batik';
    }
  }
  if (text !== portal.hintText) {
    portal.hintText = text;
    const el = $('hint');
    el.textContent = text;
    el.classList.toggle('show', !!text);
  }
}

function flash() {
  const el = $('flash');
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

// ---------- The kain window ----------
// The active batik as a hanging cloth (cloth.js, Three.js), in a little window you can pop up,
// hide and drag about. Where you leave it is remembered on this device.

const kain = { view: null, loading: false, open: false, shown: -1, timer: 0 };

function remember(key, value) {
  try { localStorage.setItem(`aksara.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
}
function recall(key, fallback) {
  try { return JSON.parse(localStorage.getItem(`aksara.${key}`)) ?? fallback; } catch { return fallback; }
}

async function setCloth(open) {
  kain.open = open;
  $('cloth').dataset.open = open;
  $('clothToggle').hidden = open;
  if (!open) { kain.view?.stop(); return; }
  if (!kain.view && !kain.loading) {
    kain.loading = true;
    try {
      const { Cloth } = await import('./cloth.js?v=2');
      kain.view = new Cloth($('clothCanvas'));
    } catch (err) {
      setStatus(`The kain window couldn't start: ${err.message}`, true);
    } finally {
      kain.loading = false;
    }
  }
  if (!kain.view || !kain.open) return;
  kain.view.resize();
  kain.view.start();
  kain.shown = -1;
  refreshCloth();
}

// Weave the active batik onto the cloth. Building the swatch takes a moment, so it waits until
// the lens has settled (a quick run of N, N, N only weaves the last one).
function refreshCloth() {
  const lens = lensAt(portal.lens);
  $('clothName').textContent = lens.name;
  $('clothPlace').textContent = lens.place;
  if (!kain.open || !kain.view || kain.shown === portal.lens) return;
  clearTimeout(kain.timer);
  kain.timer = setTimeout(() => {
    kain.shown = portal.lens;
    kain.view.setTexture(Batik.swatch(lensAt(portal.lens).id, 1024, 1280));
  }, 120);
}

$('clothToggle').addEventListener('click', () => setCloth(true));
$('clothWindow').addEventListener('click', () => openKainScreen('window'));
$('clothTab').addEventListener('click', () => openKainScreen('tab'));

// The kain as its own screen (kain.html), in a new tab or a window you can move to another display.
// It follows the active batik over this channel, and choosing a batik there switches this app.
const lensChannel = 'BroadcastChannel' in window ? new BroadcastChannel('batik-lens') : null;
if (lensChannel) {
  lensChannel.onmessage = ({ data }) => {
    if (data?.type === 'hello') lensChannel.postMessage({ type: 'lens', lens: portal.lens });
    else if (data?.type === 'lens' && data.lens !== portal.lens) setLens(data.lens, 'remote');
  };
  window.addEventListener('pagehide', () => lensChannel.postMessage({ type: 'bye' }));
}

function openKainScreen(as) {
  const win = as === 'window'
    ? window.open('kain.html', 'batik-lens-kain', 'popup,width=560,height=780')
    : window.open('kain.html', '_blank');
  if (!win) setStatus('The browser blocked the new window. Allow pop-ups for this page, then try again.', true);
  else win.focus();
}
$('clothClose').addEventListener('click', () => setCloth(false));

// Ripples: tap, or drag across the cloth.
{
  const c = $('clothCanvas');
  let down = false, last = 0;
  c.addEventListener('pointerdown', (e) => { down = true; c.setPointerCapture(e.pointerId); kain.view?.poke(e.clientX, e.clientY, 1); });
  c.addEventListener('pointermove', (e) => {
    if (!down || performance.now() - last < 110) return;
    last = performance.now();
    kain.view?.poke(e.clientX, e.clientY, 0.6);
  });
  c.addEventListener('pointerup', () => { down = false; });
}

// Drag the window by its title bar; it stays on screen.
{
  const panel = $('cloth'), bar = $('clothBar');
  let start = null;
  const place = (x, y) => {
    const r = panel.getBoundingClientRect();
    x = Math.min(Math.max(8, x), window.innerWidth - r.width - 8);
    y = Math.min(Math.max(8, y), window.innerHeight - r.height - 8);
    Object.assign(panel.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
    return [x, y];
  };
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = panel.getBoundingClientRect();
    start = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener('pointermove', (e) => { if (start) place(e.clientX - start.dx, e.clientY - start.dy); });
  bar.addEventListener('pointerup', () => {
    if (!start) return;
    start = null;
    const r = panel.getBoundingClientRect();
    remember('kainAt', [r.left, r.top]);
  });
  const at = recall('kainAt', null);
  if (Array.isArray(at)) requestAnimationFrame(() => place(at[0], at[1]));
  window.addEventListener('resize', () => {
    if (panel.style.left) { const r = panel.getBoundingClientRect(); place(r.left, r.top); }
    kain.view?.resize();
  });
}

// ---------- Mouse & touch ----------

function canvasPoint(e) {
  const r = mainCanvas.getBoundingClientRect();
  return [((e.clientX - r.left) * mainCanvas.width) / r.width, ((e.clientY - r.top) * mainCanvas.height) / r.height];
}
const hitRadius = () => (22 * mainCanvas.width) / mainCanvas.getBoundingClientRect().width;
const onLive = (pt) => portal.mode === 'portal' && portal.live && inside(pt, portal.live.pts);

mainCanvas.addEventListener('pointerdown', (e) => {
  if (portal.mode !== 'portal') return;
  const pt = canvasPoint(e), q = portal.pinned;
  let drag = null;
  if (q) {
    const corner = q.findIndex((c) => dist(c, pt) < hitRadius());
    if (corner >= 0) drag = { type: 'corner', corner, start: pt, moved: false };
    else if (inside(pt, q)) drag = { type: 'move', last: pt, start: pt, moved: false };
  }
  portal.drag = drag || { type: 'new', start: pt, moved: false };
  mainCanvas.setPointerCapture(e.pointerId);
});

mainCanvas.addEventListener('pointermove', (e) => {
  const pt = canvasPoint(e), d = portal.drag, q = portal.pinned;
  if (!d) {
    const onCorner = q && q.some((c) => dist(c, pt) < hitRadius());
    mainCanvas.style.cursor = onCorner ? 'grab' : onLive(pt) ? 'pointer' : 'crosshair';
    return;
  }
  if (dist(pt, d.start) > 6) d.moved = true;
  if (!d.moved) return;
  if (d.type === 'corner') {
    // dragging a corner keeps the portal a rectangle: the opposite corner stays put
    const opposite = q[(d.corner + 2) % 4];
    portal.pinned = rectQuad(opposite, pt);
    d.corner = portal.pinned.findIndex((c) => dist(c, pt) < 1);
  } else if (d.type === 'move') {
    const dx = pt[0] - d.last[0], dy = pt[1] - d.last[1];
    q.forEach((c) => { c[0] += dx; c[1] += dy; });
    d.last = pt;
  } else {
    portal.pinned = rectQuad(d.start, pt);
  }
});

mainCanvas.addEventListener('pointerup', (e) => {
  const d = portal.drag;
  portal.drag = null;
  if (!d || d.moved) return;
  // A click inside the portal keeps it there.
  if (onLive(canvasPoint(e))) keepRegion(portal.live.pts);
});

mainCanvas.addEventListener('wheel', (e) => {
  if (!onLive(canvasPoint(e)) && portal.mode === 'portal') return;
  e.preventDefault();
  const now = performance.now();
  if (now - portal.lastWheelAt < 160) return;
  portal.lastWheelAt = now;
  setLens(portal.lens + (e.deltaY > 0 ? 1 : -1), 'wheel');
}, { passive: false });

// ---------- Keyboard ----------

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest('input, textarea, select, button')) return;
  const k = e.key.toLowerCase();
  if (k === 'n' || k === 'arrowright') setLens(portal.lens + 1, 'key');
  else if (k === 'p' || k === 'arrowleft') setLens(portal.lens - 1, 'key');
  else if (k === 'enter') { if (portal.live) keepRegion(portal.live.pts); }
  else if (k === 'z' || k === 'backspace') undoRegion();
  else if (k === 'x') clearRegions();
  else if (k === 'f') setMode(portal.mode === 'full' ? 'portal' : 'full');
  else if (k === 's') { flash(); snapshot(); }
  else if (k === 'h') ui.portalHands.checked = !ui.portalHands.checked;
  else if (k === 'k' && e.shiftKey) openKainScreen('window');
  else if (k === 'k') setCloth(!kain.open);
  else if (k === 'm') setDrawer($('drawer').dataset.open !== 'true');
  else if (k === 'escape') { if ($('drawer').dataset.open === 'true') setDrawer(false); else portal.pinned = null; }
  else if (k === ' ') togglePause();
  else return;
  e.preventDefault();
});

// ---------- Controls ----------

function setMode(mode) {
  portal.mode = mode;
  $('modePortal').setAttribute('aria-pressed', mode === 'portal');
  $('modeFull').setAttribute('aria-pressed', mode === 'full');
}
// Settings live in a drawer; the page opens on the picture alone.
function setDrawer(open) {
  $('drawer').dataset.open = open;
  $('menuToggle').setAttribute('aria-expanded', open);
  if (open) $('menuClose').focus({ preventScroll: true });
  else if (document.activeElement?.closest('#drawer')) $('menuToggle').focus({ preventScroll: true });
}
$('menuToggle').addEventListener('click', () => setDrawer(true));
$('menuClose').addEventListener('click', () => setDrawer(false));

$('modePortal').addEventListener('click', () => setMode('portal'));
$('modeFull').addEventListener('click', () => setMode('full'));
$('keepUndo').addEventListener('click', undoRegion);
$('keepClear').addEventListener('click', clearRegions);
$('png').addEventListener('click', flash);

function buildShelf() {
  const shelf = $('shelf');
  const groups = [...new Set(LENSES.map((l) => l.shelf))];
  for (const name of groups) {
    const group = document.createElement('div');
    group.className = 'shelf-group';
    const label = document.createElement('span');
    label.className = 'shelf-label';
    label.textContent = name;
    group.appendChild(label);
    LENSES.forEach((lens, i) => {
      if (lens.shelf !== name) return;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.i = i;
      chip.setAttribute('role', 'option');
      chip.style.setProperty('--accent', lens.accent);
      chip.textContent = lens.name;
      if (lens.place) {
        const place = document.createElement('small');
        place.textContent = lens.place;
        chip.appendChild(place);
        chip.title = lens.about;
      }
      chip.addEventListener('click', () => setLens(i, 'click'));
      group.appendChild(chip);
    });
    shelf.appendChild(group);
  }
}

// ---------- Start ----------

buildShelf();
syncOutputs();
setSource('demo', demo, demo.width, demo.height); // shown while the camera starts
setLens(0, 'init');
updateKeepControls();
setCloth(false); // the page opens on the picture alone; the kain pops up on request
state.raf = requestAnimationFrame(loop);
startWebcam();
