import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type {} from '@tiggyknowledge/chunker-basic'
import type {} from '@tiggyknowledge/content-local'
import type {
  AttachStudioNoteImageInput,
  CreateStudioCategoryInput,
  CreateStudioNoteInput,
  DeleteStudioCategoryInput,
  CreateStudioRecordingInput,
  KnowledgeDocument,
  KnowledgeNoteImage,
  RenameStudioCategoryInput,
  StudioNoteImageAttachment,
  StudioWorkspace,
  TransferStudioDocumentInput,
  UpdateKnowledgeMarkdownNoteInput,
  UpdateStudioRecordingInput,
} from '@tiggyknowledge/contracts'
import { isTranscriptionReady, resolveTranscriptionLlmModel } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/index-fts'
import type {} from '@tiggyknowledge/llm-client'
import type {} from '@tiggyknowledge/llm-credentials'
import { contributeSurface, httpFromRange, pathSegment } from '@tiggyknowledge/plugin-surface'
import type {} from '@tiggyknowledge/settings-file'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeStudio: KnowledgeStudio
  }
}

const MAX_RECORDING_JSON_BYTES = 22 * 1024 * 1024
const MAX_RECORDING_BYTES = 15 * 1024 * 1024
const MAX_IMAGE_JSON_BYTES = 12 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/x-m4a',
  'audio/aac',
])

export class KnowledgeStudio extends Service {
  static inject = ['knowledgeCatalog', 'knowledgeContent', 'knowledgeChunker', 'knowledgeIndex', 'llmClient', 'llmCredentials', 'settings']

