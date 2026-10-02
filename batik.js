// Batik lenses — five batik traditions from five provinces, drawn procedurally.
//
//   Parang        DI Yogyakarta       lidah-api blades in diagonal ribbons, mlinjon between
//   Kawung        Central Java        almond fruit petals meeting in a lattice, crosses between
//   Toraja        South Sulawesi      pa'barre allo suns and pa'tedong buffalo, from passura' carving
//   Sasirangan    South Kalimantan    stitch-resist zigzags (gigi haruan) with bleeding dye
//   Besurek       Bengkulu            rafflesia, calligraphy shapes and fern tendrils
//
// The motifs follow how batik is actually made, which is what makes it read as batik:
//   klowong    — the cream outline left where wax protected the cloth, around every shape
//   isen-isen  — the fillers inside shapes: cecek (dots) and sawut (fine parallel lines)
//   dye baths  — a handful of flat dye colours, not smooth gradients
//   remukan    — the fine crackle where wax cracked and dye crept in
//
// Each motif piece (a blade, a petal, a sun…) is drawn once as a detailed sprite in every dye
// colour, then stamped. Each lens *builds* the picture from those pieces: a piece's size and dye
// come from the brightness under it, so the image is made of nothing but motif. Pieces sit on a
// grid anchored to the portal, so moving your hands slides the cloth along, and when a lens opens
// they draw themselves in from the middle like wax going on with a canting.
//
// When a face is found (o.face), it gets a portrait on top: the face becomes undyed cloth shaded
// with finer pieces, and the outline, brows, eyes, nose and lips are traced with strokes made of
// the motif. Each iris becomes the batik's centrepiece.

