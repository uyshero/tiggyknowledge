import { Context, FiberState, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { PluginInventoryEntry, PluginPhase } from '@tiggyknowledge/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginInventory: PluginInventory
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

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  list(): PluginInventoryEntry[] {
    return [...this.ctx.loader.entries()]
      .filter(entry => !entry.options.group)
      .map(entry => ({
        entryId: entry.id,
        moduleName: entry.options.name,
        face: 'host',
        enabled: !entry.disabled,
        phase: entry.disabled ? 'disabled' : entry.fiber === undefined ? 'failed' : PHASES[entry.fiber.state],
      }))
  }
}

export default PluginInventory
