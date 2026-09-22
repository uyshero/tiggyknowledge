import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { dump, load } from 'js-yaml'
import type {
  DshIntegrationAccessKeyMetadata,
  DshIntegrationSettings,
  GenerateDshIntegrationAccessKeyResult,
  LlmIntegrationSettings,
  LlmProviderModel,
  LlmProviderSettings,
  SettingsSnapshot,
  UpdateDshIntegrationSettingsInput,
  UpdateLlmIntegrationSettingsInput,
} from '@tiggyknowledge/contracts'
import { contributeSurface } from '@tiggyknowledge/plugin-surface'
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MAX_INPUT_TOKENS,
  DEFAULT_LLM_MAX_OUTPUT_TOKENS,
  DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  LEGACY_LLM_MODEL_ID,
  LEGACY_LLM_PROVIDER_ID,
} from '@tiggyknowledge/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    settings: FileSettings
  }
}

export interface Config {
  path: string
}

const DEFAULT_SETTINGS: Record<string, unknown> = {
  general: {
    locale: 'zh-CN',
    theme: 'system',
    defaultSearchLimit: 20,
  },
  dshIntegration: {
    enabled: false,
    endpoint: 'http://127.0.0.1:3210',
    tokenEnvName: 'TIGGYKNOWLEDGE_TOKEN',
    defaultKnowledgeBaseIds: [],
  } satisfies DshIntegrationSettings,
  llmIntegration: {
    providers: [],
  } satisfies StoredLlmIntegration,
}

interface StoredDshIntegrationSettings extends DshIntegrationSettings {
  accessKeyHash?: string
}

interface StoredLlmProvider {
  id: string
  name: string
  baseUrl: string
  requestTimeoutMs: number
  maxInputTokens: number
  maxOutputTokens: number
  models: LlmProviderModel[]
}

interface StoredLlmIntegration {
  providers: StoredLlmProvider[]
  preferredModelId?: string
  wikiModelId?: string
  transcriptionModelId?: string
}

export type LlmCredentialLookup = (providerId: string) => { configured: boolean, preview?: string }

export class FileSettings extends Service {
  private readonly filename: string
  private values: Record<string, unknown> = {}

  constructor(ctx: Context, config: Config) {
    super(ctx, 'settings')
    this.filename = resolve(config.path)
    contributeSurface(ctx, {
      snapshot: { id: 'settings', contribute: () => ({ settings: this.snapshot() }) },
      clients: [
        {
          id: 'client-settings-general',
          moduleName: '@tiggyknowledge/client-settings-general',
          label: 'General Settings',
          description: 'General settings panel',
        },
        {
          id: 'client-settings-config',
          moduleName: '@tiggyknowledge/client-settings-config',
          label: 'Plugin Configuration',
          description: 'Plugin configuration panel',
        },
      ],
    })
  }

  [Service.init](): void {
    mkdirSync(dirname(this.filename), { recursive: true, mode: 0o700 })
    if (!existsSync(this.filename)) this.write(DEFAULT_SETTINGS)
    this.values = this.withDefaults(this.read())
    this.write(this.values)
  }

  snapshot(): SettingsSnapshot {
    return { path: this.filename, values: this.redactedValues() }
  }

  updateDshIntegration(input: UpdateDshIntegrationSettingsInput): SettingsSnapshot {
    const current = normalizeDshIntegration(this.values.dshIntegration)
    const next: DshIntegrationSettings = { ...current }

    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean') throw new RangeError('智能体集成开关必须是布尔值')
      next.enabled = input.enabled
    }
    if (input.endpoint !== undefined) next.endpoint = normalizeEndpoint(input.endpoint)
    if (input.tokenEnvName !== undefined) next.tokenEnvName = normalizeTokenEnvName(input.tokenEnvName)
    if (input.defaultKnowledgeBaseIds !== undefined) next.defaultKnowledgeBaseIds = normalizeLibraryIds(input.defaultKnowledgeBaseIds)

