import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHALLENGES } from '../../src/data/challenges.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { ENDLESS_TIERS } from '../../src/data/endlessMutators.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { specializationsFor, TOWER_DEFS } from '../../src/data/towers.ts';
import { WORKSHOP_BRANCHES, WORKSHOP_UPGRADES } from '../../src/data/workshop.ts';
import { FEATS } from '../../src/game/feats.ts';
import { DATA_TR } from '../../src/i18n/dataTr.ts';
import {
  abilityDesc,
  abilityName,
  challengeName,
  enemyCounter,
  islandName,
  specDesc,
  specName,
  specRole,
  stripKeyHints,
  tagName,
  towerName,
  upgradeRankText,
} from '../../src/i18n/data.ts';
import { EN, type Msg } from '../../src/i18n/en.ts';
import { localeFromTag, lower, setLocale, t, tIn, upper } from '../../src/i18n/index.ts';
import { TR } from '../../src/i18n/tr.ts';
import { eliteEntry, ENEMY_LORE, TOWER_LORE } from '../../src/ui/content/codexData.ts';

const forms = (m: Msg): string[] => (typeof m === 'string' ? [m] : [m.one, m.other]);
const params = (m: Msg): string[] => [...new Set(forms(m).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1])))].sort();

afterEach(() => setLocale('en'));

describe('i18n dictionaries', () => {
  it('every EN key exists in TR and vice versa', () => {
    const en = Object.keys(EN).sort();
    const tr = Object.keys(TR).sort();
    expect(tr.filter((k) => !(k in EN))).toEqual([]);
    expect(en.filter((k) => !(k in TR))).toEqual([]);
  });

  it('TR messages are non-empty and use the same {params} as EN', () => {
    for (const k of Object.keys(EN) as (keyof typeof EN)[]) {
      const tr = TR[k];
      for (const s of forms(tr)) expect(s.trim(), k).not.toBe('');
      expect(params(tr), k).toEqual(params(EN[k]));
    }
  });

  it('plural messages carry {n}', () => {
    for (const [k, m] of Object.entries({ ...EN, ...TR })) if (typeof m !== 'string') expect(params(m), k).toContain('n');
  });

  it('TR is really Turkish (not copied English) for sentences', () => {
    const same = (Object.keys(EN) as (keyof typeof EN)[]).filter((k) => {
      const e = forms(EN[k]).join('|');
      return / [a-z]{3,}/.test(e) && e === forms(TR[k]).join('|');
    });
    expect(same).toEqual([]);
  });
});

describe('t()', () => {
  it('interpolates and picks EN plurals by n', () => {
    expect(t('brief.waves', { n: 1 })).toBe('1 wave');
    expect(t('brief.waves', { n: 12 })).toBe('12 waves');
    expect(t('hud.wave', { n: 3, total: 10 })).toBe('Wave 3/10');
  });

  it('switches locale, Turkish nouns stay singular after a number', () => {
    setLocale('tr');
    expect(t('brief.waves', { n: 1 })).toBe('1 dalga');
    expect(t('brief.waves', { n: 12 })).toBe('12 dalga');
    expect(t('mode.badges', { n: 2, names: 'A ve B' })).toBe('Rozetler: A ve B +2★');
    expect(tIn('en', 'end.victory')).toBe('Victory!');
  });

  it('upper / lower follow the Turkish dotted and dotless i', () => {
    expect(upper('istanbul ılık', 'tr')).toBe('İSTANBUL ILIK');
    expect(upper('istanbul', 'en')).toBe('ISTANBUL');
    expect(lower('DALGA IŞIK İZ', 'tr')).toBe('dalga ışık iz');
  });

  it('picks the default locale from the browser language', () => {
    expect(localeFromTag('tr')).toBe('tr');
    expect(localeFromTag('tr-TR')).toBe('tr');
    expect(localeFromTag('TR')).toBe('tr');
    expect(localeFromTag('en-US')).toBe('en');
    expect(localeFromTag('de')).toBe('en');
    expect(localeFromTag('trk')).toBe('en');
    expect(localeFromTag(undefined)).toBe('en');
  });
});

