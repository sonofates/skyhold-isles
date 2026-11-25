import { t } from '../../i18n/index.ts';
import { el } from './dom.ts';
import { SPACE_LABEL } from './keyBindings.ts';

/**
 * Controller button names shown on the HUD's key badges while a pad is in use (html.pu-pad): the
 * same buttons padCursor.ts `padKey` turns into the run's keys (Y hero, LB / RB abilities, LT / RT
 * hero skills).
 */
export const PAD_BADGE = {
  heroSelect: 'Y', // i18n-ignore (button name)
  heroSkill0: 'LT', // i18n-ignore (button name)
  heroSkill1: 'RT', // i18n-ignore (button name)
  meteor: 'LB', // i18n-ignore (button name)
  overcharge: 'RB', // i18n-ignore (button name)
} as const;

/** A tooltip's "Key Q" line that reads "Key LB" in pad mode (both spans present; CSS shows one). */
export function tipKey(key: string, pad: string): HTMLElement {
  return el('span', 'pu-ab-tip-key pu-letter', {}, el('span', 'k-pad', {}, t('ab.key', { key: pad })), el('span', 'k-key', {}, t('ab.key', { key: keyName(key) })));
}

/** A binding label as the player reads it: 'SPACE' → the localized Space, letters / digits as they are. */
export function keyName(label: string): string {
  return label === SPACE_LABEL ? t('key.space') : label;
}
