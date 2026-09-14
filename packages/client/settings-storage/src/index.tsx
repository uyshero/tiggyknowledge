import type { Context } from '@deepseek-ai/cordis'
import { Database, FolderOpen, HardDrive } from 'lucide-react'
import { useState, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type { SettingsPanelProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'

export const inject = ['clientApp', 'connection']

export function apply(ctx: Context): void {
  function StorageSettings({ system, error }: SettingsPanelProps): JSX.Element {
    const [opening, setOpening] = useState(false)
    const [message, setMessage] = useState<string>()
    const [openError, setOpenError] = useState<string>()

    const openDirectory = async (): Promise<void> => {
      if (opening) return
      setOpening(true)
      setMessage(undefined)
      setOpenError(undefined)
      try {
        const result = await ctx.connection.openDataDirectory()
        setMessage(`已在系统文件管理器中打开 ${result.path}`)
      } catch (reason) {
        setOpenError(reason instanceof Error ? reason.message : '无法打开本地数据目录')
      } finally {
        setOpening(false)
      }
    }

    return (
      <div className="settings-section storage-section">
        <div className="section-heading"><div><h2>本地存储</h2><p>知识库目录、原始文件和索引均保存在本机。</p></div></div>
        {error !== undefined && <div className="error-banner">{error}</div>}
        <div className="storage-location">
          <div className="storage-location-icon"><HardDrive size={20} /></div>
          <div className="storage-location-copy"><strong>数据目录</strong><code title={system?.catalog.dataDirectory}>{system?.catalog.dataDirectory ?? '正在读取...'}</code></div>
          <button className="secondary-button" type="button" disabled={system === undefined || opening} onClick={() => void openDirectory()}><FolderOpen size={16} />{opening ? '正在打开...' : '打开数据目录'}</button>
        </div>
        <div className="storage-details">
          <div><span>知识库</span><strong>{system?.catalog.libraries ?? '-'}</strong></div>
          <div><span>知识条目</span><strong>{system?.catalog.documents ?? '-'}</strong></div>
          <div><span>目录结构</span><strong>托管存储</strong></div>
        </div>
        <div className="storage-database-row"><Database size={16} /><div><strong>目录数据库</strong><code title={system?.catalog.databasePath}>{system?.catalog.databasePath ?? '正在读取...'}</code></div><span>Schema {system?.catalog.schemaVersion ?? '-'}</span></div>
        {message !== undefined && <div className="storage-message" role="status">{message}</div>}
        {openError !== undefined && <div className="error-banner" role="alert">{openError}</div>}
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerSettingsPanel({ component: StorageSettings, id: 'storage', label: '存储', order: 20 }), 'settings-storage: panel')
}