const Batik = (() => {
  const WAX = '#f3e7cb'; // the cream of cloth the wax kept undyed

  // Dye baths, dark → light.
  const KIT = {
    parang:      { ramp: ['#1b1626', '#3b2314', '#7b4a22', '#b98a52', '#efe3c8'] },
    kawung:      { ramp: ['#24130a', '#5a3417', '#94602c', '#d2ad74', '#f4ead2'] },
    // Toraja carving's four natural colours: soot black, red earth, yellow earth, lime white
    toraja:      { ramp: ['#15100e', '#5a1a12', '#a8321f', '#d9a33a', '#efe6d2'] },
    sasirangan:  { ramp: ['#2a0838', '#6a1b9a', '#1f8a4c', '#f08a24', '#f7d54a'] },
    besurek:     { ramp: ['#2e0808', '#6e1717', '#a8281f', '#d99a2b', '#f3e2bf'] },
  };
  const LEVELS = 5;

  // ---------- Small helpers ----------

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  // Seeded random, so the "hand-drawn" irregularities are the same every time.
  function rng(seed) {
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function hash(a, b) {
    let h = (a * 374761393 + b * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  function mix(a, b, f) {
    const x = rgb(a), y = rgb(b);
    return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * f)).join(',')})`;
  }

  // Draw at a position and at every neighbouring wrap, so a tile repeats without seams.
  function wrapped(g, w, h, fn) {
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
      g.save(); g.translate(dx, dy); fn(); g.restore();
    }
  }

  function bez(p0, p1, p2, p3, t) {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
  }

  // The colours one piece is drawn in, for dye level i (0 = darkest bath).
  function dyes(id, i) {
    const r = KIT[id].ramp;
    return {
      body: r[i],
      dark: r[Math.max(0, i - 2)],
      lite: r[Math.min(4, i + 1)],
      // the klowong outline: cream, dimmed in the dark baths, and soga brown on the lightest one
      wax: i >= 4 ? r[2] : i <= 1 ? mix(WAX, r[i], 0.45) : WAX,
    };
  }

  // Sprites are cached per motif piece and dye level.
  const sprites = new Map();
  function sprite(key, w, h, draw) {
    let s = sprites.get(key);
    if (!s) {
      s = canvas(w, h);
      const g = s.getContext('2d');
      g.translate(w / 2, h / 2);
      draw(g);
      sprites.set(key, s);
    }
    return s;
  }

  // ---------- Parang: lidah-api blades ----------

  // One blade: a bold, slanted S standing across the ribbon (ribbon runs along x, `hgt` across),
  // tapering to a point at both tips. Neighbouring blades nest into each other's curves.
  const S_CURVE = [[0.3, -0.33], [0.15, -0.47], [-0.07, -0.47], [-0.21, -0.32], [-0.15, -0.13], [0, 0],
    [0.15, 0.13], [0.21, 0.32], [0.07, 0.47], [-0.15, 0.47], [-0.3, 0.33]];
  function catmull(P, n) {
    const out = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2
          + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
      }
    }
    out.push(P[P.length - 1]);
    return out;
  }
  function drawBlade(g, wid, hgt, c) {
    // scale, then lean the S over like the parang's knife-edge
    const C = catmull(S_CURVE, 8).map(([x, y]) => [x * wid - y * hgt * 0.42, y * hgt]);
    const N = C.length - 1, L = [], R = [], W = [];
    for (let i = 0; i <= N; i++) {
      const a = C[Math.max(0, i - 1)], b = C[Math.min(N, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
      const nx = -dy / d, ny = dx / d, t = i / N;
      const w = hgt * 0.1 * (0.12 + 0.88 * Math.sin(Math.PI * t) ** 0.6);
      W.push(w);
      L.push([C[i][0] + nx * w, C[i][1] + ny * w]);
      R.push([C[i][0] - nx * w, C[i][1] - ny * w]);
    }
    const outline = () => {
      g.beginPath();
      L.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      for (let i = N; i >= 0; i--) g.lineTo(R[i][0], R[i][1]);
      g.closePath();
    };
    g.lineJoin = 'round';
    g.lineCap = 'round';
    outline();
    g.fillStyle = c.body; g.fill();
    // sawut: fine hatching across both bowls of the S
    g.strokeStyle = c.lite; g.lineWidth = hgt * 0.007;
    for (const [a, b] of [[0.12, 0.36], [0.64, 0.88]]) {
      for (let t = a; t <= b; t += 0.018) {
        const i = Math.round(t * N), p = L[i], q = R[i];
        g.beginPath();
        g.moveTo(p[0] + (q[0] - p[0]) * 0.18, p[1] + (q[1] - p[1]) * 0.18);
        g.lineTo(p[0] + (q[0] - p[0]) * 0.42, p[1] + (q[1] - p[1]) * 0.42);
        g.stroke();
      }
    }
    // the spine running down the middle
    g.beginPath();
    for (let i = 4; i <= N - 4; i++) (i === 4 ? g.moveTo : g.lineTo).call(g, C[i][0], C[i][1]);
    g.strokeStyle = c.wax; g.lineWidth = hgt * 0.014; g.stroke();
    // klowong outline
    outline();
    g.strokeStyle = c.wax; g.lineWidth = hgt * 0.022; g.stroke();
    // cecek: dots just outside the outer edge of each bowl
    g.fillStyle = c.wax;
    for (let i = 5; i <= N - 5; i += 3) {
      const p = C[i], q = (i < N / 2 ? L : R)[i], d = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, off = W[i] + hgt * 0.032;
      g.beginPath();
      g.arc(p[0] + ((q[0] - p[0]) / d) * off, p[1] + ((q[1] - p[1]) / d) * off, hgt * 0.009, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Sprite box: `wid` is the S's own width, `hgt` the ribbon's height across.
  const BLADE = { w: 220, h: 200, wid: 120, hgt: 176 };
  const blade = (lv) => sprite(`blade:${lv}`, BLADE.w, BLADE.h, (g) => drawBlade(g, BLADE.wid, BLADE.hgt, dyes('parang', lv)));
  // Ribbon height, blade spacing along it, and the mlinjon band between ribbons, at scale k.
  const parangGeom = (k) => { const hgt = 34 * k; return { hgt, pitch: hgt * 0.5, gap: hgt * 0.3 }; };

  function drawMlinjon(g, x, y, r, c) {
    // square in the ribbon's own frame, which shows as a diamond on the diagonal cloth
    const k = r * 0.78;
    g.beginPath(); g.rect(x - k, y - k, k * 2, k * 2);
    g.fillStyle = c.body; g.fill();
    g.lineWidth = Math.max(0.6, r * 0.2); g.strokeStyle = c.wax; g.stroke();
    g.beginPath(); g.rect(x - k * 0.45, y - k * 0.45, k * 0.9, k * 0.9);
    g.lineWidth = Math.max(0.5, r * 0.1); g.stroke();
    g.beginPath(); g.arc(x, y, r * 0.18, 0, Math.PI * 2); g.fillStyle = c.wax; g.fill();
  }

  // ---------- Kawung: fruit petals ----------

  function drawPetal(g, len, c) {
    const rx = len / 2, ry = len * 0.3;
    g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    g.fillStyle = c.body; g.fill();
    g.lineWidth = len * 0.034; g.strokeStyle = c.wax; g.stroke();
    // cecek ring between the outline and the inner oval
    g.fillStyle = c.wax;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      g.beginPath(); g.arc(Math.cos(a) * rx * 0.82, Math.sin(a) * ry * 0.76, len * 0.016, 0, Math.PI * 2); g.fill();
    }
    // inner oval and the seed
    g.beginPath(); g.ellipse(0, 0, rx * 0.6, ry * 0.5, 0, 0, Math.PI * 2);
    g.fillStyle = c.dark; g.fill();
    g.lineWidth = len * 0.02; g.strokeStyle = c.wax; g.stroke();
    g.beginPath(); g.ellipse(0, 0, rx * 0.26, ry * 0.16, 0, 0, Math.PI * 2);
    g.fillStyle = c.lite; g.fill();
  }

  // The four-armed cross where four petals meet.
  function drawCross(g, r, c) {
    g.fillStyle = c.wax;
    for (let i = 0; i < 4; i++) {
      g.save(); g.rotate((i * Math.PI) / 2);
      g.beginPath(); g.ellipse(r * 0.5, 0, r * 0.5, r * 0.15, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    g.beginPath(); g.arc(0, 0, r * 0.22, 0, Math.PI * 2); g.fillStyle = c.body; g.fill();
  }

  const PETAL = { w: 132, h: 86, len: 122 };
  const petal = (lv) => sprite(`petal:${lv}`, PETAL.w, PETAL.h, (g) => drawPetal(g, PETAL.len, dyes('kawung', lv)));
  const cross = (lv) => sprite(`cross:${lv}`, 48, 48, (g) => drawCross(g, 22, dyes('kawung', lv)));

  // ---------- Toraja: passura' carving motifs ----------

  // A spiral hook, the basic stroke of Toraja carving.
  function spiralHook(g, x, y, r, dir, width, color) {
    g.beginPath();
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * Math.PI * 2.4, rr = r * (1 - (i / 36) * 0.78);
      const px = x + dir * Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.lineWidth = width; g.lineCap = 'round'; g.strokeStyle = color; g.stroke();
  }

  // Pa'barre allo: the sun — a ringed disk of swirling rays, framed in a square with corner spirals.
  function drawSun(g, R, c) {
    g.lineJoin = 'round';
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      spiralHook(g, sx * R * 0.78, sy * R * 0.78, R * 0.2, sx * sy, R * 0.07, c.lite);
    }
    g.beginPath(); g.arc(0, 0, R * 0.8, 0, Math.PI * 2);
    g.fillStyle = c.body; g.fill();
    g.lineWidth = R * 0.05; g.strokeStyle = c.wax; g.stroke();
    // twelve curved rays
    for (let i = 0; i < 12; i++) {
      g.save(); g.rotate((i * Math.PI) / 6);
      g.beginPath();
      g.moveTo(R * 0.3, -R * 0.05);
      g.quadraticCurveTo(R * 0.55, -R * 0.2, R * 0.74, -R * 0.02);
      g.quadraticCurveTo(R * 0.55, -R * 0.02, R * 0.3, R * 0.06);
      g.closePath();
      g.fillStyle = c.lite; g.fill();
      g.lineWidth = R * 0.018; g.strokeStyle = c.wax; g.stroke();
      g.restore();
    }
    g.beginPath(); g.arc(0, 0, R * 0.3, 0, Math.PI * 2);
    g.fillStyle = c.dark; g.fill();
    g.lineWidth = R * 0.04; g.strokeStyle = c.wax; g.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      g.beginPath(); g.arc(Math.cos(a) * R * 0.15, Math.sin(a) * R * 0.15, R * 0.05, 0, Math.PI * 2);
      g.fillStyle = c.wax; g.fill();
    }
  }

  // Pa'tedong: the buffalo head — sweeping horns over a long face.
  function drawTedong(g, R, c) {
    g.lineJoin = 'round';
    for (const d of [-1, 1]) {
      g.beginPath();
      // a crescent rising from the brow, tip curving up and in
      g.moveTo(d * R * 0.14, -R * 0.44);
      g.bezierCurveTo(d * R * 0.62, -R * 0.42, d * R * 0.98, -R * 0.62, d * R * 0.8, -R * 0.98);
      g.bezierCurveTo(d * R * 0.78, -R * 0.72, d * R * 0.55, -R * 0.62, d * R * 0.2, -R * 0.26);
      g.closePath();
      g.fillStyle = c.lite; g.fill();
      g.lineWidth = R * 0.035; g.strokeStyle = c.wax; g.stroke();
      spiralHook(g, d * R * 0.52, -R * 0.52, R * 0.08, -d, R * 0.03, c.dark);
    }
    g.beginPath();
    g.moveTo(-R * 0.3, -R * 0.36); g.lineTo(R * 0.3, -R * 0.36);
    g.quadraticCurveTo(R * 0.32, R * 0.3, R * 0.2, R * 0.72);
    g.quadraticCurveTo(0, R * 0.86, -R * 0.2, R * 0.72);
    g.quadraticCurveTo(-R * 0.32, R * 0.3, -R * 0.3, -R * 0.36);
    g.closePath();
    g.fillStyle = c.body; g.fill();
    g.lineWidth = R * 0.035; g.strokeStyle = c.wax; g.stroke();
    // a diamond on the brow, eyes, and the muzzle
    g.beginPath(); g.moveTo(0, -R * 0.3); g.lineTo(R * 0.09, -R * 0.18); g.lineTo(0, -R * 0.06); g.lineTo(-R * 0.09, -R * 0.18); g.closePath();
    g.fillStyle = c.lite; g.fill();
    g.fillStyle = c.wax;
    for (const d of [-1, 1]) { g.beginPath(); g.ellipse(d * R * 0.15, R * 0.02, R * 0.06, R * 0.035, d * 0.4, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.ellipse(0, R * 0.6, R * 0.17, R * 0.1, 0, 0, Math.PI * 2); g.fillStyle = c.dark; g.fill();
    g.fillStyle = c.wax;
    for (const d of [-1, 1]) { g.beginPath(); g.arc(d * R * 0.07, R * 0.6, R * 0.03, 0, Math.PI * 2); g.fill(); }
  }

  const SUN = { w: 140, h: 140, r: 66 };
  const sun = (lv) => sprite(`sun:${lv}`, SUN.w, SUN.h, (g) => drawSun(g, SUN.r, dyes('toraja', lv)));
  const tedong = (lv) => sprite(`tedong:${lv}`, SUN.w, SUN.h, (g) => drawTedong(g, SUN.r, dyes('toraja', lv)));

  // ---------- Sasirangan: stitch-resist zigzags ----------

  // One column, two teeth tall, seamless top to bottom: a pale resist line inside a halo of dye.
  function drawZig(g, W, H, c) {
    const A = W * 0.3, path = () => {
      g.beginPath();
      for (let k = -1; k <= 5; k++) g.lineTo(k % 2 ? A : -A, -H / 2 + (k * H) / 4);
    };
    g.lineJoin = 'miter';
    g.save();
    g.filter = `blur(${W * 0.07}px)`;
    path(); g.strokeStyle = c.body; g.lineWidth = W * 0.34; g.stroke();
    g.restore();
    path(); g.strokeStyle = c.body; g.lineWidth = W * 0.16; g.stroke();
    path(); g.strokeStyle = WAX; g.lineWidth = W * 0.06; g.stroke();
    // stitch holes along the line
    g.fillStyle = c.dark;
    for (let k = 0; k < 4; k++) {
      const y0 = -H / 2 + (k * H) / 4, x0 = k % 2 ? A : -A, x1 = k % 2 ? -A : A;
      for (let s = 0.15; s < 1; s += 0.2) {
        g.beginPath(); g.arc(x0 + (x1 - x0) * s + W * 0.07, y0 + (H / 4) * s, W * 0.022, 0, Math.PI * 2); g.fill();
      }
    }
  }
  const ZIG = { w: 64, h: 128 };
  const zig = (lv) => sprite(`zig:${lv}`, ZIG.w, ZIG.h, (g) => drawZig(g, ZIG.w, ZIG.h, dyes('sasirangan', lv)));

  // ---------- Besurek: rafflesia and calligraphy ----------

  function drawRafflesia(g, R, c, seed = 3) {
    const rand = rng(seed);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      g.save(); g.rotate(a);
      // a fleshy, rounded petal
      g.beginPath();
      g.moveTo(R * 0.2, -R * 0.16);
      g.bezierCurveTo(R * 0.5, -R * 0.5, R * 1.02, -R * 0.42, R * 0.98, 0);
      g.bezierCurveTo(R * 1.02, R * 0.42, R * 0.5, R * 0.5, R * 0.2, R * 0.16);
      g.closePath();
      g.fillStyle = c.body; g.fill();
      g.lineWidth = R * 0.035; g.strokeStyle = c.wax; g.stroke();
      // warts
      g.fillStyle = c.lite;
      for (let s = 0; s < 11; s++) {
        const x = R * (0.4 + rand() * 0.48), y = (rand() - 0.5) * R * 0.5 * (x / R);
        g.beginPath(); g.arc(x, y, R * (0.025 + rand() * 0.035), 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }
    // the central disk: a rim, a hollow, and a crown of processes
    g.beginPath(); g.arc(0, 0, R * 0.36, 0, Math.PI * 2); g.fillStyle = c.dark; g.fill();
    g.lineWidth = R * 0.03; g.strokeStyle = c.wax; g.stroke();
    g.beginPath(); g.arc(0, 0, R * 0.22, 0, Math.PI * 2); g.fillStyle = c.body; g.fill();
    g.fillStyle = c.wax;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath(); g.arc(Math.cos(a) * R * 0.29, Math.sin(a) * R * 0.29, R * 0.025, 0, Math.PI * 2); g.fill();
    }
  }

  // Joined letters stretched with kashida, like the flowing (and unreadable) calligraphy on the
  // cloth. These are letter shapes, not words.
  const SCRIPT = ['ســـط', 'عـــق', 'حــط', 'كـــظ', 'مــغ', 'صـــف', 'لـــق', 'بــط'];
  const LETTERS = ['ب', 'ح', 'ع', 'س', 'ك', 'ل', 'م', 'ه', 'و', 'ي', 'ص', 'ط'];
  const ARABIC = '"Noto Naskh Arabic", "Geeza Pro", serif';

  function scriptSprite(i, lv) {
    const key = `script:${i}:${lv}`;
    let s = sprites.get(key);
    if (s) return s;
    const c = dyes('besurek', lv), F = 64;
    const m = canvas(1, 1).getContext('2d');
    m.font = `${F}px ${ARABIC}`;
    const w = m.measureText(SCRIPT[i]).width + F * 0.5, h = F * 1.5;
    s = canvas(w, h);
    const g = s.getContext('2d');
    g.font = `${F}px ${ARABIC}`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = F * 0.09; g.strokeStyle = c.wax;
    g.strokeText(SCRIPT[i], w / 2, h * 0.5);
    g.fillStyle = c.body;
    g.fillText(SCRIPT[i], w / 2, h * 0.5);
    g.fillStyle = c.wax; // a few ornamental dots, as on the cloth
    for (const [x, y] of [[0.12, 0.25], [0.88, 0.28], [0.5, 0.12]]) {
      g.beginPath(); g.arc(w * x, h * y, F * 0.04, 0, Math.PI * 2); g.fill();
    }
    sprites.set(key, s);
    return s;
  }
  const RAFF = { w: 150, h: 150, r: 70 };
  const raff = (lv) => sprite(`raff:${lv}`, RAFF.w, RAFF.h, (g) => drawRafflesia(g, RAFF.r, dyes('besurek', lv)));

  // Relung paku: a fern tendril, for the background weave.
  function drawTendril(g, x, y, s, c) {
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2.2, r = s * (1 - (i / 40) * 0.8);
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.lineWidth = s * 0.08; g.strokeStyle = c.body; g.stroke();
    g.fillStyle = c.wax;
    for (let i = 4; i < 36; i += 5) {
      const a = (i / 40) * Math.PI * 2.2, r = s * (1 - (i / 40) * 0.8) + s * 0.12;
      g.beginPath(); g.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r, s * 0.09, s * 0.035, a, 0, Math.PI * 2); g.fill();
    }
  }

  // ---------- Background weave tiles (drawn at 2× for crispness) ----------

  const tiles = new Map();
  const TILE_RES = 2;

  const TILE = {
    parang() {
      const { hgt, pitch, gap } = parangGeom(TILE_RES), n = 8;
      const W = pitch * n, H = hgt + gap, k = canvas(W, H), g = k.getContext('2d'), c = dyes('parang', 1);
      g.fillStyle = KIT.parang.ramp[0]; g.fillRect(0, 0, W, H);
      const s = blade(1), sc = hgt / BLADE.hgt;
      wrapped(g, W, H, () => {
        for (let i = 0; i < n; i++) g.drawImage(s, (i + 0.5) * pitch - (BLADE.w * sc) / 2, hgt / 2 - (BLADE.h * sc) / 2, BLADE.w * sc, BLADE.h * sc);
      });
      g.fillStyle = c.wax;
      g.fillRect(0, hgt + gap * 0.1, W, Math.max(1, gap * 0.06));
      g.fillRect(0, hgt + gap * 0.84, W, Math.max(1, gap * 0.06));
      for (let i = 0; i < n; i++) drawMlinjon(g, (i + 0.5) * pitch, hgt + gap / 2, gap * 0.24, c);
      return { tile: k, angle: -45 };
    },
    kawung() {
      const P = 34 * TILE_RES, k = canvas(P, P), g = k.getContext('2d');
      g.fillStyle = KIT.kawung.ramp[0]; g.fillRect(0, 0, P, P);
      const s = petal(1), cr = cross(1), L = P * 0.707, sc = L / PETAL.len;
      wrapped(g, P, P, () => {
        for (const [fx, fy] of [[P / 2, P / 2], [0, 0]]) {
          for (let q = 0; q < 4; q++) {
            const a = Math.PI / 4 + (q * Math.PI) / 2;
            g.save(); g.translate(fx + Math.cos(a) * L / 2, fy + Math.sin(a) * L / 2); g.rotate(a);
            g.drawImage(s, -PETAL.w * sc / 2, -PETAL.h * sc / 2, PETAL.w * sc, PETAL.h * sc);
            g.restore();
          }
        }
        for (const [cx, cy] of [[P / 2, 0], [0, P / 2]]) g.drawImage(cr, cx - P * 0.16, cy - P * 0.16, P * 0.32, P * 0.32);
      });
      return { tile: k, angle: 0 };
    },
    toraja() {
      // pa'sala'bi': a lattice of diamonds, with a sun in each
      const P = 44 * TILE_RES, k = canvas(P, P), g = k.getContext('2d'), c = dyes('toraja', 1);
      g.fillStyle = KIT.toraja.ramp[0]; g.fillRect(0, 0, P, P);
      wrapped(g, P, P, () => {
        g.beginPath();
        g.moveTo(P / 2, 0); g.lineTo(P, P / 2); g.lineTo(P / 2, P); g.lineTo(0, P / 2); g.closePath();
        g.lineWidth = P * 0.03; g.strokeStyle = c.wax; g.stroke();
        g.lineWidth = P * 0.012; g.strokeStyle = c.lite;
        g.beginPath(); g.moveTo(P / 2, P * 0.07); g.lineTo(P * 0.93, P / 2); g.lineTo(P / 2, P * 0.93); g.lineTo(P * 0.07, P / 2); g.closePath(); g.stroke();
        g.drawImage(sun(1), P * 0.22, P * 0.22, P * 0.56, P * 0.56);
        for (const [x, y] of [[0, 0], [P, 0], [0, P], [P, P]]) spiralHook(g, x, y, P * 0.12, 1, P * 0.03, c.body);
      });
      return { tile: k, angle: 0 };
    },
    sasirangan() {
      const CW = 26 * TILE_RES, W = CW * 6, H = CW * 2, k = canvas(W, H), g = k.getContext('2d');
      const r = KIT.sasirangan.ramp;
      // dye stripes bleeding into each other
      g.fillStyle = r[0]; g.fillRect(0, 0, W, H);
      g.save(); g.filter = `blur(${CW * 0.4}px)`;
      [r[1], r[2], r[1], r[1], r[2], r[1]].forEach((col, i) => { g.fillStyle = col; g.fillRect(i * CW - CW * 0.2, -H, CW * 0.8, H * 3); });
      g.restore();
      for (let i = 0; i < 6; i++) g.drawImage(zig(1 + (i % 2)), i * CW + CW / 2 - CW * 0.45, 0, CW * 0.9, H);
      return { tile: k, angle: 0 };
    },
    besurek() {
      const S = 120 * TILE_RES, k = canvas(S, S), g = k.getContext('2d'), c = dyes('besurek', 1);
      g.fillStyle = KIT.besurek.ramp[0]; g.fillRect(0, 0, S, S);
      wrapped(g, S, S, () => {
        g.drawImage(raff(1), S * 0.3, S * 0.3, S * 0.4, S * 0.4);
        [[0, 0.16, 0.02], [3, 0.84, 0.18], [5, 0.16, 0.84], [6, 0.84, 0.82]].forEach(([i, x, y]) => {
          const sp = scriptSprite(i, 1), sw = S * 0.34, sh = sw * (sp.height / sp.width);
          g.drawImage(sp, x * S - sw / 2, y * S - sh / 2, sw, sh);
        });
        drawTendril(g, S * 0.5, S * 0.06, S * 0.08, c);
        drawTendril(g, S * 0.04, S * 0.5, S * 0.07, c);
      });
      return { tile: k, angle: 0 };
    },
  };

  function groundTile(id) {
    let t = tiles.get(id);
    if (!t) { t = TILE[id](); tiles.set(id, t); }
    return t;
  }

  function pattern(g, tile, w, o, angle, extra = 1) {
    const p = g.createPattern(tile, 'repeat');
    p.setTransform(new DOMMatrix().translate(o.focus.x, o.focus.y).rotate(angle).scale(((w / 720) * o.size * extra) / TILE_RES));
    return p;
  }

  // Remukan: random hairline cracks, branching, on a seamless tile.
  let crackle = null;
  function crackleTile() {
    if (crackle) return crackle;
    const S = 256 * TILE_RES, k = canvas(S, S), g = k.getContext('2d'), rand = rng(42);
    g.strokeStyle = 'rgba(40,18,6,0.95)';
    g.lineCap = 'round';
    const crack = (x, y, a, n, width) => {
      g.lineWidth = width;
      g.beginPath(); g.moveTo(x, y);
      for (let i = 0; i < n; i++) {
        a += (rand() - 0.5) * 1.1;
        const len = (5 + rand() * 13) * TILE_RES;
        x += Math.cos(a) * len; y += Math.sin(a) * len;
        g.lineTo(x, y);
        if (rand() < 0.18 && width > 0.5 * TILE_RES) {
          g.stroke();
          crack(x, y, a + (rand() < 0.5 ? 1 : -1) * (0.6 + rand()), 3 + (rand() * 5) | 0, width * 0.7);
          g.lineWidth = width; g.beginPath(); g.moveTo(x, y);
        }
      }
      g.stroke();
    };
    const seeds = Array.from({ length: 34 }, () => [rand() * S, rand() * S, rand() * Math.PI * 2, 6 + (rand() * 12) | 0]);
    wrapped(g, S, S, () => { for (const [x, y, a, n] of seeds) crack(x, y, a, n, 0.9 * TILE_RES); });
    crackle = k;
    return k;
  }

  // ---------- Reading the picture ----------

  const pool = {};
  function scratch(name, w, h, readback) {
    const c = (pool[name] ??= document.createElement('canvas'));
    c.g ??= c.getContext('2d', { willReadFrequently: !!readback });
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
  }

  // Brightness of the picture anywhere, 0..1, auto-levelled and shaped by the balance slider.
  let lastB = null;
  function brightness(src, w, h, o, step) {
    const key = [o.frame, src, w, h, step, o.balance, o.invert, o.mirror].join('|');
    if (o.frame !== undefined && lastB?.key === key) return lastB.fn;
    const fn = readBrightness(src, w, h, o, step);
    lastB = { key, fn };
    return fn;
  }

  function readBrightness(src, w, h, o, step) {
    const sw = Math.max(2, Math.ceil(w / step)), sh = Math.max(2, Math.ceil(h / step));
    const s = scratch('bsrc', sw, sh, true);
    s.g.save();
    if (o.mirror) { s.g.translate(sw, 0); s.g.scale(-1, 1); }
    s.g.drawImage(src, 0, 0, sw, sh);
    s.g.restore();
    const d = s.g.getImageData(0, 0, sw, sh).data, B = new Float32Array(sw * sh);
    // Stretch the picture's own 2nd–98th percentile to the full range, so a dim room or a dark
    // painting still gets big pieces and light dyes.
    const hist = new Uint32Array(256);
    for (let i = 0; i < B.length; i++) {
      const l = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) | 0;
      B[i] = l;
      hist[l]++;
    }
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= B.length * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= B.length * 0.02) { hi = v; break; } }
    const span = Math.max(24, hi - lo), c0 = o.balance - 0.38, c1 = o.balance + 0.38;
    for (let i = 0; i < B.length; i++) {
      let l = Math.min(1, Math.max(0, (B[i] - lo) / span));
      if (o.invert) l = 1 - l;
      const t = Math.min(1, Math.max(0, (l - c0) / (c1 - c0)));
      B[i] = t * t * (3 - 2 * t);
    }
    return (x, y) => {
      const i = Math.min(sw - 1, Math.max(0, (x / step) | 0));
      const j = Math.min(sh - 1, Math.max(0, (y / step) | 0));
      return B[j * sw + i];
    };
  }

  const level = (tone) => Math.min(LEVELS - 1, Math.max(0, Math.round(tone * (LEVELS - 1))));

  // The canting wave: 0 → 1 as the drawing reaches this point, with a small overshoot.
  function reveal(x, y, o) {
    if (o.cull && !o.cull(x, y)) return 0;
    if (o.since > 1500) return 1;
    const d = Math.hypot(x - o.origin.x, y - o.origin.y) / o.reach;
    const t = Math.min(1, Math.max(0, (o.since - d * 950) / 320));
    if (t >= 1) return 1;
    const c = 1.7;
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; // ease-out-back
  }

  // A grid anchored to the portal's middle, so the cloth moves with your hands.
  const gridStart = (f, pitch) => f - Math.ceil((f + pitch) / pitch) * pitch;

  // Stamp a sprite centred at the current transform's origin, `w` wide (height from its box).
  function stamp(g, s, w, h) { g.drawImage(s, -w / 2, -h / 2, w, h); }

  // ---------- Building the picture from motif pieces ----------
  // `tone(t)` picks the dye from the brightness under a piece (overridden for face shading).

  const build = {
    parang(g, w, h, o, B, tone) {
      const { hgt, pitch, gap } = parangGeom(o.k), step = hgt + gap, R = Math.hypot(w, h);
      const sc = hgt / BLADE.hgt, sw = BLADE.w * sc, sh = BLADE.h * sc;
      const ca = Math.cos(-Math.PI / 4), sa = Math.sin(-Math.PI / 4), { x: fx, y: fy } = o.focus;
      for (let v = -R; v <= R; v += step) {
        for (let u = -R; u <= R; u += pitch) {
          const x = fx + u * ca - v * sa, y = fy + u * sa + v * ca;
          if (x < -hgt || x > w + hgt || y < -hgt || y > h + hgt) continue;
          const r = reveal(x, y, o);
          if (r <= 0) continue;
          const t = B(x, y), s = (0.3 + 0.7 * t) * r;
          g.setTransform(ca * s, sa * s, -sa * s, ca * s, x, y);
          stamp(g, blade(level(tone(t))), sw, sh);
          // a mlinjon in the band between this ribbon and the next
          const mx = x - ((hgt + gap) / 2) * sa, my = y + ((hgt + gap) / 2) * ca;
          const mt = B(mx, my), mr = gap * 0.3 * (0.3 + 0.7 * mt) * r;
          if (mr > 0.8) {
            g.setTransform(ca, sa, -sa, ca, mx, my);
            drawMlinjon(g, 0, 0, mr, dyes('parang', level(tone(mt))));
          }
        }
      }
    },

    kawung(g, w, h, o, B, tone) {
      const P = 34 * o.k, L = P * 0.707, sc = L / PETAL.len, pw = PETAL.w * sc, ph = PETAL.h * sc;
      for (let y = gridStart(o.focus.y, P); y < h + P; y += P) {
        for (let x = gridStart(o.focus.x, P); x < w + P; x += P) {
          for (let q = 0; q < 4; q++) {
            const a = Math.PI / 4 + (q * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
            const px = x + (ca * L) / 2, py = y + (sa * L) / 2, r = reveal(px, py, o);
            if (r <= 0) continue;
            const t = B(px, py), s = (0.22 + 0.78 * t) * r;
            g.setTransform(ca * s, sa * s, -sa * s, ca * s, px, py);
            stamp(g, petal(level(tone(t))), pw, ph);
          }
          // the cross where petals of neighbouring flowers meet
          const cx = x + P / 2, cy = y, r = reveal(cx, cy, o);
          if (r > 0) {
            const t = B(cx, cy), s = P * 0.3 * (0.3 + 0.7 * t) * r;
            g.setTransform(1, 0, 0, 1, cx, cy);
            stamp(g, cross(level(tone(t))), s, s);
            g.setTransform(1, 0, 0, 1, x, y + P / 2);
            stamp(g, cross(level(tone(B(x, y + P / 2)))), s, s);
          }
        }
      }
    },

    // Suns and buffalo heads alternating in a grid, as on carved tongkonan panels.
    toraja(g, w, h, o, B, tone) {
      const P = 40 * o.k;
      let j = 0;
      for (let y = gridStart(o.focus.y, P); y < h + P; y += P, j++) {
        let i = 0;
        for (let x = gridStart(o.focus.x, P); x < w + P; x += P, i++) {
          const r = reveal(x, y, o);
          if (r <= 0) continue;
          const t = B(x, y), s = P * 1.05 * (0.3 + 0.7 * t) * r, lv = level(tone(t));
          const buffalo = (i + j + Math.round(o.focus.x / P) + Math.round(o.focus.y / P)) % 2 === 0;
          g.setTransform(1, 0, 0, 1, x, y);
          stamp(g, buffalo ? tedong(lv) : sun(lv), s, s);
        }
      }
    },

    sasirangan(g, w, h, o, B, tone) {
      const CW = 26 * o.k, SH = CW * 2;
      let col = 0;
      for (let x = gridStart(o.focus.x, CW); x < w + CW; x += CW, col++) {
        for (let y = gridStart(o.focus.y, SH); y < h + SH; y += SH) {
          const r = reveal(x, y, o);
          if (r <= 0) continue;
          const t = B(x, y + SH / 2), amp = (0.25 + 0.75 * t) * r;
          g.setTransform(1, 0, 0, col % 2 ? -1 : 1, x, y + SH / 2); // alternate columns mirror the teeth
          stamp(g, zig(level(tone(t))), CW * 0.95 * amp, SH);
        }
      }
    },

    besurek(g, w, h, o, B, tone) {
      const P = 28 * o.k;
      let j = 0;
      for (let y = gridStart(o.focus.y, P * 0.9); y < h + P; y += P * 0.9, j++) {
        let i = 0;
        for (let x = gridStart(o.focus.x, P) + (j % 2 ? P / 2 : 0); x < w + P; x += P, i++) {
          const r = reveal(x, y, o);
          if (r <= 0) continue;
          const t = B(x, y), lv = level(tone(t));
          const hh = hash(i + Math.round(o.focus.x / P), j + Math.round(o.focus.y / P));
          if (hh % 11 === 0) {
            const s = P * 2 * (0.3 + 0.7 * t) * r;
            g.setTransform(1, 0, 0, 1, x, y);
            stamp(g, raff(lv), s, s);
          } else {
            const sp = scriptSprite(hh % SCRIPT.length, lv), sw = P * 1.8 * (0.2 + 0.8 * t) * r;
            const a = ((hh >>> 4) % 100 / 100 - 0.5) * 0.9, ca = Math.cos(a), sa = Math.sin(a);
            g.setTransform(ca, sa, -sa, ca, x, y);
            stamp(g, sp, sw, sw * (sp.height / sp.width));
          }
        }
      }
    },
  };

  // ---------- Portrait: your face, drawn in the motif ----------

  // MediaPipe face mesh contours.
  const FACE = {
    oval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
      148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
    rightEye: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
    leftEye: [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
    rightBrow: [70, 63, 105, 66, 107],
    leftBrow: [300, 293, 334, 296, 336],
    lipsOuter: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146],
    mouthLine: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308],
    noseBridge: [168, 6, 197, 195, 5, 4],
    noseBase: [64, 98, 97, 2, 326, 327, 294],
  };
  const IRIS = { right: [468, 469], left: [473, 474] }; // centre, a point on the rim

  // One stroke unit of each motif, drawn along +x from 0 to len, `th` thick, in dark dye.
  const UNIT = {
    parang(g, len, th) {
      g.translate(len / 2, 0);
      stamp(g, blade(0), len * 1.35, th * 1.6);
    },
    kawung(g, len, th) {
      g.translate(len / 2, 0);
      stamp(g, petal(1), len * 1.08, th * 1.1);
    },
    toraja(g, len, th) {
      const c = dyes('toraja', 1);
      spiralHook(g, len * 0.3, 0, th * 0.42, 1, th * 0.2, c.body);
      spiralHook(g, len * 0.72, 0, th * 0.42, -1, th * 0.2, c.lite);
    },
    sasirangan(g, len, th) {
      const c = dyes('sasirangan', 1);
      g.beginPath();
      g.moveTo(0, -th * 0.42); g.lineTo(len / 2, th * 0.42); g.lineTo(len, -th * 0.42);
      g.lineJoin = 'miter';
      g.lineWidth = th * 0.5; g.strokeStyle = c.body; g.stroke();
      g.lineWidth = th * 0.16; g.strokeStyle = WAX; g.stroke();
    },
    besurek(g, len, th, k) {
      const sp = scriptSprite(k % SCRIPT.length, 0), sw = th * 3;
      g.translate(len / 2, 0);
      stamp(g, sp, sw, sw * (sp.height / sp.width));
    },
  };

  // The round centrepiece each batik puts in your irises, radius r, centred on 0,0.
  const JEWEL = {
    parang(g, r) {
      const r0 = KIT.parang.ramp;
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fillStyle = r0[3]; g.fill();
      for (let i = 0; i < 8; i++) {
        g.save(); g.rotate((i * Math.PI) / 4); g.translate(r * 0.55, 0);
        stamp(g, blade(1), r * 0.85, r * 0.6);
        g.restore();
      }
      g.beginPath(); g.arc(0, 0, r * 0.34, 0, Math.PI * 2); g.fillStyle = r0[0]; g.fill();
      g.lineWidth = r * 0.06; g.strokeStyle = WAX; g.stroke();
    },
    kawung(g, r) {
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fillStyle = KIT.kawung.ramp[0]; g.fill();
      for (let i = 0; i < 4; i++) {
        g.save(); g.rotate(Math.PI / 4 + (i * Math.PI) / 2); g.translate(r * 0.5, 0);
        stamp(g, petal(3), r * 1.05, r * 0.7);
        g.restore();
      }
      stamp(g, cross(4), r * 0.55, r * 0.55);
    },
    toraja(g, r) {
      stamp(g, sun(3), r * 2.4, r * 2.4);
    },
    sasirangan(g, r) {
      const rp = KIT.sasirangan.ramp;
      [[r, rp[1]], [r * 0.74, rp[2]], [r * 0.5, rp[4]]].forEach(([R, col]) => {
        g.beginPath();
        for (let i = 0; i <= 16; i++) {
          const a = (i * Math.PI) / 8, rr = i % 2 ? R * 0.78 : R;
          g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        g.closePath();
        g.fillStyle = col; g.fill();
        g.lineWidth = r * 0.04; g.strokeStyle = WAX; g.stroke();
      });
      g.beginPath(); g.arc(0, 0, r * 0.22, 0, Math.PI * 2); g.fillStyle = rp[0]; g.fill();
    },
    besurek(g, r) {
      stamp(g, raff(2), r * 2.15, r * 2.15);
    },
  };

  // Lay motif units along a line of points. `progress` (0..1) draws only the first part of the
  // line, for the canting animation; open lines taper at the ends like a brush stroke.
  function strand(g, pts, closed, th, unit, progress = 1) {
    const P = closed ? [...pts, pts[0]] : pts;
    const starts = [0];
    for (let i = 1; i < P.length; i++) starts.push(starts[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const L = starts[starts.length - 1];
    if (L < 1 || progress <= 0) return;
    let seg = 1;
    const at = (s) => {
      while (seg < P.length - 1 && starts[seg] < s) seg++;
      while (seg > 1 && starts[seg - 1] > s) seg--;
      const a = P[seg - 1], b = P[seg], f = (s - starts[seg - 1]) / (starts[seg] - starts[seg - 1] || 1);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    };
    const step = Math.max(2, th * 1.7), limit = L * Math.min(1, progress);
    for (let s = 0, k = 0; s < limit; s += step, k++) {
      const a = at(s), b = at(Math.min(L, s + step));
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || step;
      const taper = closed ? 1 : 0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, (s + step / 2) / L));
      g.save();
      g.setTransform(dx / len, dy / len, -dy / len, dx / len, a[0], a[1]);
      unit(g, len, th * taper, k);
      g.restore();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  function polyPath(g, pts) {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  }

  function portrait(id, g, w, h, o, B) {
    const F = o.face, pick = (ids) => ids.map((i) => F[i]), ramp = KIT[id].ramp;
    const oval = pick(FACE.oval);
    const faceW = Math.hypot(F[454][0] - F[234][0], F[454][1] - F[234][1]);
    if (faceW < 20) return;
    const unit = UNIT[id], jewel = JEWEL[id];
    // Features start drawing once the face (or the lens) appears, and finish about a second later.
    const since = Math.min(o.since, o.faceSince ?? 1e9);
    const p = Math.min(1, Math.max(0, (since - 450) / 900));
    const q = since > 2000 ? 1 : Math.min(1, Math.max(0, (since - 150) / 500));
    if (q <= 0) return;

    // 1. The face as undyed cloth, shaded with finer pieces in dark dye where it's in shadow.
    const xs = oval.map((v) => v[0]), ys = oval.map((v) => v[1]);
    const box = [Math.min(...xs) - 20, Math.min(...ys) - 20, Math.max(...xs) + 20, Math.max(...ys) + 20];
    g.save();
    g.globalAlpha = q;
    polyPath(g, oval);
    g.clip();
    g.fillStyle = ramp[4];
    g.fillRect(0, 0, w, h);
    build[id](g, w, h, {
      ...o, k: o.k * 0.55,
      cull: (x, y) => x > box[0] && x < box[2] && y > box[1] && y < box[3],
    }, (x, y) => 1 - B(x, y) * 0.85, (s) => Math.max(0, 0.6 - s * 0.6));
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);

    // 2. Lips: the middle dye, with the motif woven in.
    const lips = pick(FACE.lipsOuter);
    g.save();
    g.globalAlpha = p;
    polyPath(g, lips);
    g.fillStyle = ramp[2];
    g.fill();
    g.clip();
    g.globalAlpha = p * 0.5;
    const t = groundTile(id);
    g.fillStyle = pattern(g, t.tile, w, { ...o, size: o.size * 0.45 }, t.angle);
    g.fillRect(0, 0, w, h);
    g.restore();

    // 3. Eyes: white cloth, the batik's centrepiece as the iris, a glint of light.
    for (const [eye, iris] of [[FACE.rightEye, IRIS.right], [FACE.leftEye, IRIS.left]]) {
      const pts = pick(eye);
      g.save();
      g.globalAlpha = p;
      polyPath(g, pts);
      g.fillStyle = WAX;
      g.fill();
      g.clip();
      let cx, cy, r;
      if (F.length > 473) {
        [cx, cy] = F[iris[0]];
        r = Math.hypot(F[iris[1]][0] - cx, F[iris[1]][1] - cy) * 1.05;
      } else {
        cx = pts.reduce((s, v) => s + v[0], 0) / pts.length;
        cy = pts.reduce((s, v) => s + v[1], 0) / pts.length;
        r = faceW * 0.045;
      }
      const e = 1 - (1 - p) ** 3;
      g.translate(cx, cy);
      g.rotate((o.clock || 0) * 0.0004); // the centrepiece turns, very slowly
      jewel(g, Math.max(1, r * e));
      g.setTransform(1, 0, 0, 1, cx, cy);
      g.beginPath(); g.arc(-r * 0.32, -r * 0.34, r * 0.14 * e, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
      g.restore();
    }

    // 4. Every line of the face, traced in the motif.
    const T = faceW;
    strand(g, oval, true, T * 0.04, unit, p);
    strand(g, pick(FACE.rightBrow), false, T * 0.055, unit, p);
    strand(g, pick(FACE.leftBrow), false, T * 0.055, unit, p);
    strand(g, pick(FACE.rightEye).slice(0, 9), false, T * 0.03, unit, p); // upper lids, heavier
    strand(g, pick(FACE.leftEye).slice(0, 9), false, T * 0.03, unit, p);
    strand(g, pick(FACE.rightEye), true, T * 0.016, unit, p);
    strand(g, pick(FACE.leftEye), true, T * 0.016, unit, p);
    strand(g, pick(FACE.noseBridge), false, T * 0.02, unit, p);
    strand(g, pick(FACE.noseBase), false, T * 0.022, unit, p);
    strand(g, pick(FACE.mouthLine), false, T * 0.026, unit, p);
    strand(g, lips, true, T * 0.018, unit, p);
  }

  // ---------- The lens ----------

  function crackleOver(g, w, h, o, alpha) {
    if (alpha <= 0) return;
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = alpha;
    g.fillStyle = pattern(g, crackleTile(), w, o, 13, 1.4);
    g.fillRect(0, 0, w, h);
    g.restore();
  }

  function render(id, g, src, w, h, o) {
    o = { ...o, k: (w / 720) * o.size, origin: o.origin || o.focus };
    o.reach = Math.max(1, ...[[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => Math.hypot(x - o.origin.x, y - o.origin.y)));
    const B = brightness(src, w, h, o, Math.max(4, 7 * o.k));

    // The bare cloth: deepest dye, with the motif faintly woven into it.
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = KIT[id].ramp[0];
    g.fillRect(0, 0, w, h);
    const t = groundTile(id);
    g.save();
    g.globalAlpha = id === 'sasirangan' ? 0.45 : 0.32; // sasirangan cloth is dyed all over
    g.fillStyle = pattern(g, t.tile, w, o, t.angle);
    g.fillRect(0, 0, w, h);
    g.restore();

    // The picture, built from motif pieces.
    g.save();
    build[id](g, w, h, o, B, (v) => v);
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);

    // Remukan crackle on the cloth, then your face on top, then a faint second pass so the face
    // still feels dyed without the cracks muddying your features.
    crackleOver(g, w, h, o, o.crackle * 0.6);
    if (o.face) {
      g.save();
      portrait(id, g, w, h, o, B);
      g.restore();
      g.setTransform(1, 0, 0, 1, 0, 0);
      crackleOver(g, w, h, o, o.crackle * 0.15);
    }
    g.save();
    g.globalCompositeOperation = 'soft-light';
    g.fillStyle = 'rgba(160,110,60,0.22)';
    g.fillRect(0, 0, w, h);
    g.restore();
  }

  // Rebuild the Besurek sprites once the Arabic font has arrived, so its calligraphy isn't drawn
  // in a fallback font.
  document.fonts?.load(`64px ${ARABIC}`, 'ســـطعـــق').then(() => {
    for (const key of [...sprites.keys()]) if (key.startsWith('script:')) sprites.delete(key);
    tiles.delete('besurek');
  });

  const lenses = {};
  for (const id of Object.keys(KIT)) lenses[id] = (g, src, w, h, o) => render(id, g, src, w, h, o);

  return { lenses };
})();
