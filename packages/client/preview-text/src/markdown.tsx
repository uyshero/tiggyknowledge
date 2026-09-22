import type { JSX, ReactNode } from 'react'

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

function splitTableCells(line: string): string[] {
  const trimmed = line.trim()
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const withoutEnd = inner.endsWith('|') ? inner.slice(0, -1) : inner
  return withoutEnd.split('|').map(cell => cell.trim())
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.includes('|') && !trimmed.startsWith('```')
}

function looksLikeTable(lines: string[], index: number): boolean {
  const line = lines[index] ?? ''
  const next = lines[index + 1] ?? ''
  return isTableRow(line) && isTableSeparator(next)
}

function alignmentOf(cell: string): 'left' | 'center' | 'right' | undefined {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return undefined
}

const BLOCK_BREAK = /^(#{1,6})\s|^```|^\s*[-*+]\s+|^\s*\d+\.\s+|^!\[/

export function MarkdownView({ content, empty }: { content: string, empty?: ReactNode }): JSX.Element {
  const blocks: ReactNode[] = []
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
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
    if (looksLikeTable(lines, index)) {
      const header = splitTableCells(line)
      const alignments = splitTableCells(lines[index + 1] ?? '').map(alignmentOf)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && isTableRow(lines[index] ?? '') && !isTableSeparator(lines[index] ?? '')) {
        rows.push(splitTableCells(lines[index] ?? ''))
        index += 1
      }
      const columnCount = Math.max(header.length, ...rows.map(row => row.length), alignments.length)
      const pad = (cells: string[]): string[] => Array.from({ length: columnCount }, (_, column) => cells[column] ?? '')
      blocks.push(
        <div className="note-table-wrap" key={`table-${index}`}>
          <table>
            <thead>
              <tr>
                {pad(header).map((cell, column) => (
                  <th key={`th-${column}`} {...(alignments[column] === undefined ? {} : { style: { textAlign: alignments[column] } })}>
                    {inlineMarkdown(cell, `th-${index}-${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            {rows.length > 0 && (
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`tr-${rowIndex}`}>
                    {pad(row).map((cell, column) => (
                      <td key={`td-${rowIndex}-${column}`} {...(alignments[column] === undefined ? {} : { style: { textAlign: alignments[column] } })}>
                        {inlineMarkdown(cell, `td-${index}-${rowIndex}-${column}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>,
      )
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
    while (
      index < lines.length
      && (lines[index] ?? '').trim() !== ''
      && !BLOCK_BREAK.test(lines[index] ?? '')
      && !looksLikeTable(lines, index)
    ) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraph.join(' '), `paragraph-${index}`)}</p>)
  }
  return (
    <div className="note-markdown">
      {blocks.length === 0 ? (empty ?? <p className="note-preview-empty">没有可预览的内容。</p>) : blocks}
    </div>
  )
}
