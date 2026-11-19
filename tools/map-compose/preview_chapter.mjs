// Retired 2026-11-19: chapter two (i17–i24) now ships in LEVELS_2D with its roster, side/death
// clips and kill callback, so no staging is needed. Play an island with the regular dev server:
//   npm run dev   →   /2d.html?level=i24
const island = process.argv[2] ?? 'i17';
console.log(`Chapter two is live. Run \`npm run dev\` and open /2d.html?level=${island}`);
