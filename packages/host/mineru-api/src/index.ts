import { setTimeout as delay } from 'node:timers/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  MineruPdfOcrResult,
  MineruSettings,
  SetMineruApiKeyInput,
  UpdateMineruSettingsInput,
} from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/documents'
import type {} from '@tiggyknowledge/llm-credentials'
import { HttpError, contributeSurface, pathSegment } from '@tiggyknowledge/plugin-surface'
import type {} from '@tiggyknowledge/producer-pdf'
import type {} from '@tiggyknowledge/settings-file'
import { unzipSync } from 'fflate'

declare module '@deepseek-ai/cordis' {
  interface Context {
    mineruApi: MineruApi
  }
}

const CREDENTIAL_ID = 'mineru'
const MAX_MINERU_BYTES = 200 * 1024 * 1024
const MAX_RESULT_ZIP_BYTES = 300 * 1024 * 1024
const MAX_MINERU_PAGES = 200
const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 15 * 60_000

interface MineruEnvelope {
  code?: number | string
  msg?: string
  data?: unknown
}

interface MineruBatchResult {
  state?: string
  task_id?: string
  full_zip_url?: string
  err_msg?: string
  extract_progress?: {
    extracted_pages?: number
    total_pages?: number
  }
}

export class MineruApi extends Service {
  static inject = ['knowledgeDocuments', 'llmCredentials', 'pdfProducer', 'settings']