  constructor(ctx: Context) {
    super(ctx, 'knowledgeStudio')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-ui-studio',
        moduleName: '@tiggyknowledge/client-ui-studio',
        label: 'Studio',
        description: 'Draft notes and recordings outside the knowledge library',
      }],
      routes: [
        {
          id: 'studio:workspace',
          methods: ['GET'],
          path: '/api/studio',
          handler: ({ json }) => {
            json(this.workspace())
          },
        },
        {
          id: 'studio:create-note',
          methods: ['POST'],
          path: '/api/studio/notes',
          handler: async ({ assertSameOrigin, json, readJson }) => {
            assertSameOrigin()
            try {
              json(this.createNote(await readJson<CreateStudioNoteInput>()), 201)
            } catch (error) {
              throw httpFromRange(error, 'invalid_studio_note')
            }
          },
        },
        {
          id: 'studio:update-note',
          methods: ['PUT'],
          path: /^\/api\/studio\/notes\/([^/]+)$/,
          handler: async ({ assertSameOrigin, json, match, readJson }) => {
            assertSameOrigin()
            try {
              json(this.updateNote(pathSegment(match), await readJson<UpdateKnowledgeMarkdownNoteInput>()))
            } catch (error) {
              throw httpFromRange(error, 'invalid_studio_note')
            }
          },
        },
        {
          id: 'studio:create-recording',
          methods: ['POST'],
          path: '/api/studio/recordings',
          handler: async ({ assertSameOrigin, json, readJson }) => {
            assertSameOrigin()
            try {
              json(this.createRecording(await readJson<CreateStudioRecordingInput>(MAX_RECORDING_JSON_BYTES)), 201)
            } catch (error) {
              throw httpFromRange(error, 'invalid_studio_recording')
            }
          },
        },
        {
          id: 'studio:update-recording',
          methods: ['PUT'],
          path: /^\/api\/studio\/recordings\/([^/]+)$/,
          handler: async ({ assertSameOrigin, json, match, readJson }) => {
            assertSameOrigin()
            try {
              json(this.updateRecording(pathSegment(match), await readJson<UpdateStudioRecordingInput>()))
            } catch (error) {
              throw httpFromRange(error, 'invalid_studio_recording')
            }
          },
        },
        {
          id: 'studio:transcribe',
          methods: ['POST'],
          path: /^\/api\/studio\/recordings\/([^/]+)\/transcribe$/,
          handler: async ({ assertSameOrigin, json, match }) => {
            assertSameOrigin()
            try {
              json(await this.transcribe(pathSegment(match)))
            } catch (error) {
              throw httpFromRange(error, 'studio_transcribe_failed')
            }
          },
        },
        {
          id: 'studio:transfer',
          methods: ['POST'],
          path: /^\/api\/studio\/documents\/([^/]+)\/transfer$/,
          handler: async ({ assertSameOrigin, json, match, readJson }) => {
            assertSameOrigin()
            try {
              json(this.transfer(pathSegment(match), await readJson<TransferStudioDocumentInput>()))
            } catch (error) {
              throw httpFromRange(error, 'invalid_studio_transfer')
            }
          },
        },
        {
          id: 'studio:create-category',
          methods: ['POST'],
          path: '/api/studio/categories',
          handler: async ({ assertSameOrigin, json, readJson }) => {
            assertSameOrigin()
            try {
              json(this.createCategory(await readJson<CreateStudioCategoryInput>()), 201)
            } catch (error) {
              throw httpFromRange(error, 'invalid_studio_category')
            }
          },
        },
        {
          id: 'studio:attach-note-image',
          methods: ['POST'],
          path: /^\/api\/studio\/notes\/([^/]+)\/images$/,
          handler: async ({ assertSameOrigin, json, match, readJson }) => {
            assertSameOrigin()
            try {
              json(this.attachNoteImage(pathSegment(match), await readJson<AttachStudioNoteImageInput>(MAX_IMAGE_JSON_BYTES)), 201)
            } catch (error) {
              throw httpFromRange(error, 'invalid_studio_image')
            }
          },
        },
        {
          id: 'studio:rename-category',
          methods: ['POST'],
          path: '/api/studio/categories/rename',
          handler: async ({ assertSameOrigin, json, readJson }) => {
            assertSameOrigin()
            try {
              json(this.renameCategory(await readJson<RenameStudioCategoryInput>()))
            } catch (error) {
              throw httpFromRange(error, 'invalid_studio_category')
            }
          },
        },
        {
          id: 'studio:delete-category',
          methods: ['POST'],
          path: '/api/studio/categories/delete',
          handler: async ({ assertSameOrigin, json, readJson }) => {
            assertSameOrigin()
            try {
              json(this.deleteCategory(await readJson<DeleteStudioCategoryInput>()))
            } catch (error) {
              throw httpFromRange(error, 'invalid_studio_category')
            }
          },
        },
      ],
    })
  }

  workspace(): StudioWorkspace {
    const library = this.ctx.knowledgeCatalog.ensureStudioLibrary()
    const items = this.ctx.knowledgeCatalog.listDocuments(library.id)
    return { library, items, categories: this.listCategories(items), transcriptionReady: this.transcriptionReady() }
  }

  createNote(input: CreateStudioNoteInput): KnowledgeDocument {
    const note = validateNote(input)
    const category = validateCategory(input.category)
    const studio = this.ctx.knowledgeCatalog.ensureStudioLibrary()
    const markdown = `# ${note.title}\n\n${note.body}\n`
    const asset = this.ctx.knowledgeContent.save(new TextEncoder().encode(markdown))
    this.ctx.knowledgeCatalog.registerAsset(asset)
    const created = this.ctx.knowledgeCatalog.createDocument({
      libraryId: studio.id,
      title: note.title,
      originalName: filename(note.title, 'md'),
      sourceType: 'markdown',
      sourceAssetId: asset.id,
      contentHash: asset.contentHash,
      sizeBytes: asset.sizeBytes,
      extra: { category },
    })
    this.rememberCategory(category)
    return created
  }

  updateNote(documentId: string, input: UpdateKnowledgeMarkdownNoteInput & { category?: string }): KnowledgeDocument {
    const document = this.requireStudioDocument(documentId)
    if (document.sourceType !== 'markdown') throw new RangeError('只有笔记支持正文编辑')
    const note = validateNote({ title: input.title, body: input.body })
    const category = validateCategory(input.category ?? document.category)
    const previous = parseMarkdownNote(new TextDecoder('utf-8').decode(this.ctx.knowledgeContent.read(document.sourceAssetId)))
    const contentChanged = previous.title !== note.title || previous.body !== note.body
    let updated: KnowledgeDocument
    if (contentChanged) {
      this.ctx.knowledgeCatalog.addDocumentRevision({
        documentId,
        title: previous.title || document.title,
        body: previous.body,
        sourceAssetId: document.sourceAssetId,
      })
      const markdown = `# ${note.title}\n\n${note.body}\n`
      const asset = this.ctx.knowledgeContent.save(new TextEncoder().encode(markdown))
      this.ctx.knowledgeCatalog.registerAsset(asset)
      updated = this.ctx.knowledgeCatalog.updateDocument(documentId, {
        title: note.title,
        sourceAssetId: asset.id,
        contentHash: asset.contentHash,
        sizeBytes: asset.sizeBytes,
        indexStatus: 'pending',
        extra: { category },
      })
    } else {
      updated = this.ctx.knowledgeCatalog.updateDocument(documentId, {
        title: note.title,
        extra: { category },
      })
    }
    this.rememberCategory(category)
    return updated
  }

  attachNoteImage(documentId: string, input: AttachStudioNoteImageInput): StudioNoteImageAttachment {
    const document = this.requireStudioDocument(documentId)
    if (document.sourceType !== 'markdown') throw new RangeError('只有笔记支持插入图片')
    const mimeType = normalizeImageMimeType(input.mimeType)
    const name = validateImageName(input.name)
    const bytes = decodeImage(input.imageBase64)
    const asset = this.ctx.knowledgeContent.save(bytes)
    this.ctx.knowledgeCatalog.registerAsset(asset)
    const image: KnowledgeNoteImage = { id: asset.id, mimeType, name }
    const current = document.images ?? []
    const images = [...current.filter(item => item.id !== image.id), image]
    const updated = this.ctx.knowledgeCatalog.updateDocument(documentId, {
      extra: {
        images,
        category: validateCategory(document.category),
        ...(document.transcript === undefined ? {} : { transcript: document.transcript }),
        ...(document.audioMimeType === undefined ? {} : { mimeType: document.audioMimeType }),
      },
    })
    const url = `/api/documents/${documentId}/images/${image.id}`
    return { document: updated, image, url, markdown: `![${image.name}](${url})` }
  }

  createRecording(input: CreateStudioRecordingInput): KnowledgeDocument {
    const title = validateTitle(input.title)
    const mimeType = normalizeMimeType(input.mimeType)
    const transcript = validateTranscript(input.transcript)
    const category = validateCategory(input.category)
    const bytes = decodeAudio(input.audioBase64)
    const studio = this.ctx.knowledgeCatalog.ensureStudioLibrary()
    const asset = this.ctx.knowledgeContent.save(bytes)
    this.ctx.knowledgeCatalog.registerAsset(asset)
    const created = this.ctx.knowledgeCatalog.createDocument({
      libraryId: studio.id,
      title,
      originalName: filename(title, extensionFor(mimeType)),
      sourceType: 'audio',
      sourceAssetId: asset.id,
      contentHash: asset.contentHash,
      sizeBytes: asset.sizeBytes,
      extra: { transcript, mimeType, category },
    })
    this.rememberCategory(category)
    return created
  }

  updateRecording(documentId: string, input: UpdateStudioRecordingInput): KnowledgeDocument {
    const document = this.requireStudioDocument(documentId)
    if (document.sourceType !== 'audio') throw new RangeError('只有录音支持转写编辑')
    const title = input.title === undefined ? document.title : validateTitle(input.title)
    const transcript = input.transcript === undefined ? (document.transcript ?? '') : validateTranscript(input.transcript)
    const category = input.category === undefined ? validateCategory(document.category) : validateCategory(input.category)
    const updated = this.ctx.knowledgeCatalog.updateDocument(documentId, {
      title,
      extra: {
        transcript,
        category,
        ...(document.audioMimeType === undefined ? {} : { mimeType: document.audioMimeType }),
      },
    })
    this.rememberCategory(category)
    return updated
  }

  async transcribe(documentId: string): Promise<KnowledgeDocument> {
    const document = this.requireStudioDocument(documentId)
    if (document.sourceType !== 'audio') throw new RangeError('只有录音支持自动转文字')
    const settings = resolveTranscriptionLlmModel(this.llmSettings())
    if (settings === undefined || !settings.apiKeyConfigured) throw new RangeError('尚未配置语音转写模型')
    const result = await this.ctx.llmClient.transcribe({
      settings,
      bytes: this.ctx.knowledgeContent.read(document.sourceAssetId),
      filename: document.originalName,
      mimeType: document.audioMimeType ?? 'audio/webm',
    })
    return this.ctx.knowledgeCatalog.updateDocument(documentId, {
      extra: {
        transcript: result.text,
        category: validateCategory(document.category),
        ...(document.audioMimeType === undefined ? {} : { mimeType: document.audioMimeType }),
      },
    })
  }

  transfer(documentId: string, input: TransferStudioDocumentInput): KnowledgeDocument {
    const libraryId = typeof input.libraryId === 'string' ? input.libraryId.trim() : ''
    if (libraryId.length === 0) throw new RangeError('请选择要转入的知识库')
    this.requireStudioDocument(documentId)
    const moved = this.ctx.knowledgeCatalog.moveDocument(documentId, libraryId)
    const indexed = this.indexTransferred(moved)
    this.ctx.emit('knowledge/graph/invalidate')
    this.ctx.emit('knowledge/document/changed', [indexed.id])
    return indexed
  }

  createCategory(input: CreateStudioCategoryInput): StudioWorkspace {
    const name = requireCategoryName(input.name)
    const categories = this.listCategories()
    if (categories.includes(name)) throw new RangeError('分类已存在')
    this.ctx.knowledgeCatalog.saveStudioCategories([...categories, name])
    return this.workspace()
  }

  renameCategory(input: RenameStudioCategoryInput): StudioWorkspace {
    const from = requireCategoryName(input.from)
    const name = requireCategoryName(input.name)
    const studio = this.ctx.knowledgeCatalog.ensureStudioLibrary()
    const items = this.ctx.knowledgeCatalog.listDocuments(studio.id)
    const categories = this.listCategories(items)
    if (!categories.includes(from) && !items.some(item => validateCategory(item.category) === from)) {
      throw new RangeError('分类不存在')
    }
    if (from !== name) {
      for (const item of items) {
        if (validateCategory(item.category) !== from) continue
        this.ctx.knowledgeCatalog.updateDocument(item.id, {
          extra: {
            category: name,
            ...(item.transcript === undefined ? {} : { transcript: item.transcript }),
            ...(item.audioMimeType === undefined ? {} : { mimeType: item.audioMimeType }),
          },
        })
      }
    }
    this.ctx.knowledgeCatalog.saveStudioCategories(categories.map(category => category === from ? name : category))
    return this.workspace()
  }

  deleteCategory(input: DeleteStudioCategoryInput): StudioWorkspace {
    const name = requireCategoryName(input.name)
    if (name === DEFAULT_STUDIO_CATEGORY) throw new RangeError('默认分类不能删除')
    const studio = this.ctx.knowledgeCatalog.ensureStudioLibrary()
    const items = this.ctx.knowledgeCatalog.listDocuments(studio.id)
    const categories = this.listCategories(items)
    if (!categories.includes(name) && !items.some(item => validateCategory(item.category) === name)) {
      throw new RangeError('分类不存在')
    }
    for (const item of items) {
      if (validateCategory(item.category) !== name) continue
      this.ctx.knowledgeCatalog.updateDocument(item.id, {
        extra: {
          category: DEFAULT_STUDIO_CATEGORY,
          ...(item.transcript === undefined ? {} : { transcript: item.transcript }),
          ...(item.audioMimeType === undefined ? {} : { mimeType: item.audioMimeType }),
        },
      })
    }
    this.ctx.knowledgeCatalog.saveStudioCategories(categories.filter(category => category !== name))
    return this.workspace()
  }

  private listCategories(items?: KnowledgeDocument[]): string[] {
    const documents = items ?? this.ctx.knowledgeCatalog.listDocuments(this.ctx.knowledgeCatalog.ensureStudioLibrary().id)
    const names = new Set<string>([DEFAULT_STUDIO_CATEGORY])
    for (const name of this.ctx.knowledgeCatalog.listStudioCategories()) names.add(validateCategory(name))
    for (const item of documents) names.add(validateCategory(item.category))
    return sortCategories([...names])
  }

  private llmSettings() {
    return this.ctx.settings.llmIntegration(providerId => this.ctx.llmCredentials.status(providerId))
  }

  private transcriptionReady(): boolean {
    return isTranscriptionReady(this.llmSettings())
  }

  private rememberCategory(name: string): void {
    const categories = this.listCategories()
    if (categories.includes(name)) {
      this.ctx.knowledgeCatalog.saveStudioCategories(categories)
      return
    }
    this.ctx.knowledgeCatalog.saveStudioCategories([...categories, name])
  }

  private indexTransferred(document: KnowledgeDocument): KnowledgeDocument {
    const body = this.indexBody(document)
    const chunks = this.ctx.knowledgeChunker.chunk({
      body,
      sourceType: document.sourceType === 'audio' ? 'text' : document.sourceType,
    })
    try {
      this.ctx.knowledgeIndex.index({ id: document.id, libraryId: document.libraryId, title: document.title }, chunks)
      return this.ctx.knowledgeCatalog.setDocumentIndexStatus(document.id, 'ready')
    } catch (error) {
      this.ctx.knowledgeCatalog.setDocumentIndexStatus(document.id, 'failed')
      throw error
    }
  }

  private indexBody(document: KnowledgeDocument): string {
    if (document.sourceType === 'audio') {
      const transcript = document.transcript?.trim() ?? ''
      return transcript.length === 0 ? document.title : `# ${document.title}\n\n${transcript}\n`
    }
    if (document.sourceType === 'markdown' || document.sourceType === 'text') {
      return new TextDecoder('utf-8').decode(this.ctx.knowledgeContent.read(document.sourceAssetId))
    }
    throw new RangeError('当前文档类型暂不支持从创作转存')
  }

  private requireStudioDocument(documentId: string): KnowledgeDocument {
    const document = this.ctx.knowledgeCatalog.getDocuments([documentId])[0]
    if (document === undefined) throw new RangeError('创作文档不存在')
    const library = this.ctx.knowledgeCatalog.getLibrary(document.libraryId)
    if (library?.kind !== 'studio') throw new RangeError('只有创作文档可以在此操作')
    return document
  }
}

