import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/sim/**/*.ts', 'src/data/**/*.ts', 'src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['three', 'three/*'],
              message: 'src/sim, src/data, and src/core must never import three.',
            },
            {
              group: ['**/render/*', '**/ui/*', '**/platform/*', '**/audio/*'],
              message: 'src/sim, src/data, and src/core must remain pure and isolated from browser layers.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'Browser globals are forbidden in sim/data/core.' },
        { name: 'document', message: 'DOM globals are forbidden in sim/data/core.' },
        { name: 'navigator', message: 'Browser globals are forbidden in sim/data/core.' },
        { name: 'localStorage', message: 'Storage globals are forbidden in sim/data/core.' },
        { name: 'requestAnimationFrame', message: 'RAF is forbidden in sim/data/core.' },
        { name: 'cancelAnimationFrame', message: 'RAF is forbidden in sim/data/core.' },
        { name: 'HTMLElement', message: 'DOM APIs are forbidden in sim/data/core.' },
        { name: 'HTMLCanvasElement', message: 'DOM APIs are forbidden in sim/data/core.' },
        { name: 'PointerEvent', message: 'DOM APIs are forbidden in sim/data/core.' },
        { name: 'KeyboardEvent', message: 'DOM APIs are forbidden in sim/data/core.' },
        { name: 'WheelEvent', message: 'DOM APIs are forbidden in sim/data/core.' },
      ],
    },
  },
);
