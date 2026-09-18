import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import ClientBootstrap from '../src/index.ts'

const kernel = [
  { id: 'client-connection', moduleName: '@tiggyknowledge/client-connection', label: 'Connection', description: 'Host API connection' },
  { id: 'client-runtime', moduleName: '@tiggyknowledge/client-runtime', label: 'Runtime', description: 'Page registry and client runtime state' },
  { id: 'client-ui-settings', moduleName: '@tiggyknowledge/client-ui-settings', label: 'Settings', description: 'Settings page shell' },
  { id: 'client-ui-layout', moduleName: '@tiggyknowledge/client-ui-layout', label: 'Layout', description: 'Application shell and React renderer' },
]

describe('client-bootstrap companions', () => {
  it('inserts host companions before the layout plugin', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(ClientBootstrap, { plugins: kernel })
      ctx.clientBootstrap.register({
        id: 'client-ui-knowledge',
        moduleName: '@tiggyknowledge/client-ui-knowledge',
        label: 'Knowledge',
        description: 'Knowledge library workbench',
      })
      expect(ctx.clientBootstrap.manifest().plugins.map(plugin => plugin.id)).toEqual([
        'client-connection',
        'client-runtime',
        'client-ui-settings',
        'client-ui-knowledge',
        'client-ui-layout',
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('removes companions when the host plugin disposes them', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(ClientBootstrap, { plugins: kernel })
      const dispose = ctx.clientBootstrap.registerAll([
        { id: 'client-ui-search', moduleName: '@tiggyknowledge/client-ui-search', label: 'Search', description: 'Keyword search workbench' },
      ])
      expect(ctx.clientBootstrap.manifest().plugins.some(plugin => plugin.id === 'client-ui-search')).toBe(true)
      dispose()
      expect(ctx.clientBootstrap.manifest().plugins.map(plugin => plugin.id)).toEqual(kernel.map(plugin => plugin.id))
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
