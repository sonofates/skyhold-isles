/**
 * Credits board (title screen, Settings → General): the team (placeholder until the owner names
 * it), the painted art, the tools the game is built with, the lettering (Fredoka, SIL OFL 1.1, and
 * the 'Fredoka TR' faces built from it) and the CC0 kit of the classic 3D mode — CREDITS.md and the
 * font's LICENSE are the sources. Product names stay as they are in every language.
 */
import { t } from '../../i18n/index.ts';
import { el, openSheet, type Sheet } from './dom.ts';
import './credits2d.css';

interface CreditLine {
  readonly name?: string;
  readonly text: string;
}

/** Product names: proper nouns, never translated. */
const PIXI = 'PixiJS'; // i18n-ignore (product name)
const TS = 'TypeScript · Vite · Vitest'; // i18n-ignore (product names)
const APPS = 'Capacitor · Electron · steamworks.js · RevenueCat'; // i18n-ignore (product names)
const THREE_D = 'three.js · postprocessing · N8AO'; // i18n-ignore (product names)
const FREDOKA = 'Fredoka'; // i18n-ignore (font name)
const FREDOKA_TR = 'Fredoka TR'; // i18n-ignore (font name)

export function creditSections(): { title: string; lines: CreditLine[] }[] {
  return [
    { title: t('credits.team'), lines: [{ text: t('credits.teamBody') }] },
    { title: t('credits.art'), lines: [{ text: t('credits.artBody') }] },
    {
      title: t('credits.tech'),
      lines: [
        { name: PIXI, text: t('credits.techPixi') },
        { name: TS, text: t('credits.techTs') },
        { name: APPS, text: t('credits.techApps') },
        { name: THREE_D, text: t('credits.tech3d') },
      ],
    },
    {
      title: t('credits.fonts'),
      lines: [
        { name: FREDOKA, text: t('credits.fontFredoka') },
        { name: FREDOKA_TR, text: t('credits.fontFredokaTr') },
      ],
    },
    { title: t('credits.assets'), lines: [{ text: t('credits.kenney') }] },
  ];
}

export function openCredits(onClose?: () => void): Sheet {
  const sheet = openSheet(t('credits.title'), { cls: 'pu-meta pu-credits', testid: 'credits2d', onClose });
  const col = el('div', 'pu-credits-col');
  for (const s of creditSections()) {
    const sec = el('section', 'pu-credits-sec');
    sec.append(el('h3', 'pu-credits-head pu-ink', {}, s.title));
    for (const l of s.lines) {
      sec.append(el('p', 'pu-credits-line pu-ink-soft', {}, l.name ? el('b', 'pu-ink', {}, l.name) : null, l.name ? ' — ' : null, l.text));
    }
    col.append(sec);
  }
  col.append(el('p', 'pu-credits-thanks pu-ink', {}, t('credits.thanks')));
  sheet.body.append(col);
  return sheet;
}
