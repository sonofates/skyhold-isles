// Local playthrough of the chapter while shared roster, clip loading and game hooks await integration.
// Run from the checkout root with: node tools/map-compose/preview_chapter.mjs i24
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const island = process.argv[2] ?? 'i17';
if (!/^i(1[7-9]|2[0-4])$/.test(island)) throw new Error('Choose a chapter island from i17 through i24');

const manifest = JSON.parse(await readFile(new URL('../../public/art2d/manifest.json', import.meta.url), 'utf8'));
const clips = Object.fromEntries(Object.entries(manifest.enemies)
  .filter(([, spec]) => spec.sheet?.side && spec.death)
  .map(([id, spec]) => [id, { side: spec.sheet.side, death: spec.death }]));
const moduleId = 'virtual:chapter-playtest';
const previewModule = `
import { ENEMY_DEFS, ENEMY_TYPES, CHAPTER_ENEMY_DEFS, CHAPTER_ENEMY_TYPES, CHAPTER_ENEMY_MELEE } from '/src/data/enemies.ts';
import { ENEMY_MELEE } from '/src/data/soldiers.ts';
import { LEVELS_2D, registeredChapterIslands } from '/src/data/levels2d/index.ts';
import { loadPreviewClip } from '/src/render2d/assets2d.ts';

Object.assign(ENEMY_DEFS, CHAPTER_ENEMY_DEFS);
Object.assign(ENEMY_MELEE, CHAPTER_ENEMY_MELEE);
const missing = CHAPTER_ENEMY_TYPES.filter(id => !ENEMY_TYPES.includes(id));
ENEMY_TYPES.splice(ENEMY_TYPES.indexOf('boss'), 0, ...missing);
LEVELS_2D.push(...registeredChapterIslands().filter(level => !LEVELS_2D.some(row => row.id === level.id)));

const clips = ${JSON.stringify(clips)};
export async function loadChapterClips(art) {
  await Promise.all(CHAPTER_ENEMY_TYPES.map(async id => {
    const enemy = art.enemies[id];
    if (!enemy?.sheet || !clips[id]) throw new Error('Missing chapter art for ' + id);
    const [side, death] = await Promise.all([
      enemy.sheet.seqs[2] ?? loadPreviewClip(art.baseUrl, clips[id].side).then(clip => clip?.frames),
      enemy.death ?? loadPreviewClip(art.baseUrl, clips[id].death),
    ]);
    if (!side?.length || !death?.frames.length) throw new Error('Missing chapter clip for ' + id);
    enemy.sheet.seqs[2] = side;
    enemy.death = death;
  }));
}
`;

function insertBefore(source, anchor, addition) {
  if (!source.includes(anchor)) throw new Error('Chapter preview could not locate ' + anchor);
  return source.replace(anchor, addition + anchor);
}

const server = await createServer({
  server: { host: '127.0.0.1', port: 0, open: false },
  plugins: [{
    name: 'chapter-playtest', enforce: 'pre',
    resolveId(id) { if (id === moduleId) return '\0' + moduleId; },
    load(id) { if (id === '\0' + moduleId) return previewModule; },
    transform(code, id) {
      if (id.endsWith('/src/render2d/assets2d.ts')) return code + '\nexport { loadSheetSeq as loadPreviewClip };';
      if (id.endsWith('/src/render2d/main2d.ts')) {
        return "import { loadChapterClips } from 'virtual:chapter-playtest';\n" +
          insertBefore(code, 'const game = new Game2D(', 'await loadChapterClips(art);\n  ');
      }
      if (id.endsWith('/src/render2d/game2d.ts') && !code.includes('this.enemies.playDeath(')) {
        return insertBefore(code, "ev.on('enemyKilled', (e) => {",
          "ev.on('enemyKilled', (e) => this.enemies.playDeath(e.enemyId));\n    ");
      }
    },
  }],
});
try {
  await server.listen();
  console.log('http://127.0.0.1:' + server.httpServer.address().port + '/2d.html?level=' + island + '&lang=en');
  await new Promise(resolve => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
} finally {
  await server.close();
}
