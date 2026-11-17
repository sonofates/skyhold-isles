import { buildArtMatrix, type ArtRow, type MatrixCell } from './artResolve.ts';
import type { LoadedArt } from './assets2d.ts';

const ENEMY_COLS = ['front', 'back', 'down', 'up', 'mound'] as const;
const TOWER_COLS = ['t1', 't2', 't3'] as const;

function cell(c: MatrixCell | undefined): string {
  return c === true ? '<b class="ok">✓</b>' : c === false ? '<b class="no">✗</b>' : '<i>·</i>';
}

function rowHtml(r: ArtRow, cols: readonly string[]): string {
  const label = r.kind === 'enemy' && r.types.length > 0 && r.types.join(',') !== r.id ? `${r.id} <i>(${r.types.join(',')})</i>` : r.id;
  const cls = r.complete ? 'done' : r.effective.startsWith('→') || r.effective === 'missing' ? 'pending' : 'partial';
  return `<tr class="${cls}"><td class="id">${label}</td>${cols.map((c) => `<td>${cell(r.cells[c])}</td>`).join('')}<td class="eff">${r.effective}</td></tr>`;
}

/** Text summary (also exposed on `window.__p0` for QA scripts). */
export function artCheckSummary(art: LoadedArt): { rows: ArtRow[]; filesPresent: number; filesMissing: number } {
  const rows = buildArtMatrix(art.manifest, (p) => art.present.has(p));
  let present = 0;
  let missing = 0;
  for (const r of rows) {
    for (const v of Object.values(r.cells)) {
      if (v === true) present++;
      else if (v === false) missing++;
    }
  }
  return { rows, filesPresent: present, filesMissing: missing };
}

/**
 * `?artcheck=1`: a compact dev overlay listing, per enemy art and tower, which manifest files are
 * present (✓) or still missing (✗) and what is drawn in their place. Does not take pointer input.
 */
export function mountArtCheck(art: LoadedArt): HTMLElement {
  const { rows, filesPresent, filesMissing } = artCheckSummary(art);
  const el = document.createElement('div');
  el.id = 'artcheck';
  el.setAttribute('data-testid', 'artcheck');
  const enemies = rows.filter((r) => r.kind === 'enemy');
  const towers = rows.filter((r) => r.kind === 'tower');
  el.innerHTML = `
    <style>
      #artcheck{position:fixed;left:6px;top:6px;z-index:50;max-height:calc(100% - 12px);overflow:hidden;pointer-events:none;
        background:rgba(24,16,8,.86);color:#fff4dc;font:600 10px/1.15 ui-monospace,Menlo,monospace;padding:6px 8px;border-radius:6px;
        display:grid;grid-template-columns:auto auto;gap:2px 14px;align-items:start}
      #artcheck h4{margin:0 0 3px;font:700 11px/1.1 ui-monospace,Menlo,monospace;color:#ffe27a;grid-column:1/-1}
      #artcheck table{border-collapse:collapse}
      #artcheck th{color:#b9a483;font-weight:600;padding:0 3px;text-align:center}
      #artcheck td{padding:0 3px;text-align:center;white-space:nowrap}
      #artcheck td.id{text-align:left;color:#fff}
      #artcheck td.eff{text-align:left;color:#b9a483}
      #artcheck i{color:#8a7a60;font-style:normal}
      #artcheck .ok{color:#7cd34a}#artcheck .no{color:#ff7a6a}
      #artcheck tr.pending td.id{color:#ffb4a0}#artcheck tr.done td.id{color:#bff0a0}
    </style>
    <h4>art2d · ${filesPresent} files present · ${filesMissing} missing</h4>
    <table><tr><th></th>${ENEMY_COLS.map((c) => `<th>${c}</th>`).join('')}<th></th></tr>${enemies.map((r) => rowHtml(r, ENEMY_COLS)).join('')}</table>
    <table><tr><th></th>${TOWER_COLS.map((c) => `<th>${c}</th>`).join('')}<th></th></tr>${towers.map((r) => rowHtml(r, TOWER_COLS)).join('')}</table>`;
  document.body.appendChild(el);
  return el;
}