describe('data lookups (by id, English data as fallback)', () => {
  it('DATA_TR covers every data id', () => {
    for (const l of LEVELS_2D) expect(DATA_TR.islands[l.id], l.id).toBeDefined();
    for (const id of Object.keys(TOWER_DEFS)) expect(DATA_TR.towers[id], id).toBeDefined();
    for (const id of Object.keys(ENEMY_DEFS)) expect(DATA_TR.enemies[id], id).toBeDefined();
    for (const id of Object.keys(CHALLENGES)) expect(DATA_TR.challenges[id], id).toBeDefined();
    for (const b of WORKSHOP_BRANCHES) expect(DATA_TR.branches[b.id], b.id).toBeDefined();
    for (const u of WORKSHOP_UPGRADES) expect(DATA_TR.upgrades[u.id]?.ranks.length, u.id).toBe(u.rankText.length);
    for (const tier of ENDLESS_TIERS) expect(DATA_TR.tiers[tier.name], tier.name).toBeDefined();
    for (const f of FEATS) expect(DATA_TR.feats[f.id], f.id).toBeDefined();
    const tags = [...Object.values(ENEMY_LORE), ...Object.values(TOWER_LORE), eliteEntry()].flatMap((l) => l.tags);
    for (const tag of tags) expect(DATA_TR.tags[tag], tag).toBeDefined();
  });

  it('every tower specialization and ability has Turkish text and an English role line', () => {
    const specIds: string[] = [];
    const abilityIds: string[] = [];
    for (const type of Object.keys(TOWER_DEFS) as (keyof typeof TOWER_DEFS)[]) {
      for (const b of specializationsFor(type)) {
        specIds.push(b.id);
        expect(specRole(b.id), b.id).not.toBe('');
        expect(specName(b.id)).toBe(b.name);
        expect(specDesc(b.id)).toBe(b.description);
        for (const a of b.abilities) {
          abilityIds.push(a.id);
          expect(abilityName(a.id)).toBe(a.name);
        }
      }
    }
    expect(specIds.length).toBe(16);
    expect(Object.keys(DATA_TR.specs).sort()).toEqual([...specIds].sort());
    expect(Object.keys(DATA_TR.abilities).sort()).toEqual([...abilityIds].sort());
    setLocale('tr');
    expect(specName('farwatch')).toBe('Uzak Nöbet Karakolu');
    expect(abilityName('throughshot')).toBe('Delip Geçen Ok');
    for (const id of specIds) {
      const d = DATA_TR.specs[id];
      expect(d.name && d.role && d.desc, id).toBeTruthy();
      expect(specDesc(id), id).toBe(d.desc);
    }
    for (const id of abilityIds) expect(abilityDesc(id), id).toBe(DATA_TR.abilities[id].desc);
  });

  it('DATA_TR has no ids the data does not know (stale entries)', () => {
    const levelIds = new Set(LEVELS_2D.map((l) => l.id));
    expect(Object.keys(DATA_TR.islands).filter((id) => !levelIds.has(id))).toEqual([]);
    expect(Object.keys(DATA_TR.challenges).filter((id) => !(id in CHALLENGES))).toEqual([]);
    expect(Object.keys(DATA_TR.towers).filter((id) => !(id in TOWER_DEFS))).toEqual([]);
    expect(Object.keys(DATA_TR.enemies).filter((id) => !(id in ENEMY_DEFS))).toEqual([]);
  });

  it('English returns the data text; Turkish the table; unknown ids fall back to English', () => {
    expect(islandName(LEVELS_2D[0])).toBe(LEVELS_2D[0].name);
    expect(towerName('archer')).toBe(TOWER_DEFS.archer.name);
    setLocale('tr');
    expect(islandName({ id: 'l1c', name: 'Meadow Crossing' })).toBe('Çayır Geçidi');
    expect(challengeName('bowless')).toBe('Yaysız');
    expect(islandName({ id: 'not-in-table', name: 'New Isle' })).toBe('New Isle');
    expect(tagName('Some new tag')).toBe('Some new tag');
    expect(upgradeRankText({ id: 'nope', rankText: ['+1 thing'] }, 1)).toBe('+1 thing');
  });
});

// ---------------------------------------------------------------------------------------------
// No hardcoded user-visible English left in the 2D UI files (lint-style).
// ---------------------------------------------------------------------------------------------

