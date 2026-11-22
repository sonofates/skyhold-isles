// In-page UI audit (runs inside the browser through page.evaluate): every visible text of the painted
// DOM UI is measured against the box it sits in.
//
//  - overflow:  an element's text is wider / taller than its box (scrollWidth > clientWidth on a box
//               that clips or truncates; or text spilling past a visible box).
//  - clipped:   text cut by an ancestor with overflow hidden / clip (scroll containers: only sideways).
//  - offscreen: text outside the viewport.
//  - frame:     text not inside the painted piece's safe zone (the 9-sliced art's parchment / cloth /
//               plank face, between the corner rivets, ribbon tails and tab notches), with a minimum
//               gap; the art geometry is mapped through the element's real border-image slices.
//  - cramped:   a CSS-drawn card (background / border, no art) whose text comes closer than the
//               minimum padding to its edge.
//  - covered:   a badge / close button / check / ribbon overlay lying over text.
//  - font:      a glyph that is not drawn with Fredoka (falls back to another font).
//
// `auditPage(opts)` returns { problems: [{kind, text, detail}], stats }.

export function auditPage(opts) {
  const o = { minGapEm: 0.28, minGapPx: 4, minGapYPx: 2, cardPadEm: 0.35, roots: '.pu', ...opts };
  // Art geometry (art px): `safe` = where text may sit; `keep` = painted bits inside it (brackets).
  // Zones: per-class safe zones (the sheet title sits on the ribbon).
  const ART = {
    // Parchment inside the gold frame; the ribbon's curled tails and the four gold brackets are
    // keep-outs (they lie on the parchment's corners in the art).
    'end-panel': { w: 1024, h: 674, safe: [104, 165, 920, 598], keep: [[100, 140, 210, 206], [814, 140, 924, 206], [55, 180, 146, 268], [878, 180, 970, 268], [55, 566, 146, 672], [878, 566, 970, 672]], zones: { 'pu-sheet-title': [190, 16, 834, 150] } },
    'end-panel-defeat': { w: 1024, h: 674, safe: [104, 165, 920, 598], keep: [[100, 140, 210, 206], [814, 140, 924, 206], [55, 180, 146, 268], [878, 180, 970, 268], [55, 566, 146, 672], [878, 566, 970, 672]], zones: { 'pu-sheet-title': [190, 16, 834, 150] } },
    'ui-plaque': { w: 512, h: 141, safe: [62, 20, 450, 121], zones: { 'pu-bar': [24, 0, 488, 141] } },
    'button-go': { w: 512, h: 141, safe: [40, 24, 472, 117] },
    'tab-active': { w: 320, h: 110, safe: [46, 12, 284, 98] },
    'tab-idle': { w: 320, h: 110, safe: [34, 12, 286, 98] },
    'price-tag': { w: 360, h: 130, safe: [104, 22, 340, 108], zones: { 'pu-tag-ring': [4, 4, 112, 126], 'pu-skill-num': [4, 4, 112, 126] } },
    tooltip: { w: 640, h: 490, safe: [40, 38, 600, 452] },
    'ui-banner': { w: 512, h: 152, safe: [80, 36, 432, 116] },
    'story-frame': { w: 1600, h: 900, safe: [70, 60, 1530, 840], zones: { 'pu-sheet-title': [300, 0, 1300, 160] } },
    'slider-track': { w: 512, h: 64, safe: [0, 0, 512, 64] },
  };
  const OVERLAYS = '.pu-badge, .pu-sheet-close, .pu-dot, .pu-hard-ribbon, .pu-mode-check, .pu-skill-badge, .pu-hero-lvl, .ab2d-key, .pu-key';
  const problems = [];
  const W = window.innerWidth;
  const H = window.innerHeight;
  const label = (e) => {
    const c = typeof e.className === 'string' ? e.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
    const id = e.getAttribute?.('data-testid');
    return `${e.tagName.toLowerCase()}${c ? '.' + c : ''}${id ? `[${id}]` : ''}`;
  };
  const add = (kind, e, text, detail) => problems.push({ kind, at: label(e), text: (text ?? '').trim().replace(/\s+/g, ' ').slice(0, 60), detail });
  const visible = (e) => {
    for (let n = e; n && n instanceof Element; n = n.parentElement) {
      if (n.hidden) return false;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  const artOf = (e, cs) => {
    const src = cs.borderImageSource && cs.borderImageSource !== 'none' ? cs.borderImageSource : null;
    const bg = !src && cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : null;
    const url = src ?? bg;
    if (!url) return null;
    const m = /\/([\w@.-]+?)(?:@[\d.]+x)?\.(?:webp|png)/.exec(url);
    if (!m) return null;
    const spec = ART[m[1]];
    if (!spec) return null;
    return { spec, name: m[1], nine: !!src };
  };
  /** Art px → screen px through the element's 9-slice (or a plain stretch for backgrounds). */
  const mapper = (e, cs, art) => {
    const r = e.getBoundingClientRect();
    const { w: AW, h: AH } = art.spec;
    if (!art.nine) {
      return (ax, ay) => [r.left + (ax / AW) * r.width, r.top + (ay / AH) * r.height];
    }
    // A scaled / bobbing piece: border widths are untransformed, the box on screen is scaled.
    const kx = e.offsetWidth > 0 ? r.width / e.offsetWidth : 1;
    const ky = e.offsetHeight > 0 ? r.height / e.offsetHeight : 1;
    const sl = cs.borderImageSlice.replace('fill', '').trim().split(/\s+/).map(parseFloat);
    const [st, sr, sb, sll] = [sl[0], sl[1] ?? sl[0], sl[2] ?? sl[0], sl[3] ?? sl[1] ?? sl[0]];
    const bt = parseFloat(cs.borderTopWidth) * ky;
    const br = parseFloat(cs.borderRightWidth) * kx;
    const bb = parseFloat(cs.borderBottomWidth) * ky;
    const bl = parseFloat(cs.borderLeftWidth) * kx;
    const one = (a, A, s0, s1, b0, b1, start, len) => {
      if (a <= s0) return start + (a / s0) * b0;
      if (a >= A - s1) return start + len - ((A - a) / s1) * b1;
      return start + b0 + ((a - s0) / Math.max(1, A - s0 - s1)) * (len - b0 - b1);
    };
    return (ax, ay) => [one(ax, AW, sll, sr, bl, br, r.left, r.width), one(ay, AH, st, sb, bt, bb, r.top, r.height)];
  };
  const mapRect = (map, a) => {
    const [x0, y0] = map(a[0], a[1]);
    const [x1, y1] = map(a[2], a[3]);
    return { x0, y0, x1, y1 };
  };
  const textRect = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rs = Array.from(range.getClientRects()).filter((q) => q.width > 0.5 && q.height > 0.5);
    if (rs.length === 0) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const q of rs) {
      x0 = Math.min(x0, q.left);
      y0 = Math.min(y0, q.top);
      x1 = Math.max(x1, q.right);
      y1 = Math.max(y1, q.bottom);
    }
    return { x0, y0, x1, y1, lines: rs.length, rects: rs };
  };
  /** The padding box on screen (a scaled / bobbing element: client sizes are untransformed). */
  const innerBox = (a, r) => {
    const kx = a.offsetWidth > 0 ? r.width / a.offsetWidth : 1;
    const ky = a.offsetHeight > 0 ? r.height / a.offsetHeight : 1;
    const x0 = r.left + a.clientLeft * kx;
    const y0 = r.top + a.clientTop * ky;
    return { x0, y0, x1: x0 + a.clientWidth * kx, y1: y0 + a.clientHeight * ky };
  };
  const hit = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;

  // With a board open (an overlay), only the topmost board counts: what lies under the dim backdrop is not read.
  const overlays = Array.from(document.querySelectorAll('.pu-overlay')).filter((e) => visible(e) && !e.classList.contains('closing'));
  const roots = overlays.length ? [overlays[overlays.length - 1]] : Array.from(document.querySelectorAll(o.roots)).filter((r) => !r.parentElement?.closest(o.roots));
  const texts = [];
  for (const root of roots) {
    if (!visible(root)) continue;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      const pe = n.parentElement;
      if (!pe || !visible(pe)) continue;
      if (pe.closest('[role="tooltip"]') && pe.closest('[role="tooltip"]').hidden) continue;
      if (pe.closest('svg, style, script')) continue;
      const tr = textRect(n);
      if (!tr) continue;
      texts.push({ n, pe, tr });
    }
  }
  const seenOverflow = new Set();
  const chars = new Set();
  for (const item of texts) {
    const { n, pe, tr } = item;
    const txt = n.nodeValue;
    for (const ch of txt) if (ch.charCodeAt(0) > 127 && /\p{L}/u.test(ch)) chars.add(ch);
    const fs = parseFloat(getComputedStyle(pe).fontSize) || 14;
    // Scrolled out of its scroll box, or half under its edge: not a defect.
    let scrolledAway = false;
    let partlyScrolled = false;
    for (let a = pe; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const sy = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
      const sx = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
      if (!sx && !sy) continue;
      const r = a.getBoundingClientRect();
      const box = innerBox(a, r);
      if (sy && (tr.y1 <= box.y0 + 1 || tr.y0 >= box.y1 - 1)) scrolledAway = true;
      if (sx && (tr.x1 <= box.x0 + 1 || tr.x0 >= box.x1 - 1)) scrolledAway = true;
      if ((sy && (tr.y0 < box.y0 - 1 || tr.y1 > box.y1 + 1)) || (sx && (tr.x0 < box.x0 - 1 || tr.x1 > box.x1 + 1))) partlyScrolled = true;
    }
    if (scrolledAway || partlyScrolled) {
      item.scrolled = true;
      continue;
    }
    // Ancestors: clipping (a one-line label's line box is a bit shorter than the font's content
    // area: vertically only cuts deeper than 12 % of the size count).
    const tolY = 1 + fs * 0.12;
    for (let a = pe; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const ox = cs.overflowX;
      const oy = cs.overflowY;
      const r = a.getBoundingClientRect();
      const box = innerBox(a, r);
      const clipX = ox === 'hidden' || ox === 'clip';
      const clipY = oy === 'hidden' || oy === 'clip';
      if ((clipX && (tr.x0 < box.x0 - 1 || tr.x1 > box.x1 + 1)) || (clipY && (tr.y0 < box.y0 - tolY || tr.y1 > box.y1 + tolY))) {
        add('clipped', pe, txt, `cut by ${label(a)} (${Math.round(Math.max(box.x0 - tr.x0, tr.x1 - box.x1, clipY ? Math.max(box.y0 - tr.y0, tr.y1 - box.y1) : 0))}px)`);
        break;
      }
      if (a.clientWidth > 0 && cs.display !== 'inline' && !seenOverflow.has(a) && a.scrollWidth > a.clientWidth + 1 && (cs.textOverflow === 'ellipsis' || clipX)) {
        seenOverflow.add(a);
        add('overflow', a, a.textContent, `truncated: scrollWidth ${a.scrollWidth} > clientWidth ${a.clientWidth}`);
      }
    }
    if (tr.x0 < -1 || tr.y0 < -1 || tr.x1 > W + 1 || tr.y1 > H + 1) add('offscreen', pe, txt, `${Math.round(tr.x0)},${Math.round(tr.y0)}-${Math.round(tr.x1)},${Math.round(tr.y1)} of ${W}x${H}`);
    // Its own block: text spilling out of a visible box (a word wider than the box). The nearest
    // non-inline box; captions hanging under round buttons are placed there on purpose.
    let blk = pe;
    while (blk && getComputedStyle(blk).display === 'inline') blk = blk.parentElement;
    // Painted title letters (`data-c`) are tilted single glyphs: their ink may poke past the box.
    if (blk && !blk.closest('.pu-round-label') && !blk.dataset?.c) {
      const cs = getComputedStyle(blk);
      if (blk.clientWidth > 0) {
        const r = blk.getBoundingClientRect();
        if (tr.x1 > r.right + 1.5 || tr.x0 < r.left - 1.5) add('overflow', blk, txt, `text ${Math.round(tr.x1 - tr.x0)}px wide spills out of its ${Math.round(r.width)}px box`);
      }
    }
    // Nearest painted piece (art) or CSS card.
    for (let a = pe; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const art = artOf(a, cs);
      if (art) {
        const map = mapper(a, cs, art);
        let zone = art.spec.safe;
        if (art.spec.zones) {
          for (const [cls, z] of Object.entries(art.spec.zones)) {
            if (pe.closest(`.${cls}`) && a.contains(pe.closest(`.${cls}`))) zone = z;
          }
        }
        const s = mapRect(map, zone);
        const gx = Math.max(o.minGapPx, fs * o.minGapEm);
        const gy = o.minGapYPx;
        const dl = tr.x0 - s.x0;
        const dr = s.x1 - tr.x1;
        const dt = tr.y0 - s.y0;
        const db = s.y1 - tr.y1;
        if (dl < gx || dr < gx || dt < gy || db < gy) {
          const parts = [];
          if (dl < gx) parts.push(`left ${dl.toFixed(1)}`);
          if (dr < gx) parts.push(`right ${dr.toFixed(1)}`);
          if (dt < gy) parts.push(`top ${dt.toFixed(1)}`);
          if (db < gy) parts.push(`bottom ${db.toFixed(1)}`);
          add('frame', pe, txt, `in ${art.name} (${label(a)}): ${parts.join(', ')} px (min ${gx.toFixed(1)}/${gy})`);
        }
        if (zone === art.spec.safe) {
          for (const k of art.spec.keep ?? []) {
            const kr = mapRect(map, k);
            if (hit(tr, kr)) add('frame', pe, txt, `over a painted bracket of ${art.name}`);
          }
        }
        break;
      }
      // CSS-drawn card: a background colour / gradient or a visible border, not a plain text run.
      const bgOn = (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) || /gradient/.test(cs.backgroundImage);
      const bdOn = parseFloat(cs.borderLeftWidth) >= 1 && cs.borderLeftStyle !== 'none' && parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none';
      if ((bgOn || bdOn) && cs.display !== 'inline') {
        const r = a.getBoundingClientRect();
        const g = Math.max(3, fs * o.cardPadEm);
        const rad = parseFloat(cs.borderTopLeftRadius) || 0;
        // Pills (radius ≈ half the height) need the radius as side padding.
        const gxs = Math.max(g, Math.min(rad, r.height / 2) * 0.35);
        const dl = tr.x0 - r.left;
        const dr = r.right - tr.x1;
        const dt = tr.y0 - r.top;
        const db = r.bottom - tr.y1;
        // Round badges (a number in a disc): the text only has to fit the disc.
        const round = Math.abs(r.width - r.height) < r.height * 0.3 && rad >= r.height * 0.4;
        const bad = round ? tr.x1 - tr.x0 > r.width * 0.86 || tr.y1 - tr.y0 > r.height * 1.05 : dl < gxs || dr < gxs || dt < 0 || db < 0;
        if (r.width > 8 && r.height > 8 && bad) {
          add('cramped', pe, txt, `card ${label(a)}: left ${dl.toFixed(1)} right ${dr.toFixed(1)} top ${dt.toFixed(1)} bottom ${db.toFixed(1)} (min ${gxs.toFixed(1)})`);
        }
        break;
      }
      if (a.matches(o.roots)) break;
    }
  }
  // Overlays over text.
  for (const ov of document.querySelectorAll(OVERLAYS)) {
    if (!visible(ov)) continue;
    const r = ov.getBoundingClientRect();
    if (r.width < 2) continue;
    const orr = { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
    for (const { pe, tr, n, scrolled } of texts) {
      if (scrolled || ov.contains(pe) || pe.contains(ov)) continue;
      // Only text in the same piece (the overlay's parent button / card).
      const host = ov.parentElement;
      if (!host || !host.contains(pe)) continue;
      if (hit(orr, tr)) add('covered', pe, n.nodeValue, `under ${label(ov)}`);
    }
  }
  // Buttons cut by the screen or by their board's scroll box (the main action must be reachable
  // without scrolling: Play, Set sail, Next isle...).
  for (const root of roots) {
    for (const b of root.querySelectorAll('button')) {
      if (!visible(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const main = b.classList.contains('primary');
      // A list that scrolls (Settings rows, Logbook, the skill tree, the sideways sea) may hide
      // buttons on purpose; a main action may not be hidden that way.
      let inScroller = false;
      let cut = null;
      for (let a = b.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        const scrolls = /auto|scroll/.test(cs.overflowY + cs.overflowX);
        if (scrolls && (a.scrollHeight > a.clientHeight + 1 || a.scrollWidth > a.clientWidth + 1)) inScroller = true;
        if (cut || (cs.overflowY === 'visible' && cs.overflowX === 'visible')) continue;
        const q = a.getBoundingClientRect();
        const y0 = q.top + a.clientTop;
        const y1 = y0 + a.clientHeight;
        if (r.bottom > y1 + 1 || r.top < y0 - 1) cut = label(a);
      }
      if (!cut && (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1)) cut = 'the screen';
      if (cut && (main || !inScroller)) add('cut', b, b.textContent, `${main ? 'main action ' : ''}cut by ${cut}`);
    }
  }
  // Text over other text (labels colliding): line boxes of different texts, shrunk a little (a
  // line box is taller than its letters).
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      if (a.pe === b.pe || a.scrolled || b.scrolled) continue;
      // One word's painted letters (the title lettering: a span per letter, `data-c`) touch on purpose.
      if (a.pe.parentElement === b.pe.parentElement && a.pe.dataset?.c && b.pe.dataset?.c) continue;
      let clash = false;
      for (const p of a.tr.rects) {
        for (const q of b.tr.rects) {
          const ix = Math.min(p.right, q.right) - Math.max(p.left, q.left);
          const iy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
          if (ix > 2 && iy > Math.min(p.height, q.height) * 0.3) clash = true;
        }
      }
      if (clash) add('overlap', a.pe, a.n.nodeValue, `collides with "${b.n.nodeValue.trim().slice(0, 30)}" (${label(b.pe)})`);
    }
  }
  // Fonts: a glyph Fredoka lacks renders in the fallback (two fallbacks of different widths).
  const cv = document.createElement('canvas').getContext('2d');
  const wOf = (ch, fb) => {
    cv.font = `700 48px "Fredoka Variable", "Fredoka TR", ${fb}`;
    return cv.measureText(ch).width;
  };
  const fallback = [];
  for (const ch of [...chars, 'A', 'ş', 'ğ', 'ı', 'İ', 'ç', 'ö', 'ü', 'Ş', 'Ğ', 'Ç', 'Ö', 'Ü']) {
    if (/\s|[ -⁯]/.test(ch)) continue;
    if (Math.abs(wOf(ch, 'monospace') - wOf(ch, 'serif')) > 0.01) fallback.push(ch);
  }
  if (fallback.length) problems.push({ kind: 'font', at: 'document', text: [...new Set(fallback)].join(' '), detail: 'not drawn with Fredoka' });
  const faces = [];
  document.fonts.forEach((f) => {
    if (/Fredoka/.test(f.family)) faces.push(`${f.unicodeRange.slice(0, 14)}:${f.status}`);
  });
  // Fonts actually used by the text (family resolution).
  for (const { pe, n } of texts) {
    const fam = getComputedStyle(pe).fontFamily;
    if (!/Fredoka/.test(fam.split(',')[0])) {
      add('font', pe, n.nodeValue, `font-family ${fam.split(',')[0]}`);
    }
  }
  return { problems, stats: { texts: texts.length, chars: [...chars].join(''), faces } };
}