const DEFAULT_STUDIO_CATEGORY = '未分类'

function validateNote(input: { title: unknown, body: unknown }): { title: string, body: string } {
  return { title: validateTitle(input.title), body: validateBody(input.body) }
}

function validateCategory(value: unknown): string {
  if (value === undefined || value === null) return DEFAULT_STUDIO_CATEGORY
  if (typeof value !== 'string') throw new RangeError('分类必须是文本')
  const category = value.trim().replaceAll(/[\r\n/]/g, '')
  if (category.length === 0) return DEFAULT_STUDIO_CATEGORY
  if (category.length > 40) throw new RangeError('分类名称不能超过 40 个字符')
  return category
}

function requireCategoryName(value: unknown): string {
  if (typeof value !== 'string') throw new RangeError('分类必须是文本')
  const category = value.trim().replaceAll(/[\r\n/]/g, '')
  if (category.length === 0) throw new RangeError('请输入分类名称')
  if (category.length > 40) throw new RangeError('分类名称不能超过 40 个字符')
  return category
}

function sortCategories(names: string[]): string[] {
  return [...names].sort((left, right) => {
    if (left === DEFAULT_STUDIO_CATEGORY) return 1
    if (right === DEFAULT_STUDIO_CATEGORY) return -1
    return left.localeCompare(right, 'zh-CN')
  })
}

