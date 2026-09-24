import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { LEGACY_LLM_PROVIDER_ID } from '@tiggyknowledge/contracts'

export interface SecretCodec {
  encrypt(value: string): string
  decrypt(value: string): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    llmCredentials: LlmCredentials
    secretCodec: SecretCodec | undefined
  }
}

export interface Config {
  dataDir: string
}

export interface LlmProviderCredentialStatus {
  configured: boolean
  preview?: string
}

export interface LlmCredentialsSnapshot {
  environmentConfigured: boolean
  environmentPreview?: string
  providers: Record<string, LlmProviderCredentialStatus>
}

interface StoredCredential {
  encryptedApiKey: string
  preview: string
  updatedAt: string
}

interface StoredCredentialsFile {
  providers: Record<string, StoredCredential>
}

export class LlmCredentials extends Service {
  private readonly filename: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'llmCredentials')
    this.filename = resolve(config.dataDir, 'llm-credentials.json')
  }

  snapshot(): LlmCredentialsSnapshot {
    const environment = environmentStatus()
    const stored = this.read()
    const providers: Record<string, LlmProviderCredentialStatus> = {}
    for (const [providerId, credential] of Object.entries(stored.providers)) {
      providers[providerId] = { configured: true, preview: credential.preview }
    }
    const snapshot: LlmCredentialsSnapshot = {
      environmentConfigured: environment.configured,
      providers,
    }
    if (environment.preview !== undefined) snapshot.environmentPreview = environment.preview
    return snapshot
  }

  status(providerId: string): LlmProviderCredentialStatus {
    const stored = this.read().providers[providerId]
    if (stored !== undefined) return { configured: true, preview: stored.preview }
    return environmentStatus()
  }

  storedStatus(key: string): LlmProviderCredentialStatus {
    const stored = this.read().providers[key]
    return stored === undefined ? { configured: false } : { configured: true, preview: stored.preview }
  }

  getStoredApiKey(key: string): string {
    const stored = this.read().providers[key]
    if (stored === undefined) throw new Error('尚未配置 API Key')
    if (this.ctx.secretCodec === undefined) throw new Error('当前运行模式无法解密 API Key')
    return this.ctx.secretCodec.decrypt(stored.encryptedApiKey)
  }

  getApiKey(providerId: string): string {
    const stored = this.read().providers[providerId]
    if (stored !== undefined) {
      if (this.ctx.secretCodec === undefined) {
        throw new Error('当前运行模式无法解密 API Key，请设置 TIGGYKNOWLEDGE_LLM_API_KEY')
      }
      return this.ctx.secretCodec.decrypt(stored.encryptedApiKey)
    }
    const environmentKey = process.env.TIGGYKNOWLEDGE_LLM_API_KEY?.trim()
    if (environmentKey) return environmentKey
    throw new Error('尚未配置 LLM API Key')
  }

  setApiKey(providerId: string, apiKey: string): LlmProviderCredentialStatus {
    return this.setStoredApiKey(providerId, apiKey, 'LLM API Key')
  }

  setStoredApiKey(key: string, apiKey: string, label = 'API Key'): LlmProviderCredentialStatus {
    const id = typeof key === 'string' ? key.trim() : ''
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(id)) throw new RangeError('提供方 ID 无效')
    const value = apiKey.trim()
    if (value.length < 8 || value.length > 2_000) throw new RangeError(`${label}长度无效`)
    if (this.ctx.secretCodec === undefined) {
      throw new Error('当前运行模式不支持安全保存 API Key，请设置 TIGGYKNOWLEDGE_LLM_API_KEY')
    }
    const stored: StoredCredential = {
      encryptedApiKey: this.ctx.secretCodec.encrypt(value),
      preview: preview(value),
      updatedAt: new Date().toISOString(),
    }
    const next: StoredCredentialsFile = {
      providers: { ...this.read().providers, [id]: stored },
    }
    mkdirSync(dirname(this.filename), { recursive: true, mode: 0o700 })
    const temporary = `${this.filename}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600 })
    renameSync(temporary, this.filename)
    return { configured: true, preview: stored.preview }
  }

  private read(): StoredCredentialsFile {
    if (!existsSync(this.filename)) return { providers: {} }
    const value = JSON.parse(readFileSync(this.filename, 'utf8')) as Record<string, unknown>
    if (isLegacyCredentialFile(value)) {
      return {
        providers: {
          [LEGACY_LLM_PROVIDER_ID]: {
            encryptedApiKey: value.encryptedApiKey,
            preview: value.preview,
            updatedAt: value.updatedAt,
          },
        },
      }
    }
    const providersValue = value.providers
    if (typeof providersValue !== 'object' || providersValue === null || Array.isArray(providersValue)) {
      throw new Error('LLM 凭据文件格式无效')
    }
    const providers: Record<string, StoredCredential> = {}
    for (const [providerId, item] of Object.entries(providersValue as Record<string, unknown>)) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('LLM 凭据文件格式无效')
      const credential = item as Partial<StoredCredential>
      if (typeof credential.encryptedApiKey !== 'string' || typeof credential.preview !== 'string' || typeof credential.updatedAt !== 'string') {
        throw new Error('LLM 凭据文件格式无效')
      }
      providers[providerId] = {
        encryptedApiKey: credential.encryptedApiKey,
        preview: credential.preview,
        updatedAt: credential.updatedAt,
      }
    }
    return { providers }
  }
}

function environmentStatus(): LlmProviderCredentialStatus {
  const environmentKey = process.env.TIGGYKNOWLEDGE_LLM_API_KEY?.trim()
  return environmentKey
    ? { configured: true, preview: preview(environmentKey) }
    : { configured: false }
}

function isLegacyCredentialFile(value: Record<string, unknown>): value is StoredCredential & Record<string, unknown> {
  return typeof value.encryptedApiKey === 'string'
    && typeof value.preview === 'string'
    && typeof value.updatedAt === 'string'
    && (value.providers === undefined || typeof value.providers !== 'object')
}

function preview(value: string): string {
  return value.length <= 12 ? `${value.slice(0, 3)}…` : `${value.slice(0, 6)}…${value.slice(-4)}`
}

export default LlmCredentials
