import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { KnowledgeDocumentSourceType } from '@tiggyknowledge/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeChunker: BasicChunker
  }
}

export interface KnowledgeChunk {
  id: string
  body: string
  location: string
}

export interface ChunkInput {
  body: string
  sourceType: KnowledgeDocumentSourceType
}

interface Paragraph {
  body: string
  startLine: number
  endLine: number
  heading: string
}

const MAX_CHUNK_CHARACTERS = 1200

export class BasicChunker extends Service {
  constructor(ctx: Context) {
    super(ctx, 'knowledgeChunker')
  }

  chunk(input: ChunkInput): KnowledgeChunk[] {
    const paragraphs = this.paragraphs(input).flatMap(paragraph => this.splitParagraph(paragraph))
    const chunks: KnowledgeChunk[] = []
    let body = ''
    let startLine = 1
    let endLine = 1
    let heading = ''

    const flush = (): void => {
      const value = body.trim()
      if (value.length === 0) return
      const location = (input.sourceType === 'markdown' || input.sourceType === 'pdf') && heading.length > 0
        ? heading
        : startLine === endLine ? `第 ${startLine} 行` : `第 ${startLine}-${endLine} 行`
      const digest = createHash('sha256').update(`${location}\n${value}`).digest('hex').slice(0, 16)
      chunks.push({ id: `chunk-${String(chunks.length + 1).padStart(4, '0')}-${digest}`, body: value, location })
      body = ''
    }

    for (const paragraph of paragraphs) {
      if (body.length > 0 && (body.length + paragraph.body.length + 2 > MAX_CHUNK_CHARACTERS || paragraph.heading !== heading && paragraph.heading.length > 0)) flush()
      if (body.length === 0) {
        startLine = paragraph.startLine
        heading = paragraph.heading
      }
      body += `${body.length === 0 ? '' : '\n\n'}${paragraph.body}`
      endLine = paragraph.endLine
      if (body.length > MAX_CHUNK_CHARACTERS) flush()
    }
    flush()
    return chunks
  }

  private splitParagraph(paragraph: Paragraph): Paragraph[] {
    if (paragraph.body.length <= MAX_CHUNK_CHARACTERS) return [paragraph]
    const segments: Paragraph[] = []
    let remaining = paragraph.body
    while (remaining.length > MAX_CHUNK_CHARACTERS) {
      const window = remaining.slice(0, MAX_CHUNK_CHARACTERS + 1)
      const newlineAt = window.lastIndexOf('\n')
      const spaceAt = window.lastIndexOf(' ')
      const boundary = Math.max(newlineAt, spaceAt)
      const end = boundary >= MAX_CHUNK_CHARACTERS / 2 ? boundary : MAX_CHUNK_CHARACTERS
      segments.push({ ...paragraph, body: remaining.slice(0, end).trimEnd() })
      remaining = remaining.slice(end).trimStart()
    }
    if (remaining.length > 0) segments.push({ ...paragraph, body: remaining })
    return segments
  }

  private paragraphs(input: ChunkInput): Paragraph[] {
    if (input.sourceType === 'pdf') {
      return input.body.split('\f').flatMap((page, index) => this.pageParagraphs(page, `第 ${index + 1} 页`))
    }
    return this.pageParagraphs(input.body, '', input.sourceType === 'markdown')
  }

  private pageParagraphs(body: string, fixedHeading: string, markdown = false): Paragraph[] {
    const lines = body.split('\n')
    const paragraphs: Paragraph[] = []
    const headings: string[] = fixedHeading.length === 0 ? [] : [fixedHeading]
    let buffer: string[] = []
    let startLine = 1

    const flush = (endLine: number): void => {
      const body = buffer.join('\n').trim()
      if (body.length > 0) paragraphs.push({ body, startLine, endLine, heading: headings.join(' / ') })
      buffer = []
    }

    lines.forEach((line, index) => {
      const lineNumber = index + 1
      const match = markdown ? line.match(/^(#{1,6})\s+(.+)$/) : null
      if (match !== null) {
        flush(lineNumber - 1)
        const depth = match[1]?.length ?? 1
        headings.splice(depth - 1)
        headings[depth - 1] = match[2]?.trim() ?? ''
        buffer = [line]
        startLine = lineNumber
        return
      }
      if (line.trim().length === 0) {
        flush(lineNumber - 1)
        startLine = lineNumber + 1
        return
      }
      if (buffer.length === 0) startLine = lineNumber
      buffer.push(line)
    })
    flush(lines.length)
    return paragraphs
  }
}

export default BasicChunker
