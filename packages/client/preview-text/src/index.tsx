import type { Context } from '@deepseek-ai/cordis'
import type { DocumentPreviewRendererProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'
import type { JSX, ReactNode } from 'react'
import './styles.css'

export const inject = ['clientApp']

function safeHref(target: string): string | undefined {
  try {
    const url = new URL(target, 'https://knowledge.local')
    return url.protocol === 'http:' || url.protocol === 'https:' ? target : undefined
  } catch {
    return undefined
  }
}

function safeImageSrc(target: string): string | undefined {
  if (/^\/api\/documents\/[^/]+\/images\/[a-f0-9]{64}$/.test(target)) return target
  return safeHref(target)
}

function markdownImage(token: string): { alt: string, src: string } | undefined {
  const parts = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(token)
  if (parts?.[2] === undefined) return undefined
  const src = safeImageSrc(parts[2])
  return src === undefined ? undefined : { alt: parts[1] ?? '', src }
}

function inlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const result: ReactNode[] = []
  const pattern = /(`[^`\n]+`|!\[[^\]\n]*\]\([^\s)\n]+\)|\[[^\]\n]+\]\([^\s)\n]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) result.push(text.slice(cursor, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${match.index}`
    if (token.startsWith('`')) result.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('![')) {
      const image = markdownImage(token)
      result.push(image === undefined ? <span key={key}>{token}</span> : <img alt={image.alt} key={key} src={image.src} />)
    } else if (token.startsWith('[')) {
      const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      const href = parts?.[2] === undefined ? undefined : safeHref(parts[2])
      result.push(href === undefined || parts?.[1] === undefined ? <span key={key}>{token}</span> : <a href={href} key={key} rel="noreferrer">{parts[1]}</a>)
    } else if (token.startsWith('**')) result.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    else result.push(<em key={key}>{token.slice(1, -1)}</em>)
    cursor = match.index + token.length
  }
  if (cursor < text.length) result.push(text.slice(cursor))
  return result
}

function MarkdownDocumentPreview({ preview }: DocumentPreviewRendererProps): JSX.Element {
  const blocks: ReactNode[] = []
  const lines = preview.content.replace(/\r\n?/g, '\n').split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      index += 1
      continue
    }
    if (line.startsWith('```')) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      index += index < lines.length ? 1 : 0
      blocks.push(<pre key={`code-${index}`}><code>{code.join('\n')}</code></pre>)
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading !== null) {
      const level = (heading[1] ?? '').length
      const children = inlineMarkdown(heading[2] ?? '', `heading-${index}`)
      const key = `heading-${index}`
      blocks.push(level === 1 ? <h1 key={key}>{children}</h1> : level === 2 ? <h2 key={key}>{children}</h2> : <h3 key={key}>{children}</h3>)
      index += 1
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? '')) {
        items.push(<li key={`item-${index}`}>{inlineMarkdown((lines[index] ?? '').replace(/^\s*[-*+]\s+/, ''), `item-${index}`)}</li>)
        index += 1
      }
      blocks.push(<ul key={`list-${index}`}>{items}</ul>)
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? '')) {
        items.push(<li key={`item-${index}`}>{inlineMarkdown((lines[index] ?? '').replace(/^\s*\d+\.\s+/, ''), `item-${index}`)}</li>)
        index += 1
      }
      blocks.push(<ol key={`list-${index}`}>{items}</ol>)
      continue
    }
    const image = markdownImage(line.trim())
    if (image !== undefined) {
      blocks.push(<p className="note-image" key={`image-${index}`}><img alt={image.alt} src={image.src} /></p>)
      index += 1
      continue
    }
    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && (lines[index] ?? '').trim() !== '' && !/^(#{1,6})\s|^```|^\s*[-*+]\s+|^\s*\d+\.\s+|^!\[/.test(lines[index] ?? '')) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraph.join(' '), `paragraph-${index}`)}</p>)
  }
  return <div className="text-preview note-markdown">{blocks}</div>
}

function PlainTextPreview({ preview }: DocumentPreviewRendererProps): JSX.Element {
  return <pre className="text-preview text-preview-plain">{preview.content}</pre>
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.clientApp.registerDocumentPreviewRenderer({
    component: MarkdownDocumentPreview,
    format: 'markdown',
  }), 'client-preview-text: markdown')
  ctx.effect(() => ctx.clientApp.registerDocumentPreviewRenderer({
    component: PlainTextPreview,
    format: 'text',
  }), 'client-preview-text: text')
}
