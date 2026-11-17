// Skyhold Isles — 2D art prototype (throwaway): painted map + sprite towers/enemies in motion.
// Coordinates in CONFIG are normalised to the map image (0..1). Not wired to the real sim.
(() => {
  const MAPKEY = new URLSearchParams(location.search).get('map') || window.PROTO_DEFAULT || 'L1';
  const C = window.PROTO_MAPS[MAPKEY];
  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');
  const IMG = {};
  const names = [C.img, 'tower-archer', 'tower-mage', 'tower-cannon', 'enemy-raider', 'enemy-brute', 'enemy-kite',
    'ui-plaque', 'ui-banner', 'ui-button', 'ui-horn', 'icon-heart', 'icon-gold'];
  let loaded = 0;
  for (const n of names) {
    const im = new Image();
    im.onload = () => { loaded++; };
    im.onerror = () => { loaded++; };
    im.src = `../out/${n}.png`;
    IMG[n] = im;
  }

  // ---- view: fit the map ("cover" on wide screens, "contain" otherwise) ----
  let dpr = 1, W = 0, H = 0, view = { x: 0, y: 0, s: 1 };
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const m = IMG[C.img];
    const mw = m.naturalWidth || 1920, mh = m.naturalHeight || 1080;
    // cover when the aspect is close (playfield fills the screen), contain otherwise
    const cover = Math.max(W / mw, H / mh), contain = Math.min(W / mw, H / mh);
    const s = cover / contain < 1.12 ? cover : contain;
    view = { s, x: (W - mw * s) / 2, y: (H - mh * s) / 2, mw, mh };
  }
  window.addEventListener('resize', resize);
  const P = (nx, ny) => [view.x + nx * view.mw * view.s, view.y + ny * view.mh * view.s];
  const U = () => view.mw * view.s / 1920; // unit scale: sprite sizes are tuned for a 1920-wide map

  // ---- path ----
  const PATHS = (C.paths || [C.path]).map((pts) => {
    const path = pts.map(([x, y]) => ({ x, y }));
    const segLen = [];
    for (let i = 1; i < path.length; i++) segLen.push(Math.hypot((path[i].x - path[i - 1].x) * 16, (path[i].y - path[i - 1].y) * 9));
    return { path, segLen };
  });
  function along(d, pi = 0) {
    const { path, segLen } = PATHS[pi];
    let i = 0; while (i < segLen.length && d > segLen[i]) { d -= segLen[i]; i++; }
    if (i >= segLen.length) return { x: path[path.length - 1].x, y: path[path.length - 1].y, dx: 1, dy: 0, done: true };
    const a = path[i], b = path[i + 1], t = d / segLen[i];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: b.x - a.x, dy: b.y - a.y, done: false };
  }

  // ---- state ----
  const TOWER = {
    archer: { img: 'tower-archer', h: 215, range: 0.16, rate: 0.7, dmg: 9, cost: 70, shot: 'arrow' },
    mage: { img: 'tower-mage', h: 185, range: 0.15, rate: 1.1, dmg: 18, cost: 100, shot: 'bolt' },
    cannon: { img: 'tower-cannon', h: 150, range: 0.17, rate: 1.8, dmg: 26, cost: 125, shot: 'ball', splash: 0.05 },
  };
  const ENEMY = {
    raider: { img: 'enemy-raider', hp: 60, speed: 0.055, size: 100, gold: 6 },
    brute: { img: 'enemy-brute', hp: 260, speed: 0.032, size: 135, gold: 18 },
    kite: { img: 'enemy-kite', hp: 45, speed: 0.07, size: 112, gold: 8, fly: true },
  };
  const plots = C.plots.map(([x, y], i) => ({ x, y, tower: C.start[i] || null, cd: 0, aim: 0, recoil: 0 }));
  let spawnCount = 0, enemies = [], shots = [], fx = [], gold = 250, lives = 20, wave = 0, spawnQ = [], spawnT = 0, menu = null, t = 0;

  function nextWave() {
    wave++;
    const n = 6 + wave * 2;
    for (let i = 0; i < n; i++) spawnQ.push(i % 7 === 6 ? 'brute' : i % 4 === 3 ? 'kite' : 'raider');
  }
  nextWave();

  function spawn(type) {
    const d = ENEMY[type];
    enemies.push({ type, d, hp: d.hp, pi: spawnCount++ % PATHS.length, dist: -Math.random() * 20, off: (Math.random() - 0.5) * 0.012, phase: Math.random() * 6, hit: 0 });
  }

  // ---- input: tap an empty plot → tower ring; tap ring token → build ----
  cv.addEventListener('pointerdown', (e) => {
    const x = e.clientX, y = e.clientY;
    if (menu) {
      for (const tok of menu.tokens) if (Math.hypot(x - tok.x, y - tok.y) < tok.r) {
        const def = TOWER[tok.type];
        if (gold >= def.cost) { gold -= def.cost; menu.plot.tower = tok.type; puff(menu.plot.x, menu.plot.y, '#f5e6c4', 14); }
        menu = null; return;
      }
      menu = null; return;
    }
    const [hx, hy] = P(C.horn[0], C.horn[1]);
    if (Math.hypot(x - hx, y - hy) < 46 * U() * 1.4 && spawnQ.length === 0) { nextWave(); return; }
    for (const p of plots) {
      const [px, py] = P(p.x, p.y);
      if (!p.tower && Math.hypot(x - px, y - py) < 60 * U()) {
        const r = 95 * U(), types = Object.keys(TOWER);
        menu = { plot: p, tokens: types.map((type, i) => { const a = -Math.PI / 2 + (i - 1) * 1.15; return { type, x: px + Math.cos(a) * r, y: py + Math.sin(a) * r, r: 46 * U() }; }) };
        return;
      }
    }
  });

  function puff(x, y, color, n) { for (let i = 0; i < n; i++) fx.push({ kind: 'puff', x, y, vx: (Math.random() - 0.5) * 0.06, vy: (Math.random() - 0.8) * 0.05, life: 0.5 + Math.random() * 0.3, t: 0, color }); }

  // ---- update ----
  function update(dt) {
    t += dt;
    spawnT -= dt;
    if (spawnQ.length && spawnT <= 0) { spawn(spawnQ.shift()); spawnT = 0.75; }
    for (const e of enemies) {
      e.dist += e.d.speed * dt * 100;
      e.hit = Math.max(0, e.hit - dt * 4);
      const a = along(Math.max(0, e.dist), e.pi);
      e.x = a.x; e.y = a.y + e.off; e.face = a.dx * 16 >= 0 ? 1 : -1;
      if (a.done) { e.dead = true; lives = Math.max(0, lives - (e.type === 'brute' ? 3 : 1)); }
    }
    for (const p of plots) {
      if (!p.tower) continue;
      const def = TOWER[p.tower];
      p.cd -= dt; p.recoil = Math.max(0, p.recoil - dt * 5);
      if (p.cd > 0) continue;
      let best = null;
      for (const e of enemies) {
        if (e.dead || e.dist < 0) continue;
        if (e.d.fly && p.tower === 'cannon') continue;
        const dd = Math.hypot((e.x - p.x) * 16 / 9, e.y - p.y);
        if (dd < def.range * 1.8 && (!best || e.dist > best.dist)) best = e;
      }
      if (best) {
        p.cd = def.rate; p.recoil = 1; p.aim = best.x > p.x ? 1 : -1;
        const top = def.shot === 'ball' ? 0.035 : 0.075;
        shots.push({ kind: def.shot, x: p.x, y: p.y - top, sx: p.x, sy: p.y - top, target: best, t: 0, dur: def.shot === 'ball' ? 0.7 : 0.28, dmg: def.dmg, splash: def.splash || 0 });
      }
    }
    for (const s of shots) {
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const tx = s.target.x, ty = s.target.y - (s.target.d.fly ? 0.07 : 0.025);
      s.x = s.sx + (tx - s.sx) * k; s.y = s.sy + (ty - s.sy) * k - (s.kind === 'ball' ? Math.sin(k * Math.PI) * 0.09 : 0);
      if (k >= 1) {
        s.done = true;
        const hitOne = (e, dmg) => { if (e.dead) return; e.hp -= dmg; e.hit = 1; if (e.hp <= 0) { e.dead = true; gold += e.d.gold; puff(e.x, e.y - 0.02, '#fff3d6', 10); fx.push({ kind: 'coin', x: e.x, y: e.y - 0.05, t: 0, life: 0.8 }); } };
        if (s.splash) { for (const e of enemies) if (!e.d.fly && Math.hypot((e.x - tx) * 16 / 9, e.y - ty) < s.splash * 1.8) hitOne(e, s.dmg); puff(tx, ty, '#f2b35a', 16); fx.push({ kind: 'ring', x: tx, y: ty, t: 0, life: 0.35 }); }
        else { hitOne(s.target, s.dmg); if (s.kind === 'bolt') fx.push({ kind: 'spark', x: tx, y: ty, t: 0, life: 0.3 }); }
      }
    }
    for (const f of fx) { f.t += dt; if (f.vx !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 0.08 * dt; } }
    enemies = enemies.filter((e) => !e.dead); shots = shots.filter((s) => !s.done); fx = fx.filter((f) => f.t < f.life);
  }

  // ---- draw helpers ----
  function sprite(name, nx, ny, hPx, opts = {}) {
    const im = IMG[name]; if (!im || !im.naturalWidth) return;
    const [x, y] = P(nx, ny);
    const h = hPx * U(), w = h * im.naturalWidth / im.naturalHeight;
    ctx.save(); ctx.translate(x, y);
    if (opts.rot) ctx.rotate(opts.rot);
    ctx.scale((opts.flip ? -1 : 1) * (opts.sx || 1), opts.sy || 1);
    if (opts.flash) ctx.filter = `brightness(${1 + opts.flash * 0.9})`;
    ctx.drawImage(im, -w / 2, -h, w, h);
    ctx.restore();
  }
  function shadow(nx, ny, r, a = 0.28) { const [x, y] = P(nx, ny); ctx.fillStyle = `rgba(40,30,20,${a})`; ctx.beginPath(); ctx.ellipse(x, y, r * U(), r * 0.42 * U(), 0, 0, Math.PI * 2); ctx.fill(); }
  function text(s, x, y, size, align = 'left') { ctx.font = `900 ${size}px "Trebuchet MS", "Arial Rounded MT Bold", sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineWidth = size * 0.18; ctx.strokeStyle = '#3a2412'; ctx.strokeText(s, x, y); ctx.fillStyle = '#fff4dc'; ctx.fillText(s, x, y); }
  function ui(name, x, y, w) { const im = IMG[name]; if (!im || !im.naturalWidth) return 0; const h = w * im.naturalHeight / im.naturalWidth; ctx.drawImage(im, x, y, w, h); return h; }

  // ---- draw ----
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#7fb6e6'; ctx.fillRect(0, 0, W, H);
    const m = IMG[C.img];
    if (m.naturalWidth) ctx.drawImage(m, view.x, view.y, view.mw * view.s, view.mh * view.s);

    // empty plots highlight when menu open
    if (menu) { const [px, py] = P(menu.plot.x, menu.plot.y); ctx.strokeStyle = 'rgba(255,240,180,0.9)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(px, py, 62 * U(), 28 * U(), 0, 0, Math.PI * 2); ctx.stroke(); }

    // depth-sorted world objects
    const items = [];
    for (const p of plots) if (p.tower) items.push({ y: p.y, draw: () => {
      const bob = p.recoil * 0.06;
      sprite(TOWER[p.tower].img, p.x, p.y + 0.034, TOWER[p.tower].h, { sy: 1 - bob, sx: 1 + bob * 0.5, flip: p.aim < 0 && p.tower === 'archer' });
    } });
    for (const e of enemies) {
      if (e.dist < 0) continue;
      items.push({ y: e.y + (e.d.fly ? 0.2 : 0), draw: () => {
        const step = Math.sin(t * (e.d.fly ? 5 : 11) + e.phase);
        const lift = e.d.fly ? 0.065 + step * 0.008 : Math.abs(step) * 0.006;
        shadow(e.x, e.y, e.d.fly ? 26 : e.d.size * 0.3, e.d.fly ? 0.16 : 0.3);
        sprite(e.d.img, e.x, e.y - lift, e.d.size, { flip: e.face < 0, rot: e.d.fly ? step * 0.05 : step * 0.07, sy: 1 - Math.abs(step) * 0.04, flash: e.hit });
        // hp bar
        if (e.hp < e.d.hp) { const [x, y] = P(e.x, e.y - lift); const w = 44 * U(), hb = 6 * U(), yy = y - e.d.size * U() - 10 * U(); ctx.fillStyle = '#3a2412'; ctx.fillRect(x - w / 2 - 2, yy - 2, w + 4, hb + 4); ctx.fillStyle = '#8b1e1e'; ctx.fillRect(x - w / 2, yy, w, hb); ctx.fillStyle = '#7cd34a'; ctx.fillRect(x - w / 2, yy, w * Math.max(0, e.hp / e.d.hp), hb); }
      } });
    }
    items.sort((a, b) => a.y - b.y).forEach((i) => i.draw());

    // shots + fx
    for (const s of shots) {
      const [x, y] = P(s.x, s.y);
      if (s.kind === 'arrow') { const [tx, ty] = P(s.target.x, s.target.y); const a = Math.atan2(ty - y, tx - x); ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = '#5a3a1a'; ctx.fillRect(-14 * U(), -1.5 * U(), 28 * U(), 3 * U()); ctx.fillStyle = '#e8e2d0'; ctx.fillRect(10 * U(), -3 * U(), 6 * U(), 6 * U()); ctx.restore(); }
      else if (s.kind === 'bolt') { const g = ctx.createRadialGradient(x, y, 0, x, y, 18 * U()); g.addColorStop(0, 'rgba(230,250,255,1)'); g.addColorStop(0.4, 'rgba(120,200,255,0.9)'); g.addColorStop(1, 'rgba(60,120,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 18 * U(), 0, Math.PI * 2); ctx.fill(); }
      else { ctx.fillStyle = '#2b2b2b'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 8 * U(), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
    for (const f of fx) {
      const [x, y] = P(f.x, f.y), k = f.t / f.life;
      if (f.kind === 'puff') { ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(x, y, (6 + k * 10) * U(), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      else if (f.kind === 'ring') { ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffd98a'; ctx.lineWidth = 5 * U(); ctx.beginPath(); ctx.ellipse(x, y, (20 + k * 60) * U(), (9 + k * 26) * U(), 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
      else if (f.kind === 'spark') { ctx.globalAlpha = 1 - k; ctx.fillStyle = '#bfefff'; for (let i = 0; i < 6; i++) { const a = i * 1.047 + k; ctx.beginPath(); ctx.arc(x + Math.cos(a) * k * 30 * U(), y + Math.sin(a) * k * 30 * U(), 3 * U(), 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1; }
      else if (f.kind === 'coin') { const im = IMG['icon-gold']; if (im.naturalWidth) { ctx.globalAlpha = 1 - k * k; const s = 34 * U(); ctx.drawImage(im, x - s / 2, y - s / 2 - k * 40 * U(), s, s); ctx.globalAlpha = 1; } }
    }

    // build ring
    if (menu) for (const tok of menu.tokens) {
      ui('ui-button', tok.x - tok.r, tok.y - tok.r, tok.r * 2);
      const im = IMG[TOWER[tok.type].img]; if (im.naturalWidth) { const h = tok.r * 1.35, w = h * im.naturalWidth / im.naturalHeight; ctx.drawImage(im, tok.x - w / 2, tok.y - h * 0.62, w, h); }
      text(String(TOWER[tok.type].cost), tok.x, tok.y + tok.r * 0.95, 18 * Math.max(0.8, U()), 'center');
    }

    // HUD
    const s = Math.min(1.2, Math.max(0.7, W / 1600));
    const ph = ui('ui-plaque', 14, 12, 330 * s);
    if (ph) {
      const im = IMG['icon-heart']; if (im.naturalWidth) ctx.drawImage(im, 14 + 38 * s, 12 + ph / 2 - 22 * s, 44 * s, 44 * s);
      text(String(lives), 14 + 92 * s, 12 + ph / 2, 34 * s);
      const ig = IMG['icon-gold']; if (ig.naturalWidth) ctx.drawImage(ig, 14 + 170 * s, 12 + ph / 2 - 24 * s, 48 * s, 48 * s);
      text(String(gold), 14 + 226 * s, 12 + ph / 2, 34 * s);
    }
    const bw = 300 * s, bh = ui('ui-banner', W - bw - 16, 6, bw);
    if (bh) text(`Wave ${wave}/12`, W - bw / 2 - 16, 6 + bh * 0.5, 30 * s, 'center');
    const [hx, hy] = P(C.horn[0], C.horn[1]);
    const hr = 46 * U() * 1.3 * (spawnQ.length === 0 ? 1 + Math.sin(t * 5) * 0.06 : 0.85);
    ctx.globalAlpha = spawnQ.length === 0 ? 1 : 0.55; ui('ui-horn', hx - hr, hy - hr, hr * 2); ctx.globalAlpha = 1;
    if (loaded < names.length) text('loading…', W / 2, H / 2, 28, 'center');
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (IMG[C.img].naturalWidth && view.mw !== IMG[C.img].naturalWidth) resize();
    update(dt); draw();
    requestAnimationFrame(frame);
  }
  resize();
  requestAnimationFrame(frame);
  window.__proto = { get state() { return { enemies: enemies.length, gold, lives, wave, plots: plots.map((p) => p.tower) }; } };
})();