  constructor(ctx: Context) {
    super(ctx, 'mineruApi')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-settings-mineru',
        moduleName: '@tiggyknowledge/client-settings-mineru',
        label: 'MinerU',
        description: 'MinerU document OCR settings',
      }],
      snapshot: { id: 'mineru-api', contribute: () => ({ mineru: this.settings() }) },
      routes: [
        {
          id: 'mineru-settings:update',
          methods: ['PUT'],
          path: '/api/settings/mineru',
          handler: async ({ assertSameOrigin, json, readJson }) => {
            assertSameOrigin()
            try {
              this.ctx.settings.updateMineru(await readJson<UpdateMineruSettingsInput>())
              json(this.settings())
            } catch (error) {
              if (error instanceof RangeError) throw new HttpError(400, 'invalid_mineru_settings', error.message)
              throw error
            }
          },
        },
        {
          id: 'mineru-settings:set-api-key',
          methods: ['PUT'],
          path: '/api/settings/mineru/api-key',
          handler: async ({ assertSameOrigin, json, readJson }) => {
            assertSameOrigin()
            const input = await readJson<SetMineruApiKeyInput>()
            try {
              this.ctx.llmCredentials.setStoredApiKey(CREDENTIAL_ID, input.apiKey, 'MinerU API Token')
              json(this.settings())
            } catch (error) {
              if (error instanceof RangeError) throw new HttpError(400, 'invalid_mineru_api_key', error.message)
              throw error
            }
          },
        },
        {
          id: 'mineru:pdf-ocr',
          methods: ['POST'],
          path: /^\/api\/documents\/([^/]+)\/mineru-ocr$/,
          handler: async ({ assertSameOrigin, json, match }) => {
            assertSameOrigin()
            try {
              json(await this.runPdfOcr(pathSegment(match)))
            } catch (error) {
              if (error instanceof RangeError) throw new HttpError(400, 'invalid_mineru_ocr', error.message)
              if (error instanceof HttpError) throw error
              throw new HttpError(502, 'mineru_ocr_failed', messageFrom(error, 'MinerU OCR 失败'))
            }
          },
        },
      ],
    })
  }

  settings(): MineruSettings {
    return this.ctx.settings.mineru(() => this.ctx.llmCredentials.storedStatus(CREDENTIAL_ID))
  }

  async runPdfOcr(documentId: string): Promise<MineruPdfOcrResult> {
    const settings = this.settings()
    if (!settings.enabled) throw new RangeError('MinerU 尚未开启，请先在设置中启用')
    if (!settings.apiKeyConfigured) throw new RangeError('尚未配置 MinerU API Token')

    const source = this.ctx.knowledgeDocuments.source(documentId)
    if (source.document.sourceType !== 'pdf') throw new RangeError('MinerU OCR 目前只支持 PDF')
    if (source.bytes.byteLength > MAX_MINERU_BYTES) throw new RangeError('MinerU 单文件不能超过 200 MB')

    const pdf = await this.ctx.pdfProducer.extract(source.document.originalName, source.bytes)
    if (pdf.pageCount > MAX_MINERU_PAGES) {
      throw new RangeError('MinerU 精准解析最多支持 200 页；更长的 PDF 请使用本地 OCR 或拆分后识别')
    }

    const apiKey = this.ctx.llmCredentials.getStoredApiKey(CREDENTIAL_ID)
    const batchId = await this.createUpload(settings, apiKey, source.document.id, source.document.originalName)
    await this.upload(batchId.uploadUrl, source.bytes)
    const completed = await this.waitForResult(settings, apiKey, batchId.batchId)
    const pages = await this.downloadPages(completed.fullZipUrl)
    const document = this.ctx.knowledgeDocuments.updatePdfOcr(documentId, { pages })
    return {
      document,
      taskId: completed.taskId,
      pageCount: pages.length,
      truncated: pages.length < pdf.pageCount,
    }
  }

  private async createUpload(
    settings: MineruSettings,
    apiKey: string,
    documentId: string,
    originalName: string,
  ): Promise<{ batchId: string, uploadUrl: string }> {
    const response = await mineruFetch(`${settings.baseUrl}/api/v4/file-urls/batch`, {
      body: JSON.stringify({
        files: [{
          name: safeFilename(originalName),
          data_id: documentId.replaceAll(/[^A-Za-z0-9_.-]/g, '-').slice(0, 128),
          is_ocr: true,
        }],
        model_version: settings.modelVersion,
        language: settings.language,
        enable_table: settings.enableTable,
        enable_formula: settings.enableFormula,
      }),
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
    })
    const envelope = await readEnvelope(response)
    const data = objectValue(envelope.data)
    const batchId = stringValue(data.batch_id)
    const uploadUrl = Array.isArray(data.file_urls) ? stringValue(data.file_urls[0]) : ''
    if (batchId === '' || uploadUrl === '') throw new Error('MinerU 未返回文件上传地址')
    assertSafeRemoteUrl(uploadUrl)
    return { batchId, uploadUrl }
  }

  private async upload(uploadUrl: string, bytes: Uint8Array): Promise<void> {
    const response = await mineruFetch(uploadUrl, {
      body: Buffer.from(bytes),
      method: 'PUT',
      signal: AbortSignal.timeout(5 * 60_000),
    })
    if (!response.ok) throw new Error(`MinerU 文件上传失败（HTTP ${response.status}）`)
  }

  private async waitForResult(
    settings: MineruSettings,
    apiKey: string,
    batchId: string,
  ): Promise<{ taskId: string, fullZipUrl: string }> {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
      const response = await mineruFetch(`${settings.baseUrl}/api/v4/extract-results/batch/${encodeURIComponent(batchId)}`, {
        headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(60_000),
      })
      const envelope = await readEnvelope(response)
      const data = objectValue(envelope.data)
      const results = Array.isArray(data.extract_result) ? data.extract_result : []
      const result = objectValue(results[0]) as MineruBatchResult
      const state = stringValue(result.state)
      if (state === 'done') {
        const fullZipUrl = stringValue(result.full_zip_url)
        if (fullZipUrl === '') throw new Error('MinerU 已完成解析，但未返回结果文件')
        assertSafeRemoteUrl(fullZipUrl)
        return { taskId: stringValue(result.task_id) || batchId, fullZipUrl }
      }
      if (state === 'failed') throw new Error(`MinerU 解析失败：${stringValue(result.err_msg) || '未知错误'}`)
      await delay(POLL_INTERVAL_MS)
    }
    throw new Error('MinerU 解析超时，请稍后重试')
  }

  private async downloadPages(url: string): Promise<string[]> {
    const response = await mineruFetch(url, { signal: AbortSignal.timeout(5 * 60_000) })
    if (!response.ok) throw new Error(`MinerU 结果下载失败（HTTP ${response.status}）`)
    const declaredSize = Number(response.headers.get('content-length') ?? 0)
    if (declaredSize > MAX_RESULT_ZIP_BYTES) throw new Error('MinerU 结果压缩包超过 300 MB')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_RESULT_ZIP_BYTES) throw new Error('MinerU 结果压缩包超过 300 MB')
    return pagesFromZip(bytes)
  }
}

