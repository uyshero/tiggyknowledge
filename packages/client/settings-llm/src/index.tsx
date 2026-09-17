import type { Context } from '@deepseek-ai/cordis'
import { CheckCircle2, ChevronDown, Pencil, Plus, Save, TestTube2, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type { SettingsPanelProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'
import type {
  LlmIntegrationSettings,
  LlmProviderSettings,
  SetLlmApiKeyInput,
  SystemSnapshot,
  UpdateLlmIntegrationSettingsInput,
} from '@tiggyknowledge/contracts'
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MAX_INPUT_TOKENS,
  DEFAULT_LLM_MAX_OUTPUT_TOKENS,
  DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  isLlmReady,
  llmModelChoices,
} from '@tiggyknowledge/contracts'
import './styles.css'

export const inject = ['clientApp', 'connection']

interface ProviderDraft {
  id: string
  name: string
  baseUrl: string
  requestTimeoutMs: number
  maxInputTokens: number
  maxOutputTokens: number
  models: Array<{ id: string, name: string, model: string }>
  apiKey: string
  apiKeyConfigured: boolean
  apiKeyPreview?: string
}

function createModelDraft(): ProviderDraft['models'][number] {
  return { id: crypto.randomUUID(), name: '', model: '' }
}

function createProviderDraft(): ProviderDraft {
  return {
    id: crypto.randomUUID(),
    name: '',
    baseUrl: DEFAULT_LLM_BASE_URL,
    requestTimeoutMs: DEFAULT_LLM_REQUEST_TIMEOUT_MS,
    maxInputTokens: DEFAULT_LLM_MAX_INPUT_TOKENS,
    maxOutputTokens: DEFAULT_LLM_MAX_OUTPUT_TOKENS,
    models: [createModelDraft()],
    apiKey: '',
    apiKeyConfigured: false,
  }
}

function toDraft(provider: LlmProviderSettings): ProviderDraft {
  const draft: ProviderDraft = {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    requestTimeoutMs: provider.requestTimeoutMs,
    maxInputTokens: provider.maxInputTokens,
    maxOutputTokens: provider.maxOutputTokens,
    models: provider.models.map(model => ({ id: model.id, name: model.name, model: model.model })),
    apiKey: '',
    apiKeyConfigured: provider.apiKeyConfigured,
  }
  if (provider.apiKeyPreview !== undefined) draft.apiKeyPreview = provider.apiKeyPreview
  return draft
}

function readSettings(value: unknown): LlmIntegrationSettings {
  const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const providers = Array.isArray(source.providers)
    ? source.providers.filter((item): item is LlmProviderSettings => typeof item === 'object' && item !== null)
    : []
  const settings: LlmIntegrationSettings = { providers }
  if (typeof source.preferredModelId === 'string') settings.preferredModelId = source.preferredModelId
  if (typeof source.wikiModelId === 'string') settings.wikiModelId = source.wikiModelId
  return settings
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
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
    const [providers, setProviders] = useState<ProviderDraft[]>(() => snapshot.providers.map(toDraft))
    const [preferredModelId, setPreferredModelId] = useState(snapshot.preferredModelId ?? '')
    const [wikiModelId, setWikiModelId] = useState(snapshot.wikiModelId ?? '')
    const [editingProviderId, setEditingProviderId] = useState<string>()
    const [advancedProviderIds, setAdvancedProviderIds] = useState<string[]>([])
    const [saving, setSaving] = useState(false)
    const [testingProviderId, setTestingProviderId] = useState<string>()
    const [message, setMessage] = useState<string>()
    const [saveError, setSaveError] = useState<string>()

    useEffect(() => {
      setProviders(snapshot.providers.map(toDraft))
      setPreferredModelId(snapshot.preferredModelId ?? '')
      setWikiModelId(snapshot.wikiModelId ?? '')
    }, [snapshot])

    const publishSettings = (settings: LlmIntegrationSettings): void => {
      setProviders(settings.providers.map(toDraft))
      setPreferredModelId(settings.preferredModelId ?? '')
      setWikiModelId(settings.wikiModelId ?? '')
      if (system !== undefined) onSystemChange?.(applyLlmSettingsSnapshot(system, settings))
    }

    const persistSettings = async (): Promise<LlmIntegrationSettings> => {
      const input: UpdateLlmIntegrationSettingsInput = {
        providers: providers.map(provider => ({
          id: provider.id,
          name: provider.name.trim(),
          baseUrl: provider.baseUrl.trim().replace(/\/+$/, ''),
          requestTimeoutMs: provider.requestTimeoutMs,
          maxInputTokens: provider.maxInputTokens,
          maxOutputTokens: provider.maxOutputTokens,
          models: provider.models.map(model => ({
            id: model.id,
            name: model.name.trim(),
            model: model.model.trim(),
          })),
        })),
        preferredModelId: preferredModelId.trim() === '' ? null : preferredModelId,
        wikiModelId: wikiModelId.trim() === '' || wikiModelId === preferredModelId ? null : wikiModelId,
      }
      let settings = await ctx.connection.updateLlmSettings(input)
      for (const provider of providers) {
        if (provider.apiKey.trim() === '') continue
        const keyInput: SetLlmApiKeyInput = { providerId: provider.id, apiKey: provider.apiKey.trim() }
        settings = await ctx.connection.setLlmApiKey(keyInput)
      }
      publishSettings(settings)
      return settings
    }

    const save = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
      event?.preventDefault()
      if (saving || testingProviderId !== undefined || !valid) return
      setSaving(true)
      setMessage(undefined)
      setSaveError(undefined)
      try {
        const settings = await persistSettings()
        setMessage(isLlmReady(settings) ? 'AI 模型配置已保存，可用于 Wiki 生成' : '配置已保存。配置 API Key 并选择模型后即可用于 Wiki 生成')
      } catch (reason) {
        setSaveError(messageFrom(reason, '保存 AI 模型配置失败'))
      } finally {
        setSaving(false)
      }
    }

    const testProvider = async (providerId: string): Promise<void> => {
      if (saving || testingProviderId !== undefined || !valid) return
      const draft = providers.find(provider => provider.id === providerId)
      if (draft === undefined || (!draft.apiKeyConfigured && draft.apiKey.trim() === '')) return
      setTestingProviderId(providerId)
      setMessage(undefined)
      setSaveError(undefined)
      try {
        const settings = await persistSettings()
        const modelId = settings.preferredModelId !== undefined
          && settings.providers.some(provider => provider.id === providerId && provider.models.some(model => model.id === settings.preferredModelId))
          ? settings.preferredModelId
          : settings.providers.find(provider => provider.id === providerId)?.models[0]?.id
        const result = await ctx.connection.testLlmConnection({
          providerId,
          ...(modelId === undefined ? {} : { modelId }),
        })
        setMessage(result.message || `连接成功，模型：${result.model}`)
      } catch (reason) {
        setSaveError(messageFrom(reason, '模型连接测试失败'))
      } finally {
        setTestingProviderId(undefined)
      }
    }

    const updateProvider = (providerId: string, patch: Partial<ProviderDraft>): void => {
      setProviders(items => items.map(provider => provider.id === providerId ? { ...provider, ...patch } : provider))
    }

    const valid = providers.every(provider => (
      provider.name.trim() !== ''
      && provider.baseUrl.trim() !== ''
      && provider.requestTimeoutMs >= 5_000
      && provider.maxInputTokens >= 1_000
      && provider.maxOutputTokens >= 256
      && provider.models.length > 0
      && provider.models.every(model => model.model.trim() !== '')
    ))
    const choices = llmModelChoices({
      providers: providers.map(provider => ({
        id: provider.id,
        name: provider.name.trim() || '未命名提供方',
        baseUrl: provider.baseUrl,
        requestTimeoutMs: provider.requestTimeoutMs,
        maxInputTokens: provider.maxInputTokens,
        maxOutputTokens: provider.maxOutputTokens,
        models: provider.models.filter(model => model.model.trim() !== '').map(model => ({
          id: model.id,
          name: model.name.trim() || model.model.trim(),
          model: model.model.trim(),
        })),
        apiKeyConfigured: provider.apiKeyConfigured || provider.apiKey.trim() !== '',
      })),
    })
    const ready = isLlmReady(snapshot)
    const busy = saving || testingProviderId !== undefined

    return (
      <div className="settings-section llm-settings-section">
        <div className="section-heading">
          <div><h2>AI 模型</h2><p>配置多个 OpenAI 兼容提供方，并选择 Wiki 生成使用的模型。</p></div>
          <span className={`llm-status ${ready ? 'configured' : ''}`}>
            {ready
              ? <><CheckCircle2 size={14} />已就绪</>
              : snapshot.providers.length > 0 ? '已保存 · 待补全' : '未配置'}
          </span>
        </div>
        {error !== undefined && <div className="error-banner">{error}</div>}
        <form onSubmit={event => void save(event)}>
          <section className="llm-block">
            <div className="llm-block-heading">
              <div>
                <strong>提供方</strong>
                <span>每个提供方可配置独立的接口地址、API Key 和多个模型。</span>
              </div>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => {
                const next = createProviderDraft()
                setProviders(items => [...items, next])
                setEditingProviderId(next.id)
              }}>
                <Plus size={15} />添加提供方
              </button>
            </div>
            {providers.length === 0 ? (
              <div className="llm-empty">还没有提供方。添加一个 OpenAI 兼容接口后即可选择模型。</div>
            ) : providers.map(provider => {
              const editing = editingProviderId === provider.id
              const modelNames = provider.models.map(model => model.name.trim() || model.model.trim()).filter(name => name.length > 0)
              const summary = [
                provider.baseUrl || '未填写地址',
                modelNames.length === 0 ? '未添加模型' : modelNames.join('、'),
                provider.apiKeyConfigured || provider.apiKey.trim() !== '' ? '已配置 Key' : '未配置 Key',
              ].join(' · ')
              return (
                <article className={`llm-provider ${editing ? 'editing' : ''}`} key={provider.id}>
                  <header className="llm-provider-summary">
                    <button className="llm-provider-toggle" type="button" aria-expanded={editing} title={editing ? '收起编辑' : '编辑提供方'} disabled={busy} onClick={() => setEditingProviderId(value => value === provider.id ? undefined : provider.id)}>
                      <span>
                        <strong>{provider.name.trim() || '未命名提供方'}</strong>
                        <small>{summary}</small>
                      </span>
                      {editing ? <ChevronDown size={16} /> : <Pencil size={14} />}
                    </button>
                    <div className="llm-provider-summary-actions">
                      <button
                        className="text-button"
                        type="button"
                        disabled={busy || !valid || (!provider.apiKeyConfigured && provider.apiKey.trim() === '')}
                        title={!provider.apiKeyConfigured && provider.apiKey.trim() === '' ? '请输入 API Key' : '保存当前修改并测试该提供方'}
                        onClick={() => void testProvider(provider.id)}
                      >
                        <TestTube2 size={14} />{testingProviderId === provider.id ? '测试中...' : '测试'}
                      </button>
                      <button className="text-button" type="button" disabled={busy} onClick={() => {
                        setProviders(items => items.filter(item => item.id !== provider.id))
                        setEditingProviderId(value => value === provider.id ? undefined : value)
                        setAdvancedProviderIds(items => items.filter(id => id !== provider.id))
                        setPreferredModelId(value => provider.models.some(model => model.id === value) ? '' : value)
                        setWikiModelId(value => provider.models.some(model => model.id === value) ? '' : value)
                      }}><Trash2 size={14} />删除</button>
                    </div>
                  </header>
                  {editing && (
                    <div className="llm-provider-editor">
                      <div className="llm-grid">
                        <label className="llm-field llm-field-wide">
                          <span>名称</span>
                          <input required value={provider.name} placeholder="例如 OpenAI 或 通义千问" onChange={event => updateProvider(provider.id, { name: event.target.value })} />
                        </label>
                        <label className="llm-field llm-field-wide">
                          <span>Base URL</span>
                          <input required type="url" value={provider.baseUrl} placeholder={DEFAULT_LLM_BASE_URL} onChange={event => updateProvider(provider.id, { baseUrl: event.target.value })} />
                        </label>
                        <label className="llm-field llm-field-wide">
                          <span>{provider.apiKeyConfigured ? `API Key（已配置${provider.apiKeyPreview === undefined ? '' : `：${provider.apiKeyPreview}`}）` : 'API Key'}</span>
                          <input autoComplete="new-password" type="password" value={provider.apiKey} placeholder={provider.apiKeyConfigured ? '输入新 Key 即可替换，留空则保持不变' : '输入 API Key'} onChange={event => updateProvider(provider.id, { apiKey: event.target.value })} />
                        </label>
                      </div>

                      <div className="llm-models">
                        <div className="llm-models-heading">
                          <strong>模型</strong>
                          <button className="text-button" type="button" disabled={busy} onClick={() => updateProvider(provider.id, { models: [...provider.models, createModelDraft()] })}>
                            <Plus size={13} />添加模型
                          </button>
                        </div>
                        {provider.models.map(model => (
                          <div className="llm-model-row" key={model.id}>
                            <label className="llm-field">
                              <span>模型 ID</span>
                              <input required value={model.model} placeholder="例如 gpt-4.1-mini" onChange={event => updateProvider(provider.id, {
                                models: provider.models.map(item => item.id === model.id ? { ...item, model: event.target.value } : item),
                              })} />
                            </label>
                            <button className="icon-button" type="button" disabled={busy || provider.models.length === 1} title={provider.models.length === 1 ? '每个提供方至少保留一个模型' : '删除模型'} onClick={() => {
                              updateProvider(provider.id, { models: provider.models.filter(item => item.id !== model.id) })
                              setPreferredModelId(value => value === model.id ? '' : value)
                              setWikiModelId(value => value === model.id ? '' : value)
                            }}><Trash2 size={14} /></button>
                          </div>
                        ))}
                      </div>

                      <button
                        className="llm-advanced-toggle"
                        type="button"
                        onClick={() => setAdvancedProviderIds(items => items.includes(provider.id) ? items.filter(id => id !== provider.id) : [...items, provider.id])}
                      >
                        高级选项
                        <ChevronDown className={advancedProviderIds.includes(provider.id) ? 'open' : ''} size={14} />
                      </button>
                      {advancedProviderIds.includes(provider.id) && (
                        <div className="llm-grid llm-advanced-grid">
                          <label className="llm-field">
                            <span>请求超时（毫秒）</span>
                            <input required min={5000} step={1000} type="number" value={provider.requestTimeoutMs} onChange={event => updateProvider(provider.id, { requestTimeoutMs: event.target.valueAsNumber })} />
                          </label>
                          <label className="llm-field">
                            <span>最大输入 token</span>
                            <input required min={1000} step={1} type="number" value={provider.maxInputTokens} onChange={event => updateProvider(provider.id, { maxInputTokens: event.target.valueAsNumber })} />
                          </label>
                          <label className="llm-field">
                            <span>最大输出 token</span>
                            <input required min={256} step={1} type="number" value={provider.maxOutputTokens} onChange={event => updateProvider(provider.id, { maxOutputTokens: event.target.valueAsNumber })} />
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </section>

          <section className="llm-block">
            <div className="llm-block-heading">
              <div>
                <strong>任务模型</strong>
                <span>配置好模型后，选择默认使用的首选模型；Wiki 生成默认使用首选模型。</span>
              </div>
            </div>
            <div className="llm-grid">
              <label className="llm-field">
                <span>首选模型</span>
                <select value={preferredModelId} disabled={choices.length === 0} onChange={event => setPreferredModelId(event.target.value)}>
                  <option value="">{choices.length === 0 ? '请先添加模型' : '选择首选模型'}</option>
                  {choices.map(choice => (
                    <option key={choice.id} value={choice.id}>{choice.label}{choice.apiKeyConfigured ? '' : '（未配置 Key）'}</option>
                  ))}
                </select>
              </label>
              <label className="llm-field">
                <span>Wiki 生成任务</span>
                <select value={wikiModelId} disabled={choices.length === 0} onChange={event => setWikiModelId(event.target.value)}>
                  <option value="">使用首选模型</option>
                  {choices.map(choice => (
                    <option key={choice.id} value={choice.id}>{choice.label}</option>
                  ))}
                </select>
                <small>未单独指定时，Wiki 生成会使用首选模型。</small>
              </label>
            </div>
          </section>

          <div className="llm-actions">
            <button className="primary-button" type="submit" disabled={busy || !valid}><Save size={15} />{saving ? '保存中...' : '保存'}</button>
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
