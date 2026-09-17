import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'
import ClientAppService from '../src/index.ts'

describe('client runtime extension registries', () => {
  it('adds and removes document inspectors with their plugin lifecycle', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(Loader)
      await ctx.plugin(ClientAppService)
      const component = (): null => null
      const icon = (): null => null
      const dispose = ctx.clientApp.registerDocumentInspector({ component, icon, id: 'okf', label: 'OKF 映射', order: 10 })

      expect(ctx.clientApp.getSnapshot().documentInspectors.map(inspector => inspector.id)).toEqual(['okf'])
      dispose()
      expect(ctx.clientApp.getSnapshot().documentInspectors).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('adds and removes settings panels with their plugin lifecycle', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(Loader)
      await ctx.plugin(ClientAppService)
      const component = (): null => null
      const disposeGeneral = ctx.clientApp.registerSettingsPanel({ component, id: 'general', label: '通用设置', order: 10 })
      const disposeStorage = ctx.clientApp.registerSettingsPanel({ component, id: 'storage', label: '存储', order: 20 })

      expect(ctx.clientApp.getSnapshot().settingsPanels.map(panel => panel.id)).toEqual(['general', 'storage'])
      disposeStorage()
      expect(ctx.clientApp.getSnapshot().settingsPanels.map(panel => panel.id)).toEqual(['general'])
      disposeGeneral()
      expect(ctx.clientApp.getSnapshot().settingsPanels).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('adds and removes library actions with their plugin lifecycle', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(Loader)
      await ctx.plugin(ClientAppService)
      const component = (): null => null
      const dispose = ctx.clientApp.registerLibraryAction({ component, id: 'okf-export', order: 10 })

      expect(ctx.clientApp.getSnapshot().libraryActions.map(action => action.id)).toEqual(['okf-export'])
      dispose()
      expect(ctx.clientApp.getSnapshot().libraryActions).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('orders app overlays and updates active page state', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(Loader)
      await ctx.plugin(ClientAppService)
      const component = (): null => null
      const icon = (): null => null
      ctx.clientApp.registerPage({ component, icon, id: 'documents', label: '条目', order: 10, section: 'primary' })
      const disposeLater = ctx.clientApp.registerAppOverlay({ component, id: 'later', order: 20 })
      const disposeFirst = ctx.clientApp.registerAppOverlay({ component, id: 'first', order: 10 })

      ctx.clientApp.updatePageState({ libraryId: 'library-1', documentId: 'document-1' })

      expect(ctx.clientApp.getSnapshot().appOverlays.map(overlay => overlay.id)).toEqual(['first', 'later'])
      expect(ctx.clientApp.getSnapshot().pageState).toEqual({ libraryId: 'library-1', documentId: 'document-1' })
      disposeFirst()
      disposeLater()
      expect(ctx.clientApp.getSnapshot().appOverlays).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
