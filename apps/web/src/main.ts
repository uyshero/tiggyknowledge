import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader, { type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { ClientPluginDescriptor, SystemSnapshot } from '@tiggyknowledge/contracts'
import { installPluginExternals } from './plugin-externals.ts'

installPluginExternals()

interface ClientPackageManifest {
  name?: unknown
}

const PACKAGE_MANIFESTS = import.meta.glob('../../../packages/client/*/package.json', {
  eager: true,
  import: 'default',
}) as Record<string, ClientPackageManifest>
const PACKAGE_MODULES = import.meta.glob('../../../packages/client/*/src/index.{ts,tsx}')

function discoverBundledModules(): Map<string, () => Promise<unknown>> {
  const modules = new Map<string, () => Promise<unknown>>()
  for (const [manifestPath, manifest] of Object.entries(PACKAGE_MANIFESTS)) {
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) continue
    const directory = manifestPath.slice(0, -'/package.json'.length)
    const load = PACKAGE_MODULES[`${directory}/src/index.ts`] ?? PACKAGE_MODULES[`${directory}/src/index.tsx`]
    if (load === undefined) continue
    if (modules.has(manifest.name)) throw new Error(`web boot: duplicate client module: ${manifest.name}`)
    modules.set(manifest.name, load)
  }
  return modules
}

const BUNDLED_MODULES = discoverBundledModules()

async function readBootManifest(): Promise<ClientPluginDescriptor[]> {
  const response = await fetch('/api/system')
  if (!response.ok) throw new Error(`web boot: /api/system returned ${response.status}`)
  const snapshot = await response.json() as SystemSnapshot
  if (snapshot.clientBoot.version !== 1) throw new Error(`web boot: unsupported manifest version ${snapshot.clientBoot.version}`)
  return snapshot.clientBoot.plugins
}

function loadClientModule(plugin: ClientPluginDescriptor): Promise<unknown> {
  const bundled = BUNDLED_MODULES.get(plugin.moduleName)
  if (bundled !== undefined) return bundled()
  if (plugin.url !== undefined && plugin.url.startsWith('/ext/plugins/') && plugin.url.endsWith('/client.js')) {
    return import(/* @vite-ignore */ plugin.url)
  }
  throw new Error(`web boot: client module is not bundled: ${plugin.moduleName}`)
}

async function boot(): Promise<void> {
  const plugins = await readBootManifest()
  const ctx = new Context()
  await ctx.plugin(Loader)
  const entries: EntryOptions[] = await Promise.all(plugins.map(async plugin => {
    const implementation = await loadClientModule(plugin)
    ctx.loader.builtins[plugin.moduleName] = implementation
    return { id: plugin.id, name: `cordis:${plugin.moduleName}` }
  }))
  await ctx.loader.root.update(entries)
  await ctx.loader.await()
  const failures = [...ctx.loader.entries()].filter(entry => entry.fiber?.state !== FiberState.ACTIVE)
  if (failures.length > 0) throw new Error(`web boot: inactive plugins: ${failures.map(entry => entry.id).join(', ')}`)
  ctx.clientApp.setClientModuleLoader(loadClientModule)
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
