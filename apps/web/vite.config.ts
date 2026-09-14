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
      { find: /^@tiggyknowledge\/client-connection$/, replacement: source('../../packages/client/connection/src/index.ts') },
      { find: /^@tiggyknowledge\/client-runtime$/, replacement: source('../../packages/client/runtime/src/index.ts') },
      { find: /^@tiggyknowledge\/client-ui-knowledge$/, replacement: source('../../packages/client/ui-knowledge/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-ui-ingestion$/, replacement: source('../../packages/client/ui-ingestion/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-ui-documents$/, replacement: source('../../packages/client/ui-documents/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-ui-graph$/, replacement: source('../../packages/client/ui-graph/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-preview-pdf$/, replacement: source('../../packages/client/preview-pdf/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-inspector-okf$/, replacement: source('../../packages/client/inspector-okf/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-action-okf-export$/, replacement: source('../../packages/client/action-okf-export/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-note-create$/, replacement: source('../../packages/client/note-create/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-ui-tags$/, replacement: source('../../packages/client/ui-tags/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-ui-favorites$/, replacement: source('../../packages/client/ui-favorites/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-ui-search$/, replacement: source('../../packages/client/ui-search/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-ui-settings$/, replacement: source('../../packages/client/ui-settings/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-settings-general$/, replacement: source('../../packages/client/settings-general/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-settings-storage$/, replacement: source('../../packages/client/settings-storage/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-settings-config$/, replacement: source('../../packages/client/settings-config/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-settings-dsh-integration$/, replacement: source('../../packages/client/settings-dsh-integration/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-settings-plugins$/, replacement: source('../../packages/client/settings-plugins/src/index.tsx') },
      { find: /^@tiggyknowledge\/client-ui-layout$/, replacement: source('../../packages/client/ui-layout/src/index.tsx') },
    ],
  },
  define: {
    'process.versions.node': '"0.0.0"',
    'process.execArgv': '[]',
    'process.env.CORDIS_SHARED': 'undefined',
  },
})
