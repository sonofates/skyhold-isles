// Skyhold 2D map editor: trace paths, plots, entrances and goal on a painted map.
// Output JSON (image px): { id, image, imageSize, safeArea:[x,y,w,h], entrances, goal, paths, plots }
// Serve the repo root (python3 -m http.server) and open /tools/map-editor/?img=<path>&id=<levelId>
(() => {
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const q = new URLSearchParams(location.search);
  $('imgPath').value = q.get('img') || '/design/art-2d/out/map-L1c-wide.png';
  const img = new Image();
  let zoom = 0.6, mode = 'path', cur = 0, drag = null, walkT = -1;
  let st = { id: q.get('id') || 'l1c', image: '', imageSize: [0, 0], safeArea: [0, 0, 0, 0], paths: [[]], plots: [], goal: null };
  const undo = [];
  const snap = () => { undo.push(JSON.stringify(st)); if (undo.length > 200) undo.shift(); };
  const t0 = Date.now();
  setInterval(() => { $('timer').textContent = `editing for ${((Date.now() - t0) / 60000).toFixed(1)} min`; }, 5000);

  function safeArea(w, h) { // centred 16:9 inside the image
    const sw = Math.min(w, Math.round(h * 16 / 9)), sh = Math.round(sw * 9 / 16);
    return [Math.round((w - sw) / 2), Math.round((h - sh) / 2), sw, sh];
  }
  function loadImage(src) {
    img.onload = () => {
      st.image = src.split('/').pop().replace(/\.png$/, '');
      st.imageSize = [img.naturalWidth, img.naturalHeight];
      st.safeArea = safeArea(img.naturalWidth, img.naturalHeight);
      $('imgInfo').textContent = `${img.naturalWidth}×${img.naturalHeight} (aspect ${(img.naturalWidth / img.naturalHeight).toFixed(3)})`;
      zoom = Math.max(0.25, Math.min(1, ((window.innerWidth || 1600) - 320) / img.naturalWidth));
      refreshSel(); draw();
    };
    img.src = src;
  }
  $('loadImg').onclick = () => loadImage($('imgPath').value);

  function refreshSel() {
    $('pathSel').innerHTML = st.paths.map((_, i) => `<option value="${i}">path ${i} (${i === 0 ? 'entrance A' : 'entrance ' + String.fromCharCode(65 + i)})</option>`).join('');
    $('pathSel').value = String(cur);
  }
  $('pathSel').onchange = (e) => { cur = +e.target.value; draw(); };
  $('addPath').onclick = () => { snap(); st.paths.push([]); cur = st.paths.length - 1; refreshSel(); draw(); };
  $('delPath').onclick = () => { if (st.paths.length < 2) return; snap(); st.paths.splice(cur, 1); cur = 0; refreshSel(); draw(); };
  document.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => {
    mode = b.dataset.mode; document.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
  });
  ['showSafe', 'thick', 'plotR'].forEach((k) => $(k).oninput = draw);

  const toImg = (e) => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / zoom), Math.round((e.clientY - r.top) / zoom)]; };
  const near = (a, b, d) => Math.hypot(a[0] - b[0], a[1] - b[1]) < d;

  function hit(p) {
    const R = 14 / zoom;
    for (let pi = 0; pi < st.paths.length; pi++) for (let i = 0; i < st.paths[pi].length; i++) if (near(st.paths[pi][i], p, R)) return { kind: 'path', pi, i };
    for (let i = 0; i < st.plots.length; i++) if (near(st.plots[i], p, Math.max(R, +$('plotR').value * 0.6))) return { kind: 'plot', i };
    if (st.goal && near(st.goal, p, R)) return { kind: 'goal' };
    return null;
  }
  function segInsertIndex(path, p) {
    let best = path.length, bd = Infinity;
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1], [bx, by] = path[i];
      const vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / (vx * vx + vy * vy || 1)));
      const d = Math.hypot(ax + vx * t - p[0], ay + vy * t - p[1]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  cv.addEventListener('mousedown', (e) => {
    const p = toImg(e), h = hit(p);
    if (e.altKey) { // delete
      if (!h) return; snap();
      if (h.kind === 'path') st.paths[h.pi].splice(h.i, 1); else if (h.kind === 'plot') st.plots.splice(h.i, 1); else st.goal = null;
      draw(); return;
    }
    if (h) { snap(); drag = h; return; }
    snap();
    if (mode === 'path') {
      const path = st.paths[cur];
      if ($('insertMode').checked && path.length > 1) path.splice(segInsertIndex(path, p), 0, p); else path.push(p);
    } else if (mode === 'plot') st.plots.push(p);
    else st.goal = p;
    draw();
  });
  cv.addEventListener('mousemove', (e) => {
    if (!drag) return; const p = toImg(e);
    if (drag.kind === 'path') st.paths[drag.pi][drag.i] = p; else if (drag.kind === 'plot') st.plots[drag.i] = p; else st.goal = p;
    draw();
  });
  window.addEventListener('mouseup', () => { drag = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.2, Math.min(3, zoom * (e.deltaY < 0 ? 1.1 : 0.9))); draw(); }, { passive: false });
  window.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'z' && undo.length) { st = JSON.parse(undo.pop()); refreshSel(); draw(); } });

  function exportJson() {
    const out = {
      id: st.id, image: st.image, imageSize: st.imageSize, safeArea: st.safeArea,
      entrances: st.paths.map((p, i) => ({ id: i === 0 ? 'A' : String.fromCharCode(65 + i), x: p[0]?.[0], y: p[0]?.[1] })),
      goal: st.goal || st.paths[0][st.paths[0].length - 1] || null,
      paths: st.paths, plots: st.plots,
    };
    return JSON.stringify(out, null, 1);
  }
  $('export').onclick = () => { $('json').value = exportJson(); navigator.clipboard?.writeText($('json').value).catch(() => {}); };
  $('import').onclick = () => {
    try { const j = JSON.parse($('json').value); snap(); st = { ...st, ...j, paths: j.paths || [[]], plots: j.plots || [] }; cur = 0; refreshSel(); draw(); } catch (err) { alert(err); }
  };
  $('download').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportJson()], { type: 'application/json' })); a.download = `${st.id}.json`; a.click(); };
  $('walk').onclick = () => { walkT = 0; };

  function checks() {
    const [sx, sy, sw, sh] = st.safeArea, inside = ([x, y]) => x >= sx && x <= sx + sw && y >= sy && y <= sy + sh;
    const out = [];
    st.paths.forEach((p, i) => { const bad = p.filter((q) => !inside(q)).length; out.push(`<div class="${bad ? 'warn' : 'ok'}">path ${i}: ${p.length} pts${bad ? `, ${bad} outside safe area` : ''}</div>`); });
    const badPlots = st.plots.filter((q) => !inside(q)).length;
    out.push(`<div class="${badPlots ? 'warn' : 'ok'}">plots: ${st.plots.length}${badPlots ? `, ${badPlots} outside safe area` : ''}</div>`);
    if (st.goal && !inside(st.goal)) out.push('<div class="warn">goal outside safe area</div>');
    $('checks').innerHTML = out.join('');
    $('safeInfo').textContent = `x ${sx}, y ${sy}, ${sw}×${sh}`;
  }

  function posOn(path, d) {
    for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); if (d <= l) { const t = d / l; return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t]; } d -= l; }
    return null;
  }

  function draw() {
    if (!img.naturalWidth) return;
    const W = img.naturalWidth, H = img.naturalHeight;
    cv.width = Math.round(W * zoom); cv.height = Math.round(H * zoom);
    ctx.setTransform(zoom, 0, 0, zoom, 0, 0);
    ctx.drawImage(img, 0, 0);
    if ($('showSafe').checked) {
      const [sx, sy, sw, sh] = st.safeArea;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, sx, H); ctx.fillRect(sx + sw, 0, W - sx - sw, H); ctx.fillRect(sx, 0, sw, sy); ctx.fillRect(sx, sy + sh, sw, H - sy - sh);
      ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 3 / zoom; ctx.setLineDash([12 / zoom, 8 / zoom]); ctx.strokeRect(sx, sy, sw, sh); ctx.setLineDash([]);
    }
    const colors = ['#ff3b30', '#2f9bff', '#a14dff', '#ff9f0a'];
    st.paths.forEach((p, pi) => {
      if (!p.length) return;
      ctx.strokeStyle = colors[pi % 4]; ctx.globalAlpha = $('thick').checked ? 0.35 : 1;
      ctx.lineWidth = $('thick').checked ? +$('plotR').value * 1.1 : 3 / zoom; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 3 / zoom; ctx.beginPath(); p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      p.forEach(([x, y], i) => { ctx.fillStyle = i === 0 ? '#fff' : colors[pi % 4]; ctx.beginPath(); ctx.arc(x, y, (i === 0 ? 9 : 6) / zoom, 0, Math.PI * 2); ctx.fill(); });
    });
    const R = +$('plotR').value;
    st.plots.forEach(([x, y], i) => { ctx.strokeStyle = '#30d158'; ctx.lineWidth = 4 / zoom; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#30d158'; ctx.font = `${16 / zoom}px sans-serif`; ctx.fillText(String(i), x - 5 / zoom, y + 5 / zoom); });
    if (st.goal) { ctx.fillStyle = '#ffd60a'; ctx.beginPath(); ctx.arc(st.goal[0], st.goal[1], 12 / zoom, 0, Math.PI * 2); ctx.fill(); }
    if (walkT >= 0) {
      st.paths.forEach((p, pi) => { const q2 = posOn(p, walkT); if (q2) { ctx.fillStyle = '#fff'; ctx.strokeStyle = colors[pi % 4]; ctx.lineWidth = 4 / zoom; ctx.beginPath(); ctx.arc(q2[0], q2[1], 14 / zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } });
    }
    checks();
  }
  function tick() { if (walkT >= 0) { walkT += 9; if (walkT > 6000) walkT = -1; draw(); } requestAnimationFrame(tick); }
  tick();

  // optional: preload an existing JSON
  const pre = q.get('json');
  loadImage($('imgPath').value);
  if (pre) fetch(pre).then((r) => r.json()).then((j) => { $('json').value = JSON.stringify(j, null, 1); setTimeout(() => $('import').click(), 300); }).catch(() => {});
  window.__editor = { get state() { return st; }, set state(v) { st = v; refreshSel(); draw(); }, exportJson };
})();