    this.values = { ...this.values, dshIntegration: next }
    this.write(this.values)
    return this.snapshot()
  }

  llmIntegration(lookup: LlmCredentialLookup = () => ({ configured: false })): LlmIntegrationSettings {
    const stored = normalizeLlmIntegration(this.values.llmIntegration)
    return attachLlmCredentials(stored, lookup)
  }

  updateLlmIntegration(input: UpdateLlmIntegrationSettingsInput): SettingsSnapshot {
    const next = applyLlmIntegrationUpdate(normalizeLlmIntegration(this.values.llmIntegration), input)
    this.values = { ...this.values, llmIntegration: next }
    this.write(this.values)
    return this.snapshot()
  }

  generateDshIntegrationAccessKey(): GenerateDshIntegrationAccessKeyResult {
    const accessKey = `tk_${randomBytes(32).toString('base64url')}`
    const current = normalizeDshIntegration(this.values.dshIntegration)
    const next: StoredDshIntegrationSettings = {
      ...current,
      accessKey: {
        createdAt: new Date().toISOString(),
        preview: previewAccessKey(accessKey),
      },
      accessKeyHash: hashAccessKey(accessKey),
    }
    this.values = { ...this.values, dshIntegration: next }
    this.write(this.values)
    return { accessKey, settings: this.snapshot() }
  }

  verifyDshIntegrationAccessKey(accessKey: string): boolean {
    const settings = normalizeDshIntegration(this.values.dshIntegration)
    if (settings.accessKeyHash === undefined || accessKey.length === 0) return false
    const expected = Buffer.from(settings.accessKeyHash, 'hex')
    const actual = Buffer.from(hashAccessKey(accessKey), 'hex')
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }

  private read(): Record<string, unknown> {
    const parsed: unknown = load(readFileSync(this.filename, 'utf8'))
    if (parsed === undefined) return {}
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('settings-file: settings document must be a YAML mapping')
    }
    return parsed as Record<string, unknown>
  }

  private withDefaults(values: Record<string, unknown>): Record<string, unknown> {
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...values,
      dshIntegration: normalizeDshIntegration(values.dshIntegration),
      llmIntegration: normalizeLlmIntegration(values.llmIntegration),
    }
  }

  private redactedValues(): Record<string, unknown> {
    const values = structuredClone(this.values)
    values.dshIntegration = publicDshIntegration(values.dshIntegration)
    return values
  }

  private write(values: Record<string, unknown>): void {
    const temporary = `${this.filename}.${process.pid}.tmp`
    writeFileSync(temporary, dump(values, { noRefs: true }), { mode: 0o600 })
    renameSync(temporary, this.filename)
  }
}

function normalizeDshIntegration(value: unknown): StoredDshIntegrationSettings {
  const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const settings: StoredDshIntegrationSettings = {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : false,
    endpoint: typeof source.endpoint === 'string' ? normalizeEndpoint(source.endpoint) : 'http://127.0.0.1:3210',
    tokenEnvName: typeof source.tokenEnvName === 'string' ? normalizeTokenEnvName(source.tokenEnvName) : 'TIGGYKNOWLEDGE_TOKEN',
    defaultKnowledgeBaseIds: Array.isArray(source.defaultKnowledgeBaseIds) ? normalizeLibraryIds(source.defaultKnowledgeBaseIds) : [],
  }
  const accessKey = normalizeAccessKeyMetadata(source.accessKey)
  if (accessKey !== undefined) settings.accessKey = accessKey
  if (typeof source.accessKeyHash === 'string' && source.accessKeyHash.length > 0) settings.accessKeyHash = source.accessKeyHash
  return settings
}

function publicDshIntegration(value: unknown): DshIntegrationSettings {
  const { accessKeyHash: _accessKeyHash, ...settings } = normalizeDshIntegration(value)
  return settings
}

function normalizeEndpoint(value: unknown): string {
  if (typeof value !== 'string') throw new RangeError('智能体集成 endpoint 必须是文本')
  const endpoint = value.trim().replace(/\/+$/, '')
  if (endpoint.length === 0 || endpoint.length > 500) throw new RangeError('智能体集成 endpoint 长度无效')
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new RangeError('智能体集成 endpoint 必须是合法 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new RangeError('智能体集成 endpoint 仅支持 http 或 https')
  return endpoint
}

function normalizeLibraryIds(value: unknown[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') throw new RangeError('默认知识库 ID 必须是文本')
    const id = item.trim()
    if (id.length === 0 || id.length > 200) throw new RangeError('默认知识库 ID 长度无效')
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  if (ids.length > 100) throw new RangeError('默认知识库最多选择 100 个')
  return ids
}

function normalizeTokenEnvName(value: unknown): string {
  if (typeof value !== 'string') throw new RangeError('Token 凭据名必须是文本')
  const name = value.trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) {
    throw new RangeError('Token 凭据名只能包含字母、数字、下划线，且不能以数字开头')
  }
  return name
}

function normalizeAccessKeyMetadata(value: unknown): DshIntegrationAccessKeyMetadata | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  if (typeof source.preview !== 'string' || typeof source.createdAt !== 'string') return undefined
  return { preview: source.preview, createdAt: source.createdAt }
}

