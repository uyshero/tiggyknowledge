import type { Context } from '@deepseek-ai/cordis'
import { Search } from 'lucide-react'
import { useMemo, useState, type JSX } from 'react'
import type { SettingsPanelProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'
import type { PluginFace, PluginInventoryEntry } from '@tiggyknowledge/contracts'

export const inject = ['clientApp']

type FaceFilter = 'all' | PluginFace

function phaseLabel(phase: PluginInventoryEntry['phase']): string {
  return { active: '运行中', pending: '等待依赖', loading: '加载中', failed: '失败', unloading: '卸载中', disabled: '已停用' }[phase]
}

export function apply(ctx: Context): void {
  function PluginListSettings({ system, error }: SettingsPanelProps): JSX.Element {
    const [face, setFace] = useState<FaceFilter>('all')
    const [query, setQuery] = useState('')
    const revision = ctx.clientApp.getSnapshot().revision
    const plugins = useMemo(() => {
      const normalized = query.trim().toLowerCase()
      return [...system?.hostPlugins ?? [], ...ctx.clientApp.clientPlugins()].filter(plugin => {
        if (face !== 'all' && plugin.face !== face) return false
        return normalized === '' || plugin.entryId.toLowerCase().includes(normalized) || plugin.moduleName.toLowerCase().includes(normalized)
      })
    }, [system, face, query, revision])

    return (
      <div className="settings-section plugin-section">
        <div className="section-heading">
          <div><h2>插件列表</h2><p>{plugins.length} 个运行时条目</p></div>
          <div className="plugin-tools">
            <div className="segmented" aria-label="插件运行位置">{(['all', 'host', 'client'] as FaceFilter[]).map(value => <button className={face === value ? 'active' : ''} key={value} type="button" onClick={() => setFace(value)}>{value === 'all' ? '全部' : value === 'host' ? 'Host' : 'Client'}</button>)}</div>
            <label className="search-field"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索插件" /></label>
          </div>
        </div>
        {error !== undefined && <div className="error-banner">{error}</div>}
        <div className="plugin-table" role="table">
          <div className="plugin-table-head" role="row"><span>插件</span><span>位置</span><span>状态</span><span>Entry ID</span></div>
          {plugins.map(plugin => <div className="plugin-table-row" role="row" key={`${plugin.face}:${plugin.entryId}`}><div><strong>{plugin.moduleName.replace(/^@tiggyknowledge\//, '')}</strong><span>{plugin.moduleName}</span></div><span className="face-label">{plugin.face === 'host' ? 'Host' : 'Client'}</span><span className={`phase phase-${plugin.phase}`}><i />{phaseLabel(plugin.phase)}</span><code>{plugin.entryId}</code></div>)}
        </div>
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerSettingsPanel({ component: PluginListSettings, default: true, id: 'plugins', label: '插件列表', order: 40 }), 'settings-plugins: panel')
}
