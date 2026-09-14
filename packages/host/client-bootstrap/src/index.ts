import { Context, Service } from '@deepseek-ai/cordis'
import type { ClientBootManifest, ClientPluginDescriptor } from '@tiggyknowledge/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    clientBootstrap: ClientBootstrap
  }
}

export interface Config {
  plugins: ClientPluginDescriptor[]
}

export class ClientBootstrap extends Service {
  private readonly plugins: ClientPluginDescriptor[]

  constructor(ctx: Context, config: Config) {
    super(ctx, 'clientBootstrap')
    const ids = new Set<string>()
    for (const plugin of config.plugins) {
      if (ids.has(plugin.id)) throw new Error(`client-bootstrap: duplicate plugin id ${plugin.id}`)
      ids.add(plugin.id)
    }
    this.plugins = structuredClone(config.plugins)
  }

  manifest(): ClientBootManifest {
    return { version: 1, plugins: structuredClone(this.plugins) }
  }
}

export default ClientBootstrap
