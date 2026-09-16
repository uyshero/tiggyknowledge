import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['tsconfig.base.json'] })],
  resolve: {
    // Several legacy packages still contain checked-in JavaScript beside their
    // TypeScript source. Tests must exercise the current source, not those stale
    // generated files.
    extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '.json'],
  },
  test: {
    include: ['packages/**/*.spec.ts', 'apps/**/*.spec.ts'],
    exclude: ['**/node_modules/**', 'apps/desktop/.packaged/**', 'apps/desktop/dist/**'],
    environment: 'node',
  },
})
