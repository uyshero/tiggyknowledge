import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'

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

interface StoredCredential {
  encryptedApiKey: string
  preview: string
  updatedAt: string
}

export class LlmCredentials extends Service {
  private readonly filename: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'llmCredentials')
    this.filename = resolve(config.dataDir, 'llm-credentials.json')
  }

  snapshot(): { configured: boolean, preview?: string } {
    const environmentKey = process.env.TIGGYKNOWLEDGE_LLM_API_KEY?.trim()
    if (environmentKey) return { configured: true, preview: preview(environmentKey) }
    const stored = this.read()
    return stored === undefined ? { configured: false } : { configured: true, preview: stored.preview }
  }

  getApiKey(): string {
    const environmentKey = process.env.TIGGYKNOWLEDGE_LLM_API_KEY?.trim()
    if (environmentKey) return environmentKey
    const stored = this.read()
    if (stored === undefined) throw new Error('尚未配置 LLM API Key')
    if (this.ctx.secretCodec === undefined) {
      throw new Error('当前运行模式无法解密 API Key，请设置 TIGGYKNOWLEDGE_LLM_API_KEY')
    }
    return this.ctx.secretCodec.decrypt(stored.encryptedApiKey)
  }

  setApiKey(apiKey: string): { configured: true, preview: string } {
    const value = apiKey.trim()
    if (value.length < 8 || value.length > 2_000) throw new RangeError('LLM API Key 长度无效')
    if (this.ctx.secretCodec === undefined) {
      throw new Error('当前运行模式不支持安全保存 API Key，请设置 TIGGYKNOWLEDGE_LLM_API_KEY')
    }
    const stored: StoredCredential = {
      encryptedApiKey: this.ctx.secretCodec.encrypt(value),
      preview: preview(value),
      updatedAt: new Date().toISOString(),
    }
    mkdirSync(dirname(this.filename), { recursive: true, mode: 0o700 })
    const temporary = `${this.filename}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(stored)}\n`, { mode: 0o600 })
    renameSync(temporary, this.filename)
    return { configured: true, preview: stored.preview }
  }

  private read(): StoredCredential | undefined {
    if (!existsSync(this.filename)) return undefined
    const value = JSON.parse(readFileSync(this.filename, 'utf8')) as Partial<StoredCredential>
    if (typeof value.encryptedApiKey !== 'string' || typeof value.preview !== 'string' || typeof value.updatedAt !== 'string') {
      throw new Error('LLM 凭据文件格式无效')
    }
    return value as StoredCredential
  }
}

function preview(value: string): string {
  return value.length <= 12 ? `${value.slice(0, 3)}…` : `${value.slice(0, 6)}…${value.slice(-4)}`
}

export default LlmCredentials
