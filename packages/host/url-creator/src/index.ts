import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { CreateKnowledgeUrlInput, KnowledgeDocument } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/documents'
import type {} from '@tiggyknowledge/ingestion-tags'
import { hostnameTitle, internetShortcut, normalizePageUrl } from '@tiggyknowledge/producer-url'
import { contributeSurface, httpFromRange, pathSegment } from '@tiggyknowledge/plugin-surface'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeUrlCreator: KnowledgeUrlCreator
  }
}

function validate(input: CreateKnowledgeUrlInput): { url: string, title?: string, tagNames: string[] } {
  if (typeof input.url !== 'string') throw new RangeError('网址必须是文本')
  if (!Array.isArray(input.tagNames)) throw new RangeError('标签必须是文本列表')
  const url = normalizePageUrl(input.url)
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (title.length > 200 || /[\r\n]/.test(title)) throw new RangeError('标题长度应为 1 到 200 个字符且不能换行')
  return {
    url,
    tagNames: input.tagNames,
    ...(title.length === 0 ? {} : { title }),
  }
}

function filename(url: string, title: string | undefined): string {
  const stem = (title ?? hostnameTitle(url)).replaceAll(/[^\p{L}\p{N}._-]+/gu, '-').replaceAll(/^-+|-+$/g, '').slice(0, 60)
  return `${stem || 'page'}-${randomUUID().slice(0, 8)}.url`
}

export class KnowledgeUrlCreator extends Service {
  static inject = ['knowledgeDocuments', 'knowledgeTaggedIngestion']

  constructor(ctx: Context) {
    super(ctx, 'knowledgeUrlCreator')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-url-create',
        moduleName: '@tiggyknowledge/client-url-create',
        label: 'URL Creator',
        description: 'Save a live web page into a knowledge library',
      }],
      routes: [{
        id: 'urls:create',
        methods: ['POST'],
        path: /^\/api\/libraries\/([^/]+)\/urls$/,
        handler: async ({ assertSameOrigin, json, match, readJson }) => {
          assertSameOrigin()
          try {
            json(await this.create(pathSegment(match), await readJson<CreateKnowledgeUrlInput>()), 201)
          } catch (error) {
            throw httpFromRange(error, 'invalid_url')
          }
        },
      }],
    })
  }

  async create(libraryId: string, input: CreateKnowledgeUrlInput): Promise<KnowledgeDocument> {
    const page = validate(input)
    const result = await this.ctx.knowledgeTaggedIngestion.ingest(libraryId, [{
      name: filename(page.url, page.title),
      bytes: new TextEncoder().encode(internetShortcut(page.url)),
    }], page.tagNames)
    const imported = result.results.find(item => item.status === 'imported')
    if (imported?.document !== undefined) {
      if (page.title === undefined) return imported.document
      return this.ctx.knowledgeDocuments.updateTitle(imported.document.id, { title: page.title })
    }
    const duplicate = result.results.find(item => item.status === 'duplicate')
    if (duplicate !== undefined) throw new RangeError('知识库中已存在相同网址')
    throw new Error(result.results[0]?.message ?? '网址条目创建失败')
  }
}

export default KnowledgeUrlCreator
