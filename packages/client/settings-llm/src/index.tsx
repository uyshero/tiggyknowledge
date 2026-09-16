import type { Context } from '@deepseek-ai/cordis'
import { CheckCircle2, KeyRound, Save, TestTube2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type { SettingsPanelProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'
import type { LlmIntegrationSettings, SetLlmApiKeyInput, SystemSnapshot, UpdateLlmIntegrationSettingsInput } from '@tiggyknowledge/contracts'
import './styles.css'

export const inject = ['clientApp', 'connection']

const DEFAULT_SETTINGS: LlmIntegrationSettings = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  requestTimeoutMs: 120000,
  maxInputTokens: 32000,
  maxOutputTokens: 4096,
  apiKeyConfigured: false,
}

function readSettings(value: unknown): LlmIntegrationSettings {
  const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_SETTINGS.enabled,
    baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl : DEFAULT_SETTINGS.baseUrl,
    model: typeof source.model === 'string' ? source.model : DEFAULT_SETTINGS.model,
    requestTimeoutMs: typeof source.requestTimeoutMs === 'number' ? source.requestTimeoutMs : DEFAULT_SETTINGS.requestTimeoutMs,
    maxInputTokens: typeof source.maxInputTokens === 'number' ? source.maxInputTokens : DEFAULT_SETTINGS.maxInputTokens,
    maxOutputTokens: typeof source.maxOutputTokens === 'number' ? source.maxOutputTokens : DEFAULT_SETTINGS.maxOutputTokens,
    apiKeyConfigured: source.apiKeyConfigured === true,
    ...(typeof source.apiKeyPreview === 'string' ? { apiKeyPreview: source.apiKeyPreview } : {}),
  }
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

interface ApiKeyMeta {
  apiKeyConfigured: boolean
  apiKeyPreview?: string
}

export function applyLlmSettingsSnapshot(system: SystemSnapshot, settings: LlmIntegrationSettings): SystemSnapshot {
  return {
    ...system,
    llm: settings,
    settings: {
      ...system.settings,
      values: { ...system.settings.values, llmIntegration: settings },
    },
  }
}

export function apply(ctx: Context): void {
  function LlmSettingsPanel({ system, error, onSystemChange }: SettingsPanelProps): JSX.Element {
    const snapshot = useMemo(() => readSettings(system?.llm), [system])
    const [enabled, setEnabled] = useState(snapshot.enabled)
    const [baseUrl, setBaseUrl] = useState(snapshot.baseUrl)
    const [model, setModel] = useState(snapshot.model)
    const [requestTimeoutMs, setRequestTimeoutMs] = useState(snapshot.requestTimeoutMs)
    const [maxInputTokens, setMaxInputTokens] = useState(snapshot.maxInputTokens)
    const [maxOutputTokens, setMaxOutputTokens] = useState(snapshot.maxOutputTokens)
    const [apiKey, setApiKey] = useState('')
    const [apiKeyMeta, setApiKeyMeta] = useState<ApiKeyMeta>({
      apiKeyConfigured: snapshot.apiKeyConfigured,
      ...(snapshot.apiKeyPreview === undefined ? {} : { apiKeyPreview: snapshot.apiKeyPreview }),
    })
    const [saving, setSaving] = useState(false)
    const [testing, setTesting] = useState(false)
    const [message, setMessage] = useState<string>()
    const [saveError, setSaveError] = useState<string>()

    useEffect(() => {
      setEnabled(snapshot.enabled)
      setBaseUrl(snapshot.baseUrl)
      setModel(snapshot.model)
      setRequestTimeoutMs(snapshot.requestTimeoutMs)
      setMaxInputTokens(snapshot.maxInputTokens)
      setMaxOutputTokens(snapshot.maxOutputTokens)
      setApiKeyMeta({
        apiKeyConfigured: snapshot.apiKeyConfigured,
        ...(snapshot.apiKeyPreview === undefined ? {} : { apiKeyPreview: snapshot.apiKeyPreview }),
      })
    }, [snapshot])

    const publishSettings = (settings: LlmIntegrationSettings): void => {
      setApiKeyMeta({
        apiKeyConfigured: settings.apiKeyConfigured,
        ...(settings.apiKeyPreview === undefined ? {} : { apiKeyPreview: settings.apiKeyPreview }),
      })
      if (system !== undefined) {
        onSystemChange?.(applyLlmSettingsSnapshot(system, settings))
      }
    }

    const persistSettings = async (): Promise<LlmIntegrationSettings> => {
      const input: UpdateLlmIntegrationSettingsInput = {
        enabled,
        baseUrl: baseUrl.trim().replace(/\/+$/, ''),
        model: model.trim(),
        requestTimeoutMs,
        maxInputTokens,
        maxOutputTokens,
      }
      let settings = await ctx.connection.updateLlmSettings(input)
      if (apiKey.trim() !== '') {
        const keyInput: SetLlmApiKeyInput = { apiKey: apiKey.trim() }
        settings = await ctx.connection.setLlmApiKey(keyInput)
        setApiKey('')
      }
      publishSettings(settings)
      return settings
    }

    const save = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
      event?.preventDefault()
      if (saving || testing || baseUrl.trim() === '' || model.trim() === '') return
      setSaving(true)
      setMessage(undefined)
      setSaveError(undefined)
      try {
        const settings = await persistSettings()
        setMessage(settings.enabled ? 'AI 模型配置已保存并启用' : '配置已保存；当前未启用，Wiki 不会使用该模型')
      } catch (reason) {
        setSaveError(messageFrom(reason, '保存 AI 模型配置失败'))
      } finally {
        setSaving(false)
      }
    }

    const testConnection = async (): Promise<void> => {
      if (testing || saving || !valid || (!apiKeyMeta.apiKeyConfigured && apiKey.trim() === '')) return
      setTesting(true)
      setMessage(undefined)
      setSaveError(undefined)
      try {
        const settings = await persistSettings()
        const result = await ctx.connection.testLlmConnection()
        const suffix = settings.enabled ? '' : '；当前尚未启用，Wiki 不会使用该模型'
        setMessage(`${result.message || `连接成功，模型：${result.model}`}${suffix}`)
      } catch (reason) {
        setSaveError(messageFrom(reason, '模型连接测试失败'))
      } finally {
        setTesting(false)
      }
    }

    const valid = baseUrl.trim() !== ''
      && model.trim() !== ''
      && requestTimeoutMs >= 1000
      && maxInputTokens >= 1
      && maxOutputTokens >= 1

    return (
      <div className="settings-section llm-settings-section">
        <div className="section-heading">
          <div><h2>AI 模型</h2><p>配置用于生成 LLM Wiki 的 OpenAI 兼容接口。</p></div>
          <span className={`llm-status ${enabled && apiKeyMeta.apiKeyConfigured ? 'configured' : ''}`}>
            {enabled && apiKeyMeta.apiKeyConfigured
              ? <><CheckCircle2 size={14} />已启用</>
              : apiKeyMeta.apiKeyConfigured ? '已保存 · 未启用' : '未就绪'}
          </span>
        </div>
        {error !== undefined && <div className="error-banner">{error}</div>}
        <form onSubmit={event => void save(event)}>
          <label className="llm-toggle">
            <input checked={enabled} type="checkbox" onChange={event => setEnabled(event.target.checked)} />
            <span><strong>启用 AI 模型</strong><small>关闭后不会启动 Wiki 生成任务。</small></span>
          </label>

          <div className="llm-grid">
            <label className="llm-field llm-field-wide">
              <span>Base URL</span>
              <input required type="url" value={baseUrl} placeholder="https://api.openai.com/v1" onChange={event => setBaseUrl(event.target.value)} />
              <small>填写 OpenAI 兼容 API 的基础地址，不含具体接口路径。</small>
            </label>
            <label className="llm-field">
              <span>模型</span>
              <input required value={model} placeholder="例如 gpt-4.1-mini" onChange={event => setModel(event.target.value)} />
            </label>
            <label className="llm-field">
              <span>请求超时（毫秒）</span>
              <input required min={1000} step={1000} type="number" value={requestTimeoutMs} onChange={event => setRequestTimeoutMs(event.target.valueAsNumber)} />
            </label>
            <label className="llm-field">
              <span>最大输入 token</span>
              <input required min={1} step={1} type="number" value={maxInputTokens} onChange={event => setMaxInputTokens(event.target.valueAsNumber)} />
            </label>
            <label className="llm-field">
              <span>最大输出 token</span>
              <input required min={1} step={1} type="number" value={maxOutputTokens} onChange={event => setMaxOutputTokens(event.target.valueAsNumber)} />
            </label>
          </div>

          <section className="llm-key-panel">
            <div className="llm-key-heading">
              <div className="llm-key-icon"><KeyRound size={18} /></div>
              <div>
                <strong>API Key</strong>
                <span>{apiKeyMeta.apiKeyConfigured ? `已配置${apiKeyMeta.apiKeyPreview === undefined ? '' : `：${apiKeyMeta.apiKeyPreview}`}` : '尚未配置'}</span>
              </div>
            </div>
            <label className="llm-field">
              <span>{apiKeyMeta.apiKeyConfigured ? '更换 API Key（可选）' : 'API Key'}</span>
              <input autoComplete="new-password" type="password" value={apiKey} placeholder={apiKeyMeta.apiKeyConfigured ? '输入新 Key 即可替换，留空则保持不变' : '输入 API Key'} onChange={event => setApiKey(event.target.value)} />
              <small>保存时可随时替换；出于安全考虑，已保存的 Key 不会回显原文。</small>
            </label>
          </section>

          <div className="llm-actions">
            <button className="primary-button" type="submit" disabled={saving || testing || !valid}><Save size={15} />{saving ? '保存中...' : '保存'}</button>
            <button className="secondary-button" type="button" disabled={testing || saving || !valid || (!apiKeyMeta.apiKeyConfigured && apiKey.trim() === '')} title={!apiKeyMeta.apiKeyConfigured && apiKey.trim() === '' ? '请输入 API Key' : '保存当前修改并测试'} onClick={() => void testConnection()}><TestTube2 size={15} />{testing ? '测试中...' : '保存并测试'}</button>
          </div>
        </form>
        {message !== undefined && <div className="llm-message" role="status">{message}</div>}
        {saveError !== undefined && <div className="error-banner llm-result" role="alert">{saveError}</div>}
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerSettingsPanel({
    component: LlmSettingsPanel,
    id: 'llm',
    label: 'AI 模型',
    order: 25,
  }), 'settings-llm: panel')
}
