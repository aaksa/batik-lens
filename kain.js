// The kain screen — the active batik as a hanging cloth, on a page of its own, so it can live in
// its own tab or window (or fill a second screen).
//
// It stays in step with Batik Lens over a BroadcastChannel: when the main app changes batik the
// cloth follows, and changing batik here (N / P) switches the main app too. Opened on its own, it
// works as a batik viewer you step through with the keys.

import { Cloth } from './cloth.js?v=2';

const $ = (id) => document.getElementById(id);
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('batik-lens') : null;
const view = new Cloth($('clothCanvas'));
const state = { lens: -1, connected: false };

function remember(key, value) {
  try { localStorage.setItem(`aksara.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
}
function recall(key, fallback) {
  try { return JSON.parse(localStorage.getItem(`aksara.${key}`)) ?? fallback; } catch { return fallback; }
}

// Show batik `i`. `tell` passes the change on to the main app.
function show(i, tell = true) {
  i = ((i % LENSES.length) + LENSES.length) % LENSES.length;
  if (i === state.lens) return;
  state.lens = i;
  const lens = LENSES[i];
  $('kainName').textContent = lens.name;
  $('kainPlace').textContent = lens.place;
  $('kainAbout').textContent = lens.about;
  document.documentElement.style.setProperty('--accent', lens.accent);
  document.title = `${lens.name} · Kain · Batik Lens`;
  // A big screen deserves a finer swatch.
  const big = Math.max(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1) > 1600;
  view.setTexture(Batik.swatch(lens.id, big ? 1536 : 1024, big ? 1920 : 1280));
  remember('kainLens', i);
  if (tell) channel?.postMessage({ type: 'lens', lens: i });
}

function setSync(connected) {
  state.connected = connected;
  $('sync').textContent = connected ? '● Following Batik Lens' : 'Not connected · N / P to change batik';
  $('sync').classList.toggle('on', connected);
}

// ---------- Talking to the main app ----------

if (channel) {
  channel.onmessage = ({ data }) => {
    if (data?.type === 'lens') {
      setSync(true);
      show(data.lens, false);
    } else if (data?.type === 'bye') {
      setSync(false);
    }
  };
  channel.postMessage({ type: 'hello' }); // ask the main app which batik is active
}
setSync(false);
show(recall('kainLens', 0), false);

// ---------- Ripples, label, fullscreen, keys ----------

{
  const c = $('clothCanvas');
  let down = false, last = 0;
  c.addEventListener('pointerdown', (e) => { down = true; c.setPointerCapture(e.pointerId); view.poke(e.clientX, e.clientY, 1); });
  c.addEventListener('pointermove', (e) => {
    if (!down || performance.now() - last < 110) return;
    last = performance.now();
    view.poke(e.clientX, e.clientY, 0.6);
  });
  c.addEventListener('pointerup', () => { down = false; });
}

function setLabel(on) {
  $('label').hidden = !on;
  $('infoToggle').setAttribute('aria-pressed', on);
  remember('kainLabel', on);
}
$('infoToggle').addEventListener('click', () => setLabel($('label').hidden));
setLabel(recall('kainLabel', true));

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}
$('fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  $('fullscreen').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
});

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('button')) return;
  const k = e.key.toLowerCase();
  if (k === 'n' || k === 'arrowright') show(state.lens + 1);
  else if (k === 'p' || k === 'arrowleft') show(state.lens - 1);
  else if (k === 'f') toggleFullscreen();
  else if (k === 'i') setLabel($('label').hidden);
  else return;
  e.preventDefault();
});

window.addEventListener('resize', () => view.resize());
view.resize();
view.start();