function validateTitle(title: unknown): string {
  if (typeof title !== 'string') throw new RangeError('标题必须是文本')
  const value = title.trim()
  if (value.length === 0 || value.length > 200 || /[\r\n]/.test(value)) {
    throw new RangeError('标题长度应为 1 到 200 个字符且不能换行')
  }
  return value
}

function validateBody(body: unknown): string {
  if (typeof body !== 'string') throw new RangeError('正文必须是文本')
  if (body.length > 200_000) throw new RangeError('正文不能超过 200,000 个字符')
  return body.replace(/\s+$/u, '')
}

function validateTranscript(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new RangeError('转写文本必须是文本')
  if (value.length > 200_000) throw new RangeError('转写文本不能超过 200,000 个字符')
  return value.trim()
}

function normalizeMimeType(value: unknown): string {
  if (typeof value !== 'string') throw new RangeError('录音格式无效')
  const mime = value.trim().split(';')[0]?.toLowerCase() ?? ''
  if (!AUDIO_MIME_TYPES.has(mime)) throw new RangeError('不支持的录音格式')
  return mime
}

function normalizeImageMimeType(value: unknown): string {
  if (typeof value !== 'string') throw new RangeError('图片格式无效')
  const mime = value.trim().split(';')[0]?.toLowerCase() ?? ''
  if (!IMAGE_MIME_TYPES.has(mime)) throw new RangeError('仅支持 PNG、JPEG、GIF、WebP 图片')
  return mime
}

