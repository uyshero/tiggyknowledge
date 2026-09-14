import type { Context } from '@deepseek-ai/cordis'
import type { JSX } from 'react'
import type { SettingsPanelProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'

export const inject = ['clientApp']

function GeneralSettings({ system, error }: SettingsPanelProps): JSX.Element {
  const general = system?.settings.values.general as Record<string, unknown> | undefined
  return (
    <div className="settings-section">
      <h2>通用设置</h2>
      {error !== undefined && <div className="error-banner">{error}</div>}
      <div className="setting-row"><div><strong>界面语言</strong><span>应用显示语言</span></div><span>{String(general?.locale ?? 'zh-CN')}</span></div>
      <div className="setting-row"><div><strong>主题</strong><span>界面明暗模式</span></div><span>{String(general?.theme ?? 'system')}</span></div>
      <div className="setting-row"><div><strong>默认搜索数量</strong><span>单次检索返回上限</span></div><span>{String(general?.defaultSearchLimit ?? 20)}</span></div>
    </div>
  )
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.clientApp.registerSettingsPanel({ component: GeneralSettings, id: 'general', label: '通用设置', order: 10 }), 'settings-general: panel')
}
