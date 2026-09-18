import { Context, FiberState, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { ExternalPluginRecord, PluginInventoryEntry, PluginPhase } from '@tiggyknowledge/contracts'
import { hostPluginOrigin, pluginDisableable } from '@tiggyknowledge/contracts'
import { contributeSurface, HttpError, pathSegment } from '@tiggyknowledge/plugin-surface'
import { persistPluginEnabled } from './profile.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginInventory: PluginInventory
    builtinPluginIds?: ReadonlySet<string>
    externalPluginRegistry?: readonly ExternalPluginRecord[]
    dataRoot?: string
  }
}

const PHASES: Record<FiberState, Exclude<PluginPhase, 'disabled'>> = {
  [FiberState.PENDING]: 'pending',
  [FiberState.LOADING]: 'loading',
  [FiberState.ACTIVE]: 'active',
  [FiberState.FAILED]: 'failed',
  [FiberState.DISPOSED]: 'failed',
  [FiberState.UNLOADING]: 'unloading',
}

export class PluginInventory extends Service {
  static inject = ['loader']
  private queue: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
    contributeSurface(ctx, {
      snapshot: { id: 'plugin-inventory', contribute: () => ({ hostPlugins: this.list() }) },
      clients: [{
        id: 'client-settings-plugins',
        moduleName: '@tiggyknowledge/client-settings-plugins',
        label: 'Plugin Inventory',
        description: 'Plugin inventory settings panel',
      }],
      routes: [{
        id: 'plugin-inventory:enabled',
        methods: ['PUT'],
        path: /^\/api\/plugins\/([^/]+)$/,
        handler: async ({ assertSameOrigin, json, match, readJson }) => {
          assertSameOrigin()
          const body = await readJson<{ enabled?: unknown }>()
          if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'invalid_plugin_enabled', 'enabled 必须是布尔值')
          json({ plugin: await this.setEnabled(pathSegment(match), body.enabled) })
        },
      }],
    })
  }

  list(): PluginInventoryEntry[] {
    return [...this.ctx.loader.entries()]
      .filter(entry => !entry.options.group)
      .map(entry => this.describe(entry.id))
      .filter((entry): entry is PluginInventoryEntry => entry !== undefined)
  }

  async setEnabled(id: string, enabled: boolean): Promise<PluginInventoryEntry> {
    const run = this.queue.then(() => this.setEnabledNow(id, enabled))
    this.queue = run.then(() => undefined, () => undefined)
    return await run
  }

  private async setEnabledNow(id: string, enabled: boolean): Promise<PluginInventoryEntry> {
    if (hostPluginOrigin(id, this.ctx.builtinPluginIds) !== 'third-party') {
      throw new HttpError(403, 'plugin_not_disableable', '内置插件不能关闭')
    }
    const entry = [...this.ctx.loader.entries()].find(item => item.id === id)
    if (entry === undefined || entry.options.group) throw new HttpError(404, 'plugin_not_found', '插件不存在')
    const dataRoot = this.ctx.dataRoot
    if (typeof dataRoot !== 'string' || dataRoot.length === 0) {
      throw new HttpError(500, 'plugin_profile_unavailable', '无法写入插件配置')
    }
    const previousDisabled = entry.disabled
    const revert = persistPluginEnabled(dataRoot, id, enabled)
    try {
      if (previousDisabled !== !enabled) await entry.update({ disabled: !enabled })
      if (enabled && (entry.disabled || entry.fiber === undefined || entry.fiber.state !== FiberState.ACTIVE)) {
        throw new Error('第三方插件未能启动')
      }
    } catch (error) {
      revert()
      if (entry.disabled !== previousDisabled) {
        await entry.update({ disabled: previousDisabled }).catch(() => undefined)
      }
      if (error instanceof HttpError) throw error
      throw new HttpError(500, 'plugin_toggle_failed', error instanceof Error ? error.message : '无法切换插件')
    }
    const described = this.describe(id)
    if (described === undefined) throw new HttpError(404, 'plugin_not_found', '插件不存在')
    return described
  }

  private describe(id: string): PluginInventoryEntry | undefined {
    const entry = [...this.ctx.loader.entries()].find(item => item.id === id)
    if (entry === undefined || entry.options.group) return undefined
    const origin = hostPluginOrigin(entry.id, this.ctx.builtinPluginIds)
    const discovered = (this.ctx.externalPluginRegistry ?? []).find(plugin => plugin.id === entry.id)
    return {
      entryId: entry.id,
      moduleName: discovered?.packageName ?? entry.options.name,
      face: 'host',
      origin,
      disableable: pluginDisableable(origin),
      enabled: !entry.disabled,
      phase: entry.disabled ? 'disabled' : entry.fiber === undefined ? 'failed' : PHASES[entry.fiber.state],
    }
  }
}

export default PluginInventory
