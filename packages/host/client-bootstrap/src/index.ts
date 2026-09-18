import { Context, Service } from '@deepseek-ai/cordis'
import type { ClientBootManifest, ClientPluginDescriptor } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/http-router'

declare module '@deepseek-ai/cordis' {
  interface Context {
    clientBootstrap: ClientBootstrap
  }
}

export interface Config {
  plugins: ClientPluginDescriptor[]
}

export class ClientBootstrap extends Service {
  private readonly kernel: ClientPluginDescriptor[]
  private readonly extras: ClientPluginDescriptor[] = []

  constructor(ctx: Context, config: Config) {
    super(ctx, 'clientBootstrap')
    const ids = new Set<string>()
    for (const plugin of config.plugins) {
      if (ids.has(plugin.id)) throw new Error(`client-bootstrap: duplicate plugin id ${plugin.id}`)
      ids.add(plugin.id)
    }
    this.kernel = structuredClone(config.plugins)
    ctx.inject(['httpRouter'], ctx => ctx.httpRouter.registerSnapshotContributor('client-bootstrap', () => ({
      clientBoot: this.manifest(),
    })))
  }

  register(plugin: ClientPluginDescriptor): () => void {
    if (this.kernel.some(item => item.id === plugin.id) || this.extras.some(item => item.id === plugin.id)) {
      throw new Error(`client-bootstrap: duplicate plugin id ${plugin.id}`)
    }
    if (this.kernel.some(item => item.moduleName === plugin.moduleName) || this.extras.some(item => item.moduleName === plugin.moduleName)) {
      throw new Error(`client-bootstrap: duplicate plugin module ${plugin.moduleName}`)
    }
    this.extras.push(structuredClone(plugin))
    return () => {
      const index = this.extras.findIndex(item => item.id === plugin.id)
      if (index >= 0) this.extras.splice(index, 1)
    }
  }

  registerAll(plugins: ClientPluginDescriptor[]): () => void {
    const disposers = plugins.map(plugin => this.register(plugin))
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }

  manifest(): ClientBootManifest {
    const layoutIndex = this.kernel.findIndex(plugin => plugin.id === 'client-ui-layout')
    const head = layoutIndex < 0 ? this.kernel : this.kernel.slice(0, layoutIndex)
    const tail = layoutIndex < 0 ? [] : this.kernel.slice(layoutIndex)
    return { version: 1, plugins: structuredClone([...head, ...this.extras, ...tail]) }
  }
}

export default ClientBootstrap