function validateImageName(value: unknown): string {
  if (value === undefined || value === null || value === '') return '图片'
  if (typeof value !== 'string') throw new RangeError('图片名称必须是文本')
  const name = value.trim().replaceAll(/[\r\n]/g, '')
  if (name.length === 0) return '图片'
  return name.slice(0, 80)
}

function decodeImage(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.trim().length === 0) throw new RangeError('图片内容为空')
  const bytes = Buffer.from(value.trim(), 'base64')
  if (bytes.byteLength === 0) throw new RangeError('图片内容为空')
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new RangeError('图片不能超过 8 MB')
  return new Uint8Array(bytes)
}

function decodeAudio(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.trim().length === 0) throw new RangeError('录音内容为空')
  const bytes = Buffer.from(value.trim(), 'base64')
  if (bytes.byteLength === 0) throw new RangeError('录音内容为空')
  if (bytes.byteLength > MAX_RECORDING_BYTES) throw new RangeError('录音不能超过 15 MB')
  return new Uint8Array(bytes)
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'audio/mp4' || mimeType === 'audio/x-m4a') return 'm4a'
  if (mimeType === 'audio/mpeg') return 'mp3'
  if (mimeType === 'audio/wav') return 'wav'
  if (mimeType === 'audio/ogg') return 'ogg'
  if (mimeType === 'audio/aac') return 'aac'
  return 'webm'
}

function filename(title: string, extension: string): string {
  const stem = title.replaceAll(/[^\p{L}\p{N}._-]+/gu, '-').replaceAll(/^-+|-+$/g, '').slice(0, 60)
  return `${stem || 'studio'}-${randomUUID().slice(0, 8)}.${extension}`
}

function parseMarkdownNote(content: string): { title: string, body: string } {
  const normalized = content.replaceAll('\r\n', '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.startsWith('# ')) {
    const title = lines[0].slice(2).trim()
    const bodyStart = lines[1]?.trim().length === 0 ? 2 : 1
    return {
      title,
      body: lines.slice(bodyStart).join('\n').replace(/\s+$/u, ''),
    }
  }
  return { title: '', body: normalized.replace(/\s+$/u, '') }
}

export default KnowledgeStudio