const ROOT = join(__dirname, '../..');
const UI_FILES = [
  ...readdirSync(join(ROOT, 'src/render2d/ui'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `src/render2d/ui/${f}`),
  'src/render2d/hud.ts',
  'src/render2d/buildRing.ts',
  'src/render2d/endPanel.ts',
  'src/render2d/codex2d.ts',
  'src/render2d/uiKit.ts',
  'src/render2d/uiLayout.ts',
  'src/render2d/main2d.ts',
];

/** Literal strings that are code, not words for the player. */
const CODE_WORDS = new Set(['Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Breezy', 'Challenging', 'Heroic', 'Master']);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** Does this literal read like English shown to a player? */
export function looksLikeEnglishText(lit: string): boolean {
  const s = lit.replace(/\$\{[^}]*\}/g, ' ').trim();
  if (!/[A-Za-z]{3,}/.test(s) || /^(\s*\d*(px|em|%)\s*)+$/.test(s)) return false;
  if (CODE_WORDS.has(s)) return false;
  if (/^[a-z]+(\.[A-Za-z0-9]+)+$/.test(s)) return false; // i18n key
  if (/[;{}<>]|calc\(|var\(|rgba?\(|url\(|\d+px|#[0-9a-f]{3}|Fredoka|sans-serif|\.(ts|webp|png|json|css)\b|^\//i.test(s)) return false;
  if (/^\[[\w-]+\]/.test(s)) return false; // console tag, e.g. "[skyhold-2d] …"
  if (/[a-z]\(\.?\d|\d%/.test(s)) return false; // CSS values: grayscale(.8), auto 135%
  const tokens = s.split(/\s+/);
  // Class lists, ids, attribute names: lowercase tokens with a dash / the pu- prefix.
  if (tokens.every((w) => /^[a-z0-9][a-z0-9_-]*$/.test(w)) && tokens.some((w) => /-|^pu$/.test(w))) return false;
  return / /.test(s) || /^[A-Z][a-z]+[!.…?]?$/.test(s);
}

function englishLiterals(file: string): string[] {
  const raw = readFileSync(join(ROOT, file), 'utf8');
  const rawLines = raw.split('\n');
  const out: string[] = [];
  stripComments(raw).split('\n').forEach((line, i) => {
    if (/i18n-ignore/.test(rawLines[i] ?? '')) return;
    if (/^\s*(import|export \* from|export \{[^}]*\} from)\b/.test(line)) return;
    for (const m of line.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      const lit = m[1] ?? m[2] ?? m[3] ?? '';
      if (looksLikeEnglishText(lit)) out.push(`${file}:${i + 1}: ${lit}`);
    }
  });
  return out;
}

describe('no hardcoded English in the 2D UI', () => {
  it('the detector catches English and lets code through', () => {
    expect(looksLikeEnglishText('Tap again to build')).toBe(true);
    expect(looksLikeEnglishText('Retry')).toBe(true);
    expect(looksLikeEnglishText('Victory!')).toBe(true);
    expect(looksLikeEnglishText('${n} upgrades affordable')).toBe(true);
    expect(looksLikeEnglishText('pu-node locked')).toBe(false);
    expect(looksLikeEnglishText('pu-rec pu-ink')).toBe(false);
    expect(looksLikeEnglishText('ring.tapBuild')).toBe(false);
    expect(looksLikeEnglishText('aria-label')).toBe(false);
    expect(looksLikeEnglishText('/art2d/ui/star.webp')).toBe(false);
    expect(looksLikeEnglishText('700 32px "Fredoka Variable"')).toBe(false);
    expect(looksLikeEnglishText('archer')).toBe(false);
  });

  it('no user-visible English string literals in the files the 2D UI owns', () => {
    const hits = UI_FILES.flatMap(englishLiterals);
    expect(hits).toEqual([]);
  });

  it('foe tips never name a 3D-only key (both languages)', () => {
    expect(stripKeyHints('Only Archer can hit it. Press R to see the sky lane.')).toBe('Only Archer can hit it.');
    expect(stripKeyHints('Yalnızca Okçu vurabilir. Hava yolunu görmek için R tuşuna bas.')).toBe('Yalnızca Okçu vurabilir.');
    for (const lang of ['en', 'tr'] as const) {
      setLocale(lang);
      for (const id of Object.keys(ENEMY_DEFS)) expect(enemyCounter(id), `${lang} ${id}`).not.toMatch(/Press [A-Z0-9] |tuşuna bas/);
    }
  });
});
