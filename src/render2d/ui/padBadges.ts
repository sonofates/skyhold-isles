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
