import type { Context } from '@deepseek-ai/cordis'
import type { DocumentPreviewRendererProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'
import type { JSX } from 'react'
import { MarkdownView } from './markdown.tsx'
import './styles.css'

export { MarkdownView } from './markdown.tsx'

export const inject = ['clientApp']

function MarkdownDocumentPreview({ preview }: DocumentPreviewRendererProps): JSX.Element {
  return <div className="text-preview"><MarkdownView content={preview.content} /></div>
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
