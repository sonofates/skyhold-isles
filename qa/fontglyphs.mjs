// Which characters each Fredoka subset file really has a glyph for (fontkit; dev-only probe).
// Usage: node qa/fontglyphs.mjs [chars]
import * as fontkit from 'fontkit';

const dir = 'node_modules/@fontsource-variable/fredoka/files/';
const want = process.argv[2] ?? 'şŞğĞıİçÇöÖüÜâÂîÎûÛ¸˘˙';
for (const f of ['fredoka-latin-wght-normal.woff2', 'fredoka-latin-ext-wght-normal.woff2']) {
  const font = fontkit.openSync(dir + f);
  const have = [...want].map((c) => `${c}:${font.hasGlyphForCodePoint(c.codePointAt(0)) ? 'y' : '-'}`).join(' ');
  console.log(f, 'glyphs', font.numGlyphs, '\n ', have);
  const cps = font.characterSet.filter((c) => c > 0xff).slice(0, 80).map((c) => String.fromCodePoint(c)).join('');
  console.log('  >0xFF:', cps);
}
