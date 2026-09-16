import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { dump, load } from 'js-yaml'
import type { DshIntegrationAccessKeyMetadata, DshIntegrationSettings, GenerateDshIntegrationAccessKeyResult, LlmIntegrationSettings, SettingsSnapshot, UpdateDshIntegrationSettingsInput, UpdateLlmIntegrationSettingsInput } from '@tiggyknowledge/contracts'

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
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    requestTimeoutMs: 60_000,
    maxInputTokens: 100_000,
    maxOutputTokens: 4_000,
    apiKeyConfigured: false,
  } satisfies LlmIntegrationSettings,
}

interface StoredDshIntegrationSettings extends DshIntegrationSettings {
  accessKeyHash?: string
}

export class FileSettings extends Service {
  private readonly filename: string
  private values: Record<string, unknown> = {}

  constructor(ctx: Context, config: Config) {
    super(ctx, 'settings')
    this.filename = resolve(config.path)
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

  llmIntegration(apiKeyConfigured = false, apiKeyPreview?: string): LlmIntegrationSettings {
    const settings = normalizeLlmIntegration(this.values.llmIntegration)
    return {
      ...settings,
      apiKeyConfigured,
      ...(apiKeyPreview === undefined ? {} : { apiKeyPreview }),
    }
  }

  updateLlmIntegration(input: UpdateLlmIntegrationSettingsInput): SettingsSnapshot {
    const next = normalizeLlmIntegration({ ...normalizeLlmIntegration(this.values.llmIntegration), ...input })
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

function normalizeLlmIntegration(value: unknown): LlmIntegrationSettings {
  const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const baseUrl = normalizeLlmBaseUrl(source.baseUrl)
  const model = typeof source.model === 'string' ? source.model.trim() : ''
  if (model.length > 200) throw new RangeError('LLM 模型名称不能超过 200 个字符')
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : false,
    baseUrl,
    model,
    requestTimeoutMs: normalizeInteger(source.requestTimeoutMs, 60_000, 5_000, 300_000, '请求超时'),
    maxInputTokens: normalizeInteger(source.maxInputTokens, 100_000, 1_000, 2_000_000, '最大输入 Token'),
    maxOutputTokens: normalizeInteger(source.maxOutputTokens, 4_000, 256, 100_000, '最大输出 Token'),
    apiKeyConfigured: false,
  }
}

function normalizeLlmBaseUrl(value: unknown): string {
  const text = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : 'https://api.openai.com/v1'
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
