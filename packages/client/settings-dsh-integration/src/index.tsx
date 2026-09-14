import type { Context } from '@deepseek-ai/cordis'
import { ArrowLeft, BookOpen, Clipboard, KeyRound, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type { SettingsPanelProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'
import type { DshIntegrationSettings, KnowledgeLibrary } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

const DEFAULT_DSH_SETTINGS: DshIntegrationSettings = {
  enabled: false,
  endpoint: 'http://127.0.0.1:3210',
  tokenEnvName: 'TIGGYKNOWLEDGE_TOKEN',
  defaultKnowledgeBaseIds: [],
}

function readDshSettings(value: unknown): DshIntegrationSettings {
  const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const settings: DshIntegrationSettings = {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_DSH_SETTINGS.enabled,
    endpoint: typeof source.endpoint === 'string' ? source.endpoint : DEFAULT_DSH_SETTINGS.endpoint,
    tokenEnvName: typeof source.tokenEnvName === 'string' ? source.tokenEnvName : DEFAULT_DSH_SETTINGS.tokenEnvName,
    defaultKnowledgeBaseIds: Array.isArray(source.defaultKnowledgeBaseIds) ? source.defaultKnowledgeBaseIds.filter((item): item is string => typeof item === 'string') : [],
  }
  if (typeof source.accessKey === 'object' && source.accessKey !== null && !Array.isArray(source.accessKey)) {
    const accessKey = source.accessKey as Record<string, unknown>
    if (typeof accessKey.preview === 'string' && typeof accessKey.createdAt === 'string') {
      settings.accessKey = { preview: accessKey.preview, createdAt: accessKey.createdAt }
    }
  }
  return settings
}

export function apply(ctx: Context): void {
  function AgentIntegrationManualPage(): JSX.Element {
    const [copyingManual, setCopyingManual] = useState(false)
    const [manualMessage, setManualMessage] = useState<string>()
    const manualSummary = `TiggyKnowledge 对外接入手册

Base URL: http://127.0.0.1:3210
Auth: Authorization: Bearer <access-key>

首选接口:
- GET /api/tiggyknowledge/status
- GET /api/tiggyknowledge/libraries
- POST /api/tiggyknowledge/search
- GET /api/tiggyknowledge/documents/:id/read?maxCharacters=20000
- GET /api/tiggyknowledge/documents/:id/okf?maxCharacters=20000

搜索请求示例:
{
  "query": "向量化",
  "knowledgeBaseIds": [],
  "topK": 5,
  "favoriteOnly": false
}

规则:
- knowledgeBaseIds 省略时表示全部知识库
- topK 建议 1-20，服务端最大 50
- maxCharacters 范围 1-100000
- 不启用知识库时，不注入上下文`

    const copyManualSummary = async (): Promise<void> => {
      if (copyingManual) return
      setCopyingManual(true)
      setManualMessage(undefined)
      try {
        await navigator.clipboard.writeText(manualSummary)
        setManualMessage('已复制接入摘要')
      } catch {
        setManualMessage('无法访问剪贴板，请手动复制页面内容')
      } finally {
        setCopyingManual(false)
      }
    }

    return (
      <div className="page settings-page">
        <header className="page-header compact-header">
          <div><p className="eyebrow">tiggyknowledge</p><h1>对外接入手册</h1></div>
          <div className="header-actions">
            <button className="secondary-button" type="button" disabled={copyingManual} onClick={() => void copyManualSummary()}>
              <Clipboard size={16} />
              {copyingManual ? '复制中...' : '复制接入摘要'}
            </button>
            <button className="secondary-button" type="button" onClick={() => ctx.clientApp.selectPage('settings')}>
              <ArrowLeft size={16} />
              返回设置
            </button>
          </div>
        </header>
        <main className="agent-manual-workspace">
          <section className="settings-section agent-manual-section">
              <div className="section-heading">
                <div>
                  <h2>智能体集成怎么接</h2>
                  <p>这里是给外部智能体、Connector、sidecar 客户端看的简版手册。</p>
                </div>
              </div>
              <div className="dsh-card">
                <div className="dsh-card-icon"><BookOpen size={18} /></div>
                <div className="dsh-card-copy">
                  <strong>接入顺序</strong>
                  <span>先查状态，再列知识库，再搜索或直接读取文档；不需要知识库时就不注入上下文。</span>
                </div>
              </div>
              <div className="dsh-library-picker">
                <div className="dsh-picker-heading">
                  <div><strong>1. Base URL 与认证</strong><span>本机默认地址加 Bearer Token。</span></div>
                </div>
                <pre className="dsh-config-preview"><code>{`Base URL 示例：
http://127.0.0.1:3210
https://knowledge.example.com

完整接口示例：
http://127.0.0.1:3210/api/tiggyknowledge/search

Header：
Authorization: Bearer <access-key>
Content-Type: application/json`}</code></pre>
              </div>
              <div className="dsh-library-picker">
                <div className="dsh-picker-heading">
                  <div><strong>2. 公开只读接口</strong><span>统一使用 /api/tiggyknowledge/*，不保留历史兼容路径。</span></div>
                </div>
                <pre className="dsh-config-preview"><code>{`GET  /api/tiggyknowledge/status
GET  /api/tiggyknowledge/libraries
POST /api/tiggyknowledge/search
GET  /api/tiggyknowledge/documents/:id/read?maxCharacters=20000
GET  /api/tiggyknowledge/documents/:id/okf?maxCharacters=20000`}</code></pre>
              </div>
              <div className="dsh-library-picker">
                <div className="dsh-picker-heading">
                  <div><strong>3. 搜索参数</strong><span>知识库范围可以为空、多个知识库，或只查收藏。</span></div>
                </div>
                <pre className="dsh-config-preview"><code>{`POST /api/tiggyknowledge/search

{
  "query": "向量化",
  "knowledgeBaseIds": [],
  "topK": 5,
  "favoriteOnly": false
}

参数说明：
- query：必填，搜索词
- knowledgeBaseIds：可选；省略或 [] 表示全部知识库
- topK：可选；建议 1-20，服务端最大 50
- favoriteOnly：可选；true 时只搜索收藏文档`}</code></pre>
              </div>
              <div className="dsh-library-picker">
                <div className="dsh-picker-heading">
                  <div><strong>4. curl 示例</strong><span>外部智能体可以照这个请求拼接。</span></div>
                </div>
                <pre className="dsh-config-preview"><code>{`curl -H "Authorization: Bearer <access-key>" \\
  http://127.0.0.1:3210/api/tiggyknowledge/status

curl -H "Authorization: Bearer <access-key>" \\
  http://127.0.0.1:3210/api/tiggyknowledge/libraries

curl -X POST http://127.0.0.1:3210/api/tiggyknowledge/search \\
  -H "Authorization: Bearer <access-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"向量化","knowledgeBaseIds":[],"topK":5,"favoriteOnly":false}'

curl -H "Authorization: Bearer <access-key>" \\
  "http://127.0.0.1:3210/api/tiggyknowledge/documents/<documentId>/read?maxCharacters=20000"`}</code></pre>
              </div>
              <div className="dsh-library-picker">
                <div className="dsh-picker-heading">
                  <div><strong>5. 响应结构</strong><span>搜索拿线索，read/okf 拿可注入上下文。</span></div>
                </div>
                <pre className="dsh-config-preview"><code>{`搜索响应：
{
  "query": "向量化",
  "mode": "keyword",
  "total": 1,
  "results": [{
    "documentId": "doc_xxx",
    "knowledgeBaseId": "kb_xxx",
    "title": "向量化方案",
    "snippet": "...",
    "score": 12,
    "tags": []
  }]
}

读取响应：
{
  "documentId": "doc_xxx",
  "knowledgeBaseId": "kb_xxx",
  "title": "向量化方案",
  "originalName": "vector.md",
  "sourceType": "markdown",
  "content": "...",
  "truncated": false
}`}</code></pre>
              </div>
              <div className="dsh-library-picker">
                <div className="dsh-picker-heading">
                  <div><strong>6. 接入建议</strong><span>简单、稳定、可回退。</span></div>
                </div>
                <div className="agent-manual-advice-list">
                  <div className="agent-manual-advice-item">
                    <span><strong>先查状态</strong><small>确认服务可用、能力可用、数据目录可见。</small></span>
                  </div>
                  <div className="agent-manual-advice-item">
                    <span><strong>再选知识库</strong><small>用户未指定时默认全部知识库；指定时按 knowledgeBaseIds 过滤。</small></span>
                  </div>
                  <div className="agent-manual-advice-item">
                    <span><strong>最后读内容</strong><small>搜索适合找线索，读取适合拿原文，OKF 适合做引用和映射。</small></span>
                  </div>
                </div>
              </div>
              {manualMessage !== undefined && <div className="storage-message" role="status">{manualMessage}</div>}
          </section>
        </main>
      </div>
    )
  }

  function DshIntegrationSettingsPanel({ system, error, onSystemChange }: SettingsPanelProps): JSX.Element {
    const snapshotSettings = useMemo(() => readDshSettings(system?.settings.values.dshIntegration), [system])
    const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>(snapshotSettings.defaultKnowledgeBaseIds)
    const [libraries, setLibraries] = useState<KnowledgeLibrary[]>([])
    const [libraryError, setLibraryError] = useState<string>()
    const [saving, setSaving] = useState(false)
    const [generatingKey, setGeneratingKey] = useState(false)
    const [generatedAccessKey, setGeneratedAccessKey] = useState<string>()
    const [message, setMessage] = useState<string>()
    const [saveError, setSaveError] = useState<string>()

    useEffect(() => {
      setSelectedLibraryIds(snapshotSettings.defaultKnowledgeBaseIds)
    }, [snapshotSettings])

    useEffect(() => {
      const controller = new AbortController()
      void ctx.connection.libraries(controller.signal)
        .then(items => {
          setLibraries(items)
          setLibraryError(undefined)
        })
        .catch(reason => {
          if (!controller.signal.aborted) setLibraryError(reason instanceof Error ? reason.message : '无法读取知识库列表')
        })
      return () => controller.abort()
    }, [])

    const allLibrariesSelected = selectedLibraryIds.length === 0
    const validSelectedIds = selectedLibraryIds.filter(id => libraries.some(library => library.id === id))

    const toggleLibrary = (libraryId: string): void => {
      setSelectedLibraryIds(current => {
        const libraryIds = libraries.map(library => library.id)
        if (current.length === 0) return libraryIds.filter(id => id !== libraryId)
        const next = current.includes(libraryId) ? current.filter(id => id !== libraryId) : [...current, libraryId]
        return next.length === libraryIds.length ? [] : next
      })
    }

    const save = async (): Promise<void> => {
      if (saving) return
      setSaving(true)
      setMessage(undefined)
      setSaveError(undefined)
      try {
        const settings = await ctx.connection.updateDshIntegrationSettings({
          defaultKnowledgeBaseIds: validSelectedIds,
        })
        if (system !== undefined) onSystemChange?.({ ...system, settings })
        setMessage('已保存智能体集成配置')
      } catch (reason) {
        setSaveError(reason instanceof Error ? reason.message : '保存失败')
      } finally {
        setSaving(false)
      }
    }

    const generateAccessKey = async (): Promise<void> => {
      if (generatingKey) return
      setGeneratingKey(true)
      setGeneratedAccessKey(undefined)
      setMessage(undefined)
      setSaveError(undefined)
      try {
        const result = await ctx.connection.generateDshIntegrationAccessKey()
        setGeneratedAccessKey(result.accessKey)
        if (system !== undefined) onSystemChange?.({ ...system, settings: result.settings })
        try {
          await navigator.clipboard.writeText(result.accessKey)
          setMessage('已生成并复制新的访问 Key。请保存好，离开页面后不会再次显示明文。')
        } catch {
          setMessage('已生成新的访问 Key。请立刻复制下方明文，离开页面后不会再次显示。')
        }
      } catch (reason) {
        setSaveError(reason instanceof Error ? reason.message : '生成访问 Key 失败')
      } finally {
        setGeneratingKey(false)
      }
    }

    const copyAccessKey = async (): Promise<void> => {
      if (generatedAccessKey === undefined) return
      try {
        await navigator.clipboard.writeText(generatedAccessKey)
        setMessage('已复制访问 Key')
      } catch {
        setSaveError('无法访问剪贴板，请手动复制访问 Key')
      }
    }

    return (
      <div className="settings-section dsh-integration-section">
        <div className="section-heading">
          <div><h2>智能体集成</h2><p>生成外部智能体访问 Key，并设置默认知识库范围。</p></div>
        </div>
        {error !== undefined && <div className="error-banner">{error}</div>}
        {libraryError !== undefined && <div className="error-banner">{libraryError}</div>}
        <div className="dsh-access-key-panel">
          <div className="dsh-picker-heading">
            <div>
              <strong>访问 Key</strong>
              <span>{snapshotSettings.accessKey === undefined ? '尚未生成。智能体 Connector 后续会使用 Bearer Token 访问知识库 API。' : `当前 Key：${snapshotSettings.accessKey.preview} · 生成于 ${new Date(snapshotSettings.accessKey.createdAt).toLocaleString()}`}</span>
            </div>
            <button className="secondary-button" type="button" disabled={generatingKey} onClick={() => void generateAccessKey()}><KeyRound size={15} />{generatingKey ? '正在生成...' : snapshotSettings.accessKey === undefined ? '生成访问 Key' : '重新生成'}</button>
          </div>
          {generatedAccessKey !== undefined && (
            <div className="dsh-generated-key">
              <div><strong>只显示一次</strong><code>{generatedAccessKey}</code></div>
              <div className="dsh-generated-key-actions">
                <button className="secondary-button" type="button" onClick={() => void copyAccessKey()}><Clipboard size={15} />复制 Key</button>
              </div>
            </div>
          )}
        </div>
        <div className="dsh-library-picker">
          <div className="dsh-picker-heading">
            <div><strong>默认知识库范围</strong><span>{allLibrariesSelected ? `当前为全部知识库${libraries.length > 0 ? `（${libraries.length} 个）` : ''}` : `已选择 ${validSelectedIds.length} 个知识库`}</span></div>
            <button className="secondary-button" type="button" disabled={allLibrariesSelected} onClick={() => setSelectedLibraryIds([])}>全部知识库</button>
          </div>
          <div className="dsh-library-list">
            {libraries.length === 0 ? <div className="dsh-empty-libraries">还没有可选择的知识库</div> : libraries.map(library => (
              <label className="dsh-library-choice" key={library.id}>
                <input checked={allLibrariesSelected || selectedLibraryIds.includes(library.id)} type="checkbox" onChange={() => toggleLibrary(library.id)} />
                <span><strong>{library.name}</strong><small>{library.documentCount} 个条目 · {library.id}</small></span>
              </label>
            ))}
          </div>
        </div>
        <div className="dsh-actions">
          <button className="primary-button" type="button" disabled={saving} onClick={() => void save()}><RefreshCw size={15} />{saving ? '正在保存...' : '保存'}</button>
          <button className="secondary-button" type="button" onClick={() => ctx.clientApp.selectPage('agent-manual')}><BookOpen size={15} />查看对外接入手册</button>
        </div>
        {message !== undefined && <div className="storage-message" role="status">{message}</div>}
        {saveError !== undefined && <div className="error-banner" role="alert">{saveError}</div>}
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerPage({
    id: 'agent-manual',
    label: '对外接入手册',
    icon: BookOpen,
    component: AgentIntegrationManualPage,
    order: 106,
    section: 'hidden',
  }), 'settings-dsh-integration: manual page')

  ctx.effect(() => ctx.clientApp.registerSettingsPanel({ component: DshIntegrationSettingsPanel, id: 'dsh-integration', label: '智能体集成', order: 35 }), 'settings-dsh-integration: panel')
}
