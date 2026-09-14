import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader, { type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { ClientPluginDescriptor, SystemSnapshot } from '@tiggyknowledge/contracts'
import * as ConnectionPlugin from '@tiggyknowledge/client-connection'
import * as RuntimePlugin from '@tiggyknowledge/client-runtime'
import * as KnowledgePlugin from '@tiggyknowledge/client-ui-knowledge'
import * as IngestionPlugin from '@tiggyknowledge/client-ui-ingestion'
import * as DocumentsPlugin from '@tiggyknowledge/client-ui-documents'
import * as GraphPlugin from '@tiggyknowledge/client-ui-graph'
import * as OkfInspectorPlugin from '@tiggyknowledge/client-inspector-okf'
import * as OkfExportActionPlugin from '@tiggyknowledge/client-action-okf-export'
import * as NoteCreatePlugin from '@tiggyknowledge/client-note-create'
import * as TagsPlugin from '@tiggyknowledge/client-ui-tags'
import * as FavoritesPlugin from '@tiggyknowledge/client-ui-favorites'
import * as SearchPlugin from '@tiggyknowledge/client-ui-search'
import * as SettingsPlugin from '@tiggyknowledge/client-ui-settings'
import * as GeneralSettingsPlugin from '@tiggyknowledge/client-settings-general'
import * as StorageSettingsPlugin from '@tiggyknowledge/client-settings-storage'
import * as ConfigSettingsPlugin from '@tiggyknowledge/client-settings-config'
import * as DshIntegrationSettingsPlugin from '@tiggyknowledge/client-settings-dsh-integration'
import * as PluginsSettingsPlugin from '@tiggyknowledge/client-settings-plugins'
import * as LayoutPlugin from '@tiggyknowledge/client-ui-layout'

const MODULES: Record<string, unknown | (() => Promise<unknown>)> = {
  '@tiggyknowledge/client-connection': ConnectionPlugin,
  '@tiggyknowledge/client-runtime': RuntimePlugin,
  '@tiggyknowledge/client-ui-knowledge': KnowledgePlugin,
  '@tiggyknowledge/client-ui-ingestion': IngestionPlugin,
  '@tiggyknowledge/client-ui-documents': DocumentsPlugin,
  '@tiggyknowledge/client-ui-graph': GraphPlugin,
  '@tiggyknowledge/client-inspector-okf': OkfInspectorPlugin,
  '@tiggyknowledge/client-action-okf-export': OkfExportActionPlugin,
  '@tiggyknowledge/client-note-create': NoteCreatePlugin,
  '@tiggyknowledge/client-preview-pdf': () => import('@tiggyknowledge/client-preview-pdf'),
  '@tiggyknowledge/client-ui-tags': TagsPlugin,
  '@tiggyknowledge/client-ui-favorites': FavoritesPlugin,
  '@tiggyknowledge/client-ui-search': SearchPlugin,
  '@tiggyknowledge/client-ui-settings': SettingsPlugin,
  '@tiggyknowledge/client-settings-general': GeneralSettingsPlugin,
  '@tiggyknowledge/client-settings-storage': StorageSettingsPlugin,
  '@tiggyknowledge/client-settings-config': ConfigSettingsPlugin,
  '@tiggyknowledge/client-settings-dsh-integration': DshIntegrationSettingsPlugin,
  '@tiggyknowledge/client-settings-plugins': PluginsSettingsPlugin,
  '@tiggyknowledge/client-ui-layout': LayoutPlugin,
}

async function readBootManifest(): Promise<ClientPluginDescriptor[]> {
  const response = await fetch('/api/system')
  if (!response.ok) throw new Error(`web boot: /api/system returned ${response.status}`)
  const snapshot = await response.json() as SystemSnapshot
  if (snapshot.clientBoot.version !== 1) throw new Error(`web boot: unsupported manifest version ${snapshot.clientBoot.version}`)
  return snapshot.clientBoot.plugins
}

async function boot(): Promise<void> {
  const plugins = await readBootManifest()
  const ctx = new Context()
  await ctx.plugin(Loader)
  const entries: EntryOptions[] = await Promise.all(plugins.map(async plugin => {
    const bundled = MODULES[plugin.moduleName]
    if (bundled === undefined) throw new Error(`web boot: client module is not bundled: ${plugin.moduleName}`)
    const implementation = typeof bundled === 'function' ? await bundled() : bundled
    ctx.loader.builtins[plugin.moduleName] = implementation
    return { id: plugin.id, name: `cordis:${plugin.moduleName}` }
  }))
  await ctx.loader.root.update(entries)
  await ctx.loader.await()
  const failures = [...ctx.loader.entries()].filter(entry => entry.fiber?.state !== FiberState.ACTIVE)
  if (failures.length > 0) throw new Error(`web boot: inactive plugins: ${failures.map(entry => entry.id).join(', ')}`)
}

void boot().catch((error: unknown) => {
  console.error(error)
  const root = document.querySelector<HTMLElement>('#root')
  if (root !== null) {
    const main = document.createElement('main')
    main.style.cssText = 'font:14px system-ui;padding:32px;color:#8e3030'
    main.textContent = error instanceof Error ? error.message : String(error)
    root.replaceChildren(main)
  }
})
