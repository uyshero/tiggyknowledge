import type { Context } from '@deepseek-ai/cordis'
import type { DocumentPreviewRendererProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'
import type { JSX } from 'react'

export const inject = ['clientApp']

function AudioDocumentPreview({ contentUrl, preview }: DocumentPreviewRendererProps): JSX.Element {
  const transcript = preview.document.transcript?.trim() || preview.content.trim()
  const empty = transcript.length === 0 || transcript === '尚未转写文字。'
  return (
    <div className="audio-preview">
      <audio controls preload="metadata" src={contentUrl}>
        当前浏览器无法播放这段录音。
      </audio>
      <div className="audio-preview-transcript">
        <p className="note-preview-label">转写文字</p>
        {empty ? <p className="note-preview-empty">尚未转写文字。</p> : <pre>{transcript}</pre>}
      </div>
    </div>
  )
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.clientApp.registerDocumentPreviewRenderer({
    component: AudioDocumentPreview,
    format: 'audio',
  }), 'client-preview-audio: register renderer')
}