function hashAccessKey(accessKey: string): string {
  return createHash('sha256').update(accessKey).digest('hex')
}

function previewAccessKey(accessKey: string): string {
  return `${accessKey.slice(0, 6)}…${accessKey.slice(-6)}`
}

function attachLlmCredentials(stored: StoredLlmIntegration, lookup: LlmCredentialLookup): LlmIntegrationSettings {
  const settings: LlmIntegrationSettings = {
    providers: stored.providers.map(provider => {
      const credentials = lookup(provider.id)
      const next: LlmProviderSettings = {
        ...provider,
        apiKeyConfigured: credentials.configured,
      }
      if (credentials.preview !== undefined) next.apiKeyPreview = credentials.preview
      return next
    }),
  }
  if (stored.preferredModelId !== undefined) settings.preferredModelId = stored.preferredModelId
  if (stored.wikiModelId !== undefined) settings.wikiModelId = stored.wikiModelId
  if (stored.transcriptionModelId !== undefined) settings.transcriptionModelId = stored.transcriptionModelId
  return settings
}

function applyLlmIntegrationUpdate(current: StoredLlmIntegration, input: UpdateLlmIntegrationSettingsInput): StoredLlmIntegration {
  const providers = input.providers === undefined ? current.providers : normalizeProviders(input.providers)
  const modelIds = new Set(providers.flatMap(provider => provider.models.map(model => model.id)))
  const preferredModelId = input.preferredModelId === undefined
    ? current.preferredModelId
    : input.preferredModelId
  const wikiModelId = input.wikiModelId === undefined
    ? current.wikiModelId
    : input.wikiModelId
  const transcriptionModelId = input.transcriptionModelId === undefined
    ? current.transcriptionModelId
    : input.transcriptionModelId
  const resolvedPreferred = preferredModelId !== null && preferredModelId !== undefined && modelIds.has(preferredModelId)
    ? preferredModelId
    : providers[0]?.models[0]?.id
  const resolvedWiki = wikiModelId !== null && wikiModelId !== undefined && modelIds.has(wikiModelId)
    ? wikiModelId
    : undefined
  const resolvedTranscription = transcriptionModelId !== null && transcriptionModelId !== undefined && modelIds.has(transcriptionModelId)
    ? transcriptionModelId
    : undefined
  const next: StoredLlmIntegration = { providers }
  if (resolvedPreferred !== undefined) next.preferredModelId = resolvedPreferred
  if (resolvedWiki !== undefined && resolvedWiki !== resolvedPreferred) next.wikiModelId = resolvedWiki
  if (resolvedTranscription !== undefined) next.transcriptionModelId = resolvedTranscription
  return next
}

function normalizeLlmIntegration(value: unknown): StoredLlmIntegration {
  const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  if (Array.isArray(source.providers)) {
    return applyLlmIntegrationUpdate({
      providers: normalizeProviders(source.providers),
      ...(typeof source.preferredModelId === 'string' ? { preferredModelId: source.preferredModelId } : {}),
      ...(typeof source.wikiModelId === 'string' ? { wikiModelId: source.wikiModelId } : {}),
      ...(typeof source.transcriptionModelId === 'string' ? { transcriptionModelId: source.transcriptionModelId } : {}),
    }, {})
  }
  return migrateLegacyLlmIntegration(source)
}

function migrateLegacyLlmIntegration(source: Record<string, unknown>): StoredLlmIntegration {
  const model = typeof source.model === 'string' ? source.model.trim() : ''
  if (model.length > 200) throw new RangeError('LLM 模型名称不能超过 200 个字符')
  if (model.length === 0) return { providers: [] }
  return applyLlmIntegrationUpdate({
    providers: [{
      id: LEGACY_LLM_PROVIDER_ID,
      name: '默认提供方',
      baseUrl: normalizeLlmBaseUrl(source.baseUrl),
      requestTimeoutMs: normalizeInteger(source.requestTimeoutMs, DEFAULT_LLM_REQUEST_TIMEOUT_MS, 5_000, 300_000, '请求超时'),
      maxInputTokens: normalizeInteger(source.maxInputTokens, DEFAULT_LLM_MAX_INPUT_TOKENS, 1_000, 2_000_000, '最大输入 Token'),
      maxOutputTokens: normalizeInteger(source.maxOutputTokens, DEFAULT_LLM_MAX_OUTPUT_TOKENS, 256, 100_000, '最大输出 Token'),
      models: [{
        id: LEGACY_LLM_MODEL_ID,
        name: model,
        model,
      }],
    }],
    preferredModelId: LEGACY_LLM_MODEL_ID,
  }, {})
}

