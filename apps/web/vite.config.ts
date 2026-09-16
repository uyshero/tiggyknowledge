import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const source = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^node:module$/, replacement: source('./src/node-module-stub.ts') },
      { find: /^@deepseek-ai\/cosmokit$/, replacement: source('../../vendor/cosmokit/src/index.ts') },
      { find: /^@deepseek-ai\/cordis$/, replacement: source('../../vendor/cordis/src/index.ts') },
      { find: /^@deepseek-ai\/cordis-plugin-loader$/, replacement: source('../../vendor/loader/src/index.ts') },
    ],
  },
  define: {
    'process.versions.node': '"0.0.0"',
    'process.execArgv': '[]',
    'process.env.CORDIS_SHARED': 'undefined',
  },
})
