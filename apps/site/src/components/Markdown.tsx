import { useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import { Link } from 'react-router-dom'
import remarkGfm from 'remark-gfm'

function CopyButton({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <button className="copy-button" type="button" onClick={() => void copy()}>
      {copied ? '已复制' : '复制'}
    </button>
  )
}

function textFromNode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textFromNode).join('')
  if (node === null || node === undefined || typeof node !== 'object') return ''
  if ('props' in node) return textFromNode((node.props as { children?: ReactNode }).children)
  return ''
}

export function MarkdownDoc({ markdown }: { markdown: string }): JSX.Element {
  return (
    <article className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            if (href !== undefined && href.startsWith('/')) {
              return <Link to={href}>{children}</Link>
            }
            return <a href={href} rel="noreferrer" target="_blank">{children}</a>
          },
          pre({ children }) {
            return (
              <div className="code-block">
                <CopyButton text={textFromNode(children).replace(/\n$/, '')} />
                <pre>{children}</pre>
              </div>
            )
          },
          table({ children }) {
            return (
              <div className="table-wrap">
                <table>{children}</table>
              </div>
            )
          },
        }}
      >
        {markdown}
      </Markdown>
    </article>
  )
}