function normalizeProviders(value: unknown[]): StoredLlmProvider[] {
  if (value.length > 20) throw new RangeError('最多配置 20 个模型提供方')
  const providers: StoredLlmProvider[] = []
  const providerIds = new Set<string>()
  const modelIds = new Set<string>()
  for (const item of value) {
    const provider = normalizeProvider(item, providerIds, modelIds)
    providers.push(provider)
  }
  return providers
}

function normalizeProvider(value: unknown, providerIds: Set<string>, modelIds: Set<string>): StoredLlmProvider {
  const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  if (source === undefined) throw new RangeError('模型提供方配置无效')
  const id = normalizeEntityId(source.id, '提供方')
  if (providerIds.has(id)) throw new RangeError('模型提供方 ID 不能重复')
  providerIds.add(id)
  const name = normalizeProviderName(source.name)
  const models = normalizeModels(source.models, modelIds)
  return {
    id,
    name,
    baseUrl: normalizeLlmBaseUrl(source.baseUrl),
    requestTimeoutMs: normalizeInteger(source.requestTimeoutMs, DEFAULT_LLM_REQUEST_TIMEOUT_MS, 5_000, 300_000, '请求超时'),
    maxInputTokens: normalizeInteger(source.maxInputTokens, DEFAULT_LLM_MAX_INPUT_TOKENS, 1_000, 2_000_000, '最大输入 Token'),
    maxOutputTokens: normalizeInteger(source.maxOutputTokens, DEFAULT_LLM_MAX_OUTPUT_TOKENS, 256, 100_000, '最大输出 Token'),
    models,
  }
}

function normalizeModels(value: unknown, modelIds: Set<string>): LlmProviderModel[] {
  if (!Array.isArray(value) || value.length === 0) throw new RangeError('每个提供方至少配置一个模型')
  if (value.length > 50) throw new RangeError('每个提供方最多配置 50 个模型')
  return value.map(item => {
    const source = typeof item === 'object' && item !== null && !Array.isArray(item) ? item as Record<string, unknown> : undefined
    if (source === undefined) throw new RangeError('模型配置无效')
    const id = normalizeEntityId(source.id, '模型')
    if (modelIds.has(id)) throw new RangeError('模型 ID 不能重复')
    modelIds.add(id)
    const model = normalizeModelId(source.model)
    const name = typeof source.name === 'string' && source.name.trim().length > 0 ? source.name.trim() : model
    if (name.length > 200) throw new RangeError('模型显示名称不能超过 200 个字符')
    return { id, name, model }
  })
}

function normalizeProviderName(value: unknown): string {
  if (typeof value !== 'string') throw new RangeError('提供方名称必须是文本')
  const name = value.trim()
  if (name.length === 0 || name.length > 80) throw new RangeError('提供方名称长度必须在 1 到 80 个字符之间')
  return name
}

function normalizeModelId(value: unknown): string {
  if (typeof value !== 'string') throw new RangeError('模型 ID 必须是文本')
  const model = value.trim()
  if (model.length === 0 || model.length > 200) throw new RangeError('模型 ID 长度必须在 1 到 200 个字符之间')
  return model
}

function normalizeEntityId(value: unknown, label: string): string {
  if (value === undefined || value === '') return randomUUID()
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(value)) {
    throw new RangeError(`${label} ID 无效`)
  }
  return value
}

function normalizeLlmBaseUrl(value: unknown): string {
  const text = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : DEFAULT_LLM_BASE_URL
  if (text.length === 0 || text.length > 500) throw new RangeError('LLM Base URL 长度无效')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new RangeError('LLM Base URL 必须是合法 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new RangeError('LLM Base URL 仅支持 http 或 https')
  return text
}

function normalizeInteger(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new RangeError(`${label}必须是 ${minimum} 到 ${maximum} 之间的整数`)
  }
  return number
}

export default FileSettings
