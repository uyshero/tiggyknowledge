import type { Context } from '@deepseek-ai/cordis'
import { BrainCircuit, Check, ChevronDown, Settings } from 'lucide-react'
import type { JSX } from 'react'
import type { SettingsPanelProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'
import type { SemanticCapabilitySnapshot } from '@tiggyknowledge/contracts'

export const inject = ['clientApp']

function semanticLabel(semantic: SemanticCapabilitySnapshot['semantic'] | undefined): string {
  if (semantic === undefined) return '正在读取'
  if (semantic.status === 'available') return `${semantic.providers.length} 个 Provider`
  return '未配置'
}

function PluginConfigSettings({ system, error }: SettingsPanelProps): JSX.Element {
  const semantic = system?.semanticSearch
  return (
    <div className="settings-section">
      <h2>插件配置</h2>
      {error !== undefined && <div className="error-banner">{error}</div>}
      <div className="plugin-config-row"><div className="plugin-mark"><Settings size={18} /></div><div><strong>通用设置</strong><span>knowledge-settings-file</span></div><span className="status-inline"><Check size={14} />已加载</span><ChevronDown size={16} /></div>
      <div className="plugin-config-row"><div className="plugin-mark"><BrainCircuit size={18} /></div><div><strong>语义检索 Provider</strong><span>{semantic?.semantic.message ?? '正在读取语义检索能力'}</span></div><span className={`status-inline ${semantic?.semantic.status === 'available' ? '' : 'status-muted'}`}>{semanticLabel(semantic?.semantic)}</span><ChevronDown size={16} /></div>
    </div>
  )
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.clientApp.registerSettingsPanel({ component: PluginConfigSettings, id: 'config', label: '插件配置', order: 30 }), 'settings-config: panel')
}
