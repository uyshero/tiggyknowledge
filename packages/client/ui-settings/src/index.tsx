import type { Context } from '@deepseek-ai/cordis'
import { Settings } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type {} from '@tiggyknowledge/client-runtime'
import type { SystemSnapshot } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

const PLUGIN_PANEL_IDS = new Set(['config', 'plugins'])
const PLUGIN_GROUP_ID = 'plugin-group'

export function apply(ctx: Context): void {
  function SettingsPage(): JSX.Element {
    const app = useSyncExternalStore(ctx.clientApp.subscribe, ctx.clientApp.getSnapshot)
    const [selectedPanelId, setSelectedPanelId] = useState<string>()
    const [system, setSystem] = useState<SystemSnapshot>()
    const [error, setError] = useState<string>()
    const requestedPanelId = typeof app.pageState === 'object' && app.pageState !== null && 'panelId' in app.pageState
      && typeof app.pageState.panelId === 'string' ? app.pageState.panelId : undefined

    useEffect(() => {
      const controller = new AbortController()
      void ctx.connection.system(controller.signal)
        .then(setSystem)
        .catch(reason => {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
        })
      return () => controller.abort()
    }, [])

    useEffect(() => {
      setSelectedPanelId(value => {
        if (requestedPanelId !== undefined && app.settingsPanels.some(panel => panel.id === requestedPanelId)) return requestedPanelId
        if (value !== undefined && app.settingsPanels.some(panel => panel.id === value)) return value
        return app.settingsPanels.find(panel => panel.default)?.id ?? app.settingsPanels[0]?.id
      })
    }, [app.settingsPanels, requestedPanelId])

    const pluginPanels = app.settingsPanels.filter(panel => PLUGIN_PANEL_IDS.has(panel.id))
    const navPanels = [
      ...app.settingsPanels.filter(panel => !PLUGIN_PANEL_IDS.has(panel.id) && panel.order < 30),
      ...(pluginPanels.length === 0 ? [] : [{ id: PLUGIN_GROUP_ID, label: '插件', order: 30 }]),
      ...app.settingsPanels.filter(panel => !PLUGIN_PANEL_IDS.has(panel.id) && panel.order >= 30),
    ].sort((left, right) => left.order - right.order)
    const selectedInPluginGroup = selectedPanelId !== undefined && PLUGIN_PANEL_IDS.has(selectedPanelId)
    const selectedPanel = app.settingsPanels.find(panel => panel.id === selectedPanelId)
    const Panel = selectedPanel?.component

    return (
      <div className="page settings-page">
        <header className="page-header compact-header">
          <div><p className="eyebrow">tiggyknowledge</p><h1>设置</h1></div>
        </header>
        <div className="settings-workbench">
          <nav className="settings-tabs" aria-label="设置分类">
            {navPanels.map(panel => (
              <button
                className={panel.id === PLUGIN_GROUP_ID ? selectedInPluginGroup ? 'active' : '' : selectedPanelId === panel.id ? 'active' : ''}
                key={panel.id}
                type="button"
                onClick={() => {
                  if (panel.id === PLUGIN_GROUP_ID) setSelectedPanelId(value => value !== undefined && PLUGIN_PANEL_IDS.has(value) ? value : pluginPanels[0]?.id)
                  else setSelectedPanelId(panel.id)
                }}
              >
                {panel.label}
              </button>
            ))}
          </nav>
          <section className="settings-content">
            {selectedInPluginGroup && pluginPanels.length > 1 && (
              <div className="settings-subtabs segmented" aria-label="插件设置分类">
                {pluginPanels.map(panel => (
                  <button className={selectedPanelId === panel.id ? 'active' : ''} key={panel.id} type="button" onClick={() => setSelectedPanelId(panel.id)}>
                    {panel.label}
                  </button>
                ))}
              </div>
            )}
            {Panel === undefined ? <div className="settings-empty">没有已启用的设置面板</div> : <Panel onSystemChange={setSystem} {...(system === undefined ? {} : { system })} {...(error === undefined ? {} : { error })} />}
          </section>
        </div>
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerPage({
    id: 'settings',
    label: '设置',
    icon: Settings,
    component: SettingsPage,
    order: 100,
    section: 'secondary',
  }), 'ui-settings: page')
}
