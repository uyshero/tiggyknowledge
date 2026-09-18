import { Context, Service } from '@deepseek-ai/cordis'
import { zip, type Zippable } from 'fflate'
import { dump, load } from 'js-yaml'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type {} from '@tiggyknowledge/content-local'
import type { KnowledgeDocumentSourceType } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/okf'
import { contributeSurface, httpFromRange, pathSegment } from '@tiggyknowledge/plugin-surface'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeOkfExport: KnowledgeOkfExport
  }
}

export interface OkfBundleValidation {
  status: 'passed'
  okfVersion: '0.2'
  conceptFiles: number
  referenceFiles: number
}

export interface OkfBundleExport {
  filename: string
  bytes: Uint8Array
  validation: OkfBundleValidation
}

const encoder = new TextEncoder()

function markdown(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${dump(frontmatter, { lineWidth: -1, noRefs: true })}---\n\n${body.trim()}\n`
}

function referenceExtension(sourceType: KnowledgeDocumentSourceType): string {
  if (sourceType === 'pdf') return '.pdf'
  if (sourceType === 'markdown') return '.markdown.txt'
  if (sourceType === 'url') return '.url.txt'
  return '.txt'
}

function safeFilename(name: string, id: string): string {
  const normalized = name.replaceAll(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 80)
  return `${normalized || id}.okf.zip`
}

function frontmatterOf(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  if (match === null) throw new Error('OKF 校验失败：Concept 缺少 YAML Frontmatter')
  const value = load(match[1] ?? '')
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('OKF 校验失败：Frontmatter 必须是映射')
  return value as Record<string, unknown>
}

function validate(files: Record<string, Uint8Array>): OkfBundleValidation {
  const index = files['index.md']
  const log = files['log.md']
  if (index === undefined || log === undefined) throw new Error('OKF 校验失败：Bundle 缺少 index.md 或 log.md')
  const indexMetadata = frontmatterOf(new TextDecoder().decode(index))
  if (indexMetadata.okf_version !== '0.2') throw new Error('OKF 校验失败：okf_version 必须为 0.2')
  if (!/^## \d{4}-\d{2}-\d{2}$/m.test(new TextDecoder().decode(log))) throw new Error('OKF 校验失败：log.md 日期标题无效')

  const conceptPaths = Object.keys(files).filter(path => path.endsWith('.md') && path !== 'index.md' && path !== 'log.md')
  for (const path of conceptPaths) {
    const metadata = frontmatterOf(new TextDecoder().decode(files[path]))
    if (typeof metadata.type !== 'string' || metadata.type.trim().length === 0) {
      throw new Error(`OKF 校验失败：${path} 缺少非空 type`)
    }
  }
  return {
    status: 'passed',
    okfVersion: '0.2',
    conceptFiles: conceptPaths.length,
    referenceFiles: Object.keys(files).filter(path => path.startsWith('references/')).length,
  }
}

function createZip(files: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, bytes) => error === null ? resolve(bytes) : reject(error))
  })
}

export class KnowledgeOkfExport extends Service {
  static inject = ['knowledgeCatalog', 'knowledgeContent']

  constructor(ctx: Context) {
    super(ctx, 'knowledgeOkfExport')
    ctx.inject(['knowledgeOkf'], ctx => {
      contributeSurface(ctx, {
        clients: [{
          id: 'client-action-okf-export',
          moduleName: '@tiggyknowledge/client-action-okf-export',
          label: 'OKF Export',
          description: 'Knowledge library OKF Bundle export action',
        }],
        routes: [{
          id: 'okf:bundle',
          methods: ['GET'],
          path: /^\/api\/libraries\/([^/]+)\/okf-bundle$/,
          handler: async ({ response, match }) => {
            try {
              const bundle = await this.exportLibrary(pathSegment(match))
              response.writeHead(200, {
                'cache-control': 'private, no-store',
                'content-disposition': `attachment; filename="tiggyknowledge-okf.zip"; filename*=UTF-8''${encodeURIComponent(bundle.filename)}`,
                'content-length': bundle.bytes.byteLength,
                'content-type': 'application/zip',
                'x-content-type-options': 'nosniff',
                'x-okf-concepts': String(bundle.validation.conceptFiles),
                'x-okf-validation': bundle.validation.status,
                'x-okf-version': bundle.validation.okfVersion,
              })
              response.end(Buffer.from(bundle.bytes))
            } catch (error) {
              throw httpFromRange(error, 'library_not_found')
            }
          },
        }],
      })
    })
  }

  async exportLibrary(libraryId: string): Promise<OkfBundleExport> {
    const library = this.ctx.knowledgeCatalog.getLibrary(libraryId)
    if (library === undefined) throw new RangeError('知识库不存在')
    const documents = this.ctx.knowledgeCatalog.listDocuments(libraryId)
    const mappings = await Promise.all(documents.map(document => this.ctx.knowledgeOkf.mapping(document.id)))
    const files: Record<string, Uint8Array> = {}
    const indexEntries: string[] = []

    for (let index = 0; index < documents.length; index += 1) {
      const document = documents[index]
      const mapping = mappings[index]
      if (document === undefined || mapping === undefined) continue
      const referencePath = `references/${document.sourceAssetId}${referenceExtension(document.sourceType)}`
      files[referencePath] ??= this.ctx.knowledgeContent.read(document.sourceAssetId)
      files[mapping.concept.path] = encoder.encode(markdown({
        type: mapping.concept.type,
        title: mapping.concept.title,
        description: mapping.concept.description,
        tags: mapping.concept.tags.map(tag => tag.name),
        generated: { by: mapping.concept.generatedBy, at: mapping.concept.generatedAt },
        sources: mapping.concept.sources.map(source => ({
          id: source.id,
          resource: referencePath,
          title: source.title,
          content_hash: source.contentHash,
          size_bytes: source.sizeBytes,
        })),
      }, mapping.concept.body))
      indexEntries.push(`* [${mapping.concept.title}](${mapping.concept.path}) - ${mapping.concept.description}`)
    }

    const description = library.description.length === 0 ? 'tiggyknowledge 导出的本地知识库。' : library.description
    files['index.md'] = encoder.encode(markdown({ okf_version: '0.2' }, `# ${library.name}\n\n${description}\n\n## Concepts\n\n${indexEntries.length === 0 ? '当前没有知识条目。' : indexEntries.join('\n')}`))
    const exportedAt = new Date()
    files['log.md'] = encoder.encode(`# Bundle Update Log\n\n## ${exportedAt.toISOString().slice(0, 10)}\n* **Export**: Exported ${documents.length} concepts from tiggyknowledge.\n`)
    const validation = validate(files)
    return {
      filename: safeFilename(library.name, library.id),
      bytes: await createZip(files),
      validation,
    }
  }
}

export default KnowledgeOkfExport
