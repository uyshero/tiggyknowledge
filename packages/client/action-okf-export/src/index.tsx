import type { Context } from '@deepseek-ai/cordis'
import { Download } from 'lucide-react'
import type { JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type { LibraryActionProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'

export const inject = ['clientApp', 'connection']

function confirmDownload(name: string): boolean {
  return window.confirm(`确认下载「${name}」？\n\n点击“确定”继续下载。`)
}

export function apply(ctx: Context): void {
  function OkfExportAction({ library }: LibraryActionProps): JSX.Element {
    const filename = `${library.name}.okf.zip`
    return (
      <a
        className="library-action-button"
        href={ctx.connection.libraryOkfExportUrl(library.id)}
        download={filename}
        title={`导出 OKF Bundle ${library.name}`}
        onClick={event => {
          if (!confirmDownload(filename)) event.preventDefault()
        }}
      >
        <Download size={15} />
        <span className="visually-hidden">导出 OKF Bundle</span>
      </a>
    )
  }

  ctx.effect(() => ctx.clientApp.registerLibraryAction({
    id: 'okf-export',
    component: OkfExportAction,
    order: 10,
  }), 'client-action-okf-export: register library action')
}
