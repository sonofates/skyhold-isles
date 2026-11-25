/**
 * The painted-UI font stack, kept apart from hudText.ts (which needs Pixi) so the title screen and
 * world map can name it without loading the renderer (docs/handoff-perf.md).
 * 'Fredoka TR' supplies the Turkish letters Fredoka lacks (ş Ş ğ Ğ İ; ui/fredokaTr.css).
 */
export const HUD_FONT = '"Fredoka Variable", "Fredoka TR", "Trebuchet MS", "Arial Rounded MT Bold", sans-serif';