function pagesFromZip(bytes: Uint8Array): string[] {
  const entries = unzipSync(bytes, {
    filter(file) {
      const name = file.name.toLocaleLowerCase('en-US')
      return name.endsWith('content_list.json') || name.endsWith('/full.md') || name === 'full.md'
    },
  })
  const contentEntry = Object.entries(entries).find(([name]) => name.toLocaleLowerCase('en-US').endsWith('content_list.json'))
  if (contentEntry !== undefined) {
    const pages = pagesFromContentList(new TextDecoder().decode(contentEntry[1]))
    if (pages.some(page => page.length > 0)) return pages
  }
  const markdownEntry = Object.entries(entries).find(([name]) => {
    const normalized = name.toLocaleLowerCase('en-US')
    return normalized.endsWith('/full.md') || normalized === 'full.md'
  })
  const markdown = markdownEntry === undefined ? '' : new TextDecoder().decode(markdownEntry[1]).trim()
  if (markdown === '') throw new Error('MinerU 结果中没有可用文字')
  return [markdown]
}

function pagesFromContentList(json: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const grouped = new Map<number, string[]>()
  let largestPage = 0
  for (const item of parsed) {
    const record = objectValue(item)
    const rawPage = Number(record.page_idx)
    const page = Number.isInteger(rawPage) && rawPage >= 0 ? rawPage : 0
    largestPage = Math.max(largestPage, page)
    const pieces = [
      stringValue(record.text),
      stringValue(record.table_body),
      stringValue(record.equation),
      ...stringArray(record.image_caption),
      ...stringArray(record.img_caption),
    ].map(value => value.trim()).filter(value => value.length > 0)
    if (pieces.length === 0) continue
    const current = grouped.get(page) ?? []
    for (const piece of pieces) if (!current.includes(piece)) current.push(piece)
    grouped.set(page, current)
  }
  if (grouped.size === 0) return []
  return Array.from({ length: Math.min(largestPage + 1, MAX_MINERU_PAGES) }, (_, index) => (grouped.get(index) ?? []).join('\n\n'))
}

async function readEnvelope(response: Response): Promise<MineruEnvelope> {
  let envelope: MineruEnvelope
  try {
    envelope = await response.json() as MineruEnvelope
  } catch {
    throw new Error(`MinerU 返回了无效响应（HTTP ${response.status}）`)
  }
  if (!response.ok || envelope.code !== 0) {
    throw new Error(`MinerU 请求失败：${envelope.msg?.trim() || `HTTP ${response.status}`}`)
  }
  return envelope
}

async function mineruFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    throw new Error(`无法连接 MinerU：${messageFrom(error, '网络请求失败')}`)
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function safeFilename(value: string): string {
  const name = value.replaceAll(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 180)
  return name.toLocaleLowerCase('en-US').endsWith('.pdf') ? name : `${name || 'document'}.pdf`
}

function assertSafeRemoteUrl(value: string): void {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('MinerU 返回了非 HTTPS 文件地址')
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback
}

export const __private = { pagesFromContentList, pagesFromZip }

export default MineruApi
