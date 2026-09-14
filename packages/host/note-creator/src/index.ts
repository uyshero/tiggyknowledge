import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { CreateKnowledgeNoteInput, KnowledgeDocument } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/ingestion-tags'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeNoteCreator: KnowledgeNoteCreator
  }
}

function validate(input: CreateKnowledgeNoteInput): { title: string, body: string, tagNames: string[] } {
  if (typeof input.title !== 'string') throw new RangeError('标题必须是文本')
  if (typeof input.body !== 'string') throw new RangeError('正文必须是文本')
  if (!Array.isArray(input.tagNames)) throw new RangeError('标签必须是文本列表')
  const title = input.title.trim()
  const body = input.body.trim()
  if (title.length === 0 || title.length > 200 || /[\r\n]/.test(title)) throw new RangeError('标题长度应为 1 到 200 个字符且不能换行')
  if (body.length === 0 || body.length > 200_000) throw new RangeError('正文长度应为 1 到 200,000 个字符')
  return { title, body, tagNames: input.tagNames }
}

function filename(title: string): string {
  const stem = title.replaceAll(/[^\p{L}\p{N}._-]+/gu, '-').replaceAll(/^-+|-+$/g, '').slice(0, 60)
  return `${stem || 'note'}-${randomUUID().slice(0, 8)}.md`
}

export class KnowledgeNoteCreator extends Service {
  static inject = ['knowledgeTaggedIngestion']

  constructor(ctx: Context) {
    super(ctx, 'knowledgeNoteCreator')
  }

  async create(libraryId: string, input: CreateKnowledgeNoteInput): Promise<KnowledgeDocument> {
    const note = validate(input)
    const markdown = `# ${note.title}\n\n${note.body}\n`
    const result = await this.ctx.knowledgeTaggedIngestion.ingest(libraryId, [{
      name: filename(note.title),
      bytes: new TextEncoder().encode(markdown),
    }], note.tagNames)
    const imported = result.results.find(item => item.status === 'imported')
    if (imported?.document !== undefined) return imported.document
    const duplicate = result.results.find(item => item.status === 'duplicate')
    if (duplicate !== undefined) throw new RangeError('知识库中已存在相同内容')
    throw new Error(result.results[0]?.message ?? '知识条目创建失败')
  }
}

export default KnowledgeNoteCreator
