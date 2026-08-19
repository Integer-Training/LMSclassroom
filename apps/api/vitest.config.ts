import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@api', replacement: path.resolve(__dirname, 'src') },
      // PearlLMS Phase-10 Step-7 (retire BASELINE D1/F1) — the 6 test files that failed to LOAD imported deep
      // DIRECTORY subpaths (e.g. `@cio/db/queries/notifications/`, `@cio/core/services/agent/*`). The packages'
      // `exports` wildcards map `./queries/*` → `./dist/queries/*.js`, which can't resolve a directory→index; the
      // app runtime works only because tsx honours tsconfig `paths` (`@cio/db/*` → `dist/*`). Mirror those paths
      // here so vitest resolves subpaths identically. Bare `@cio/db` / `@cio/core` (no slash) still use the
      // package `exports` `.` entry — the regex requires a trailing segment.
      { find: /^@cio\/db\/(.*)$/, replacement: path.resolve(__dirname, '../../packages/db/dist') + '/$1' },
      { find: /^@cio\/core\/(.*)$/, replacement: path.resolve(__dirname, '../../packages/core/dist') + '/$1' }
    ]
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/']
    }
  }
});
