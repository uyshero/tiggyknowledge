import { basename, extname } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { KnowledgeDocumentSourceType } from '@tiggyknowledge/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    textProducer: TextProducer
  }
}

export interface ProducedText {
  title: string
  body: string
  sourceType: KnowledgeDocumentSourceType
}

export type DocumentProducerHandler = (fileName: string, bytes: Uint8Array) => ProducedText | Promise<ProducedText>

const EXTENSIONS: Record<string, KnowledgeDocumentSourceType> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
}

export class TextProducer extends Service {
  private readonly handlers = new Map<string, DocumentProducerHandler>()

  constructor(ctx: Context) {
    super(ctx, 'textProducer')
    this.register(Object.keys(EXTENSIONS), (fileName, bytes) => this.produceText(fileName, bytes))
  }

  register(extensions: string[], handler: DocumentProducerHandler): () => void {
    const normalized = extensions.map(extension => extension.toLowerCase())
    for (const extension of normalized) {
      if (!extension.startsWith('.') || this.handlers.has(extension)) throw new Error(`producer: duplicate or invalid extension ${extension}`)
    }
    for (const extension of normalized) this.handlers.set(extension, handler)
    return () => {
      for (const extension of normalized) {
        if (this.handlers.get(extension) === handler) this.handlers.delete(extension)
      }
    }
  }

  async produce(fileName: string, bytes: Uint8Array): Promise<ProducedText> {
    const extension = extname(fileName).toLowerCase()
    const handler = this.handlers.get(extension)
    if (handler === undefined) throw new Error('仅支持已安装生产插件声明的文件格式')
    return await handler(fileName, bytes)
  }

  private produceText(fileName: string, bytes: Uint8Array): ProducedText {
    const extension = extname(fileName).toLowerCase()
    const sourceType = EXTENSIONS[extension]
    if (sourceType === undefined) throw new Error('文本生产插件不支持该格式')
    let body: string
    try {
      body = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    } catch {
      throw new Error('文件不是有效的 UTF-8 文本')
    }
    if (body.trim().length === 0) throw new Error('文件内容为空')
    const fallback = basename(fileName, extension).trim() || fileName
    const markdownTitle = sourceType === 'markdown'
      ? body.match(/^#\s+(.+)$/m)?.[1]?.trim()
      : undefined
    return { title: markdownTitle || fallback, body, sourceType }
  }
}

export default TextProducer
