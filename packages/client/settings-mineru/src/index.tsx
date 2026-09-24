import type { Context } from '@deepseek-ai/cordis'
import { CheckCircle2, CloudUpload, Save } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type { SettingsPanelProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'
import type { MineruSettings, SystemSnapshot, UpdateMineruSettingsInput } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

const DEFAULT_SETTINGS: MineruSettings = {
  enabled: false,
  baseUrl: 'https://mineru.net',
  modelVersion: 'vlm',
  language: 'ch',
  enableTable: true,
  enableFormula: true,
  apiKeyConfigured: false,
}

function readSettings(value: unknown): MineruSettings {
  const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_SETTINGS.enabled,
    baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl : DEFAULT_SETTINGS.baseUrl,
    modelVersion: source.modelVersion === 'pipeline' ? 'pipeline' : 'vlm',
    language: typeof source.language === 'string' ? source.language : DEFAULT_SETTINGS.language,
    enableTable: typeof source.enableTable === 'boolean' ? source.enableTable : DEFAULT_SETTINGS.enableTable,
    enableFormula: typeof source.enableFormula === 'boolean' ? source.enableFormula : DEFAULT_SETTINGS.enableFormula,
    apiKeyConfigured: source.apiKeyConfigured === true,
    ...(typeof source.apiKeyPreview === 'string' ? { apiKeyPreview: source.apiKeyPreview } : {}),
  }
}

function applySnapshot(system: SystemSnapshot, settings: MineruSettings): SystemSnapshot {
  return {
    ...system,
    mineru: settings,
    settings: {
      ...system.settings,
      values: { ...system.settings.values, mineru: settings },
    },
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : '保存 MinerU 设置失败'
}

export function apply(ctx: Context): void {
  function MineruSettingsPanel({ system, error, onSystemChange }: SettingsPanelProps): JSX.Element {
    const snapshot = useMemo(() => readSettings(system?.mineru), [system])
    const [enabled, setEnabled] = useState(snapshot.enabled)
    const [baseUrl, setBaseUrl] = useState(snapshot.baseUrl)
    const [modelVersion, setModelVersion] = useState(snapshot.modelVersion)
    const [language, setLanguage] = useState(snapshot.language)
    const [enableTable, setEnableTable] = useState(snapshot.enableTable)
    const [enableFormula, setEnableFormula] = useState(snapshot.enableFormula)
    const [apiKey, setApiKey] = useState('')
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState<string>()
    const [saveError, setSaveError] = useState<string>()

    useEffect(() => {
      setEnabled(snapshot.enabled)
      setBaseUrl(snapshot.baseUrl)
      setModelVersion(snapshot.modelVersion)
      setLanguage(snapshot.language)
      setEnableTable(snapshot.enableTable)
      setEnableFormula(snapshot.enableFormula)
      setApiKey('')
    }, [snapshot])

    const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      if (saving) return
      setSaving(true)
      setMessage(undefined)
      setSaveError(undefined)
      try {
        const input: UpdateMineruSettingsInput = {
          enabled,
          baseUrl: baseUrl.trim().replace(/\/+$/, ''),
          modelVersion,
          language: language.trim(),
          enableTable,
          enableFormula,
        }
        let next = await ctx.connection.updateMineruSettings(input)
        if (apiKey.trim() !== '') next = await ctx.connection.setMineruApiKey({ apiKey: apiKey.trim() })
        if (system !== undefined) onSystemChange?.(applySnapshot(system, next))
        setApiKey('')
        setMessage(next.enabled
          ? next.apiKeyConfigured ? 'MinerU 已开启，可在 PDF 预览中使用云端 OCR' : '设置已保存；配置 API Token 后即可使用'
          : 'MinerU 设置已保存，当前保持关闭')
      } catch (reason) {
        setSaveError(messageFrom(reason))
      } finally {
        setSaving(false)
      }
    }

    const ready = snapshot.enabled && snapshot.apiKeyConfigured
    return (
      <div className="settings-section">
        <div className="section-heading">
          <div>
            <h2>MinerU 文档解析</h2>
            <p>使用 MinerU 精准解析接口识别扫描 PDF、表格和公式；默认关闭。</p>
          </div>
          <span className={`llm-status ${ready ? 'configured' : ''}`}>
            {ready ? <><CheckCircle2 size={14} />已就绪</> : snapshot.enabled ? '已开启 · 待配置' : '已关闭'}
          </span>
        </div>
        {error !== undefined && <div className="error-banner">{error}</div>}
        <div className="dsh-card">
          <div className="dsh-card-icon"><CloudUpload size={18} /></div>
          <div className="dsh-card-copy">
            <strong>隐私提示</strong>
            <span>开启后，只有在 PDF 预览中点击“MinerU OCR”时，原文件才会上传到 MinerU。单文件上限 200 MB、200 页。</span>
          </div>
        </div>
        <form onSubmit={event => void save(event)}>
          <section className="llm-block">
            <label className="dsh-toggle-row">
              <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />
              <span><strong>启用 MinerU</strong><small>关闭时不会向 MinerU 上传任何文件。</small></span>
            </label>
            <div className="llm-grid">
              <label className="llm-field llm-field-wide">
                <span>接口地址</span>
                <input required type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} />
              </label>
              <label className="llm-field llm-field-wide">
                <span>{snapshot.apiKeyConfigured ? `API Token（已配置${snapshot.apiKeyPreview === undefined ? '' : `：${snapshot.apiKeyPreview}`}）` : 'API Token'}</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  value={apiKey}
                  placeholder={snapshot.apiKeyConfigured ? '输入新 Token 可替换，留空保持不变' : '输入 MinerU API Token'}
                  onChange={event => setApiKey(event.target.value)}
                />
              </label>
              <label className="llm-field">
                <span>解析模型</span>
                <select value={modelVersion} onChange={event => setModelVersion(event.target.value === 'pipeline' ? 'pipeline' : 'vlm')}>
                  <option value="vlm">VLM（推荐）</option>
                  <option value="pipeline">Pipeline</option>
                </select>
              </label>
              <label className="llm-field">
                <span>语言代码</span>
                <input required value={language} placeholder="ch" onChange={event => setLanguage(event.target.value)} />
              </label>
              <label className="dsh-toggle-row">
                <input type="checkbox" checked={enableTable} onChange={event => setEnableTable(event.target.checked)} />
                <span><strong>识别表格</strong></span>
              </label>
              <label className="dsh-toggle-row">
                <input type="checkbox" checked={enableFormula} onChange={event => setEnableFormula(event.target.checked)} />
                <span><strong>识别公式</strong></span>
              </label>
            </div>
          </section>
          <div className="llm-actions">
            <button className="primary-button" type="submit" disabled={saving || baseUrl.trim() === '' || language.trim() === ''}>
              <Save size={15} />{saving ? '保存中...' : '保存 MinerU 设置'}
            </button>
          </div>
        </form>
        {message !== undefined && <div className="llm-message" role="status">{message}</div>}
        {saveError !== undefined && <div className="error-banner llm-result" role="alert">{saveError}</div>}
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerSettingsPanel({
    component: MineruSettingsPanel,
    id: 'mineru',
    label: 'MinerU',
    order: 27,
  }), 'settings-mineru: panel')
}
