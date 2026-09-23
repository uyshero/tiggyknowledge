import type { Context } from '@deepseek-ai/cordis'
import { ChevronLeft, ChevronRight, Download, ExternalLink, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import type { DocumentPreviewRendererProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'

export const inject = ['clientApp']

pdfjs.GlobalWorkerOptions.workerSrc = `${new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()}?v=5.4.296`

function locationPage(location: string | undefined): number {
  const page = Number(location?.match(/第\s*(\d+)\s*页/)?.[1] ?? 1)
  return Number.isInteger(page) && page > 0 ? page : 1
}

function confirmDownload(name: string): boolean {
  return window.confirm(`确认下载「${name}」？\n\n点击“确定”继续下载。`)
}

function highlightedText(content: string, location: string | undefined, query: string | undefined): ReactNode[] {
  const offset = location === undefined ? 0 : Math.max(0, content.indexOf(location))
  const terms = query?.match(/\S+/g)?.filter(term => term.length > 0).toSorted((left, right) => right.length - left.length) ?? []
  const lower = content.toLocaleLowerCase('zh-CN')
  const term = terms.flatMap(term => {
    const normalized = term.toLocaleLowerCase('zh-CN')
    const local = lower.slice(offset, Math.min(content.length, offset + 2000)).indexOf(normalized)
    if (local >= 0) return [{ start: offset + local, end: offset + local + term.length }]
    const global = lower.indexOf(normalized)
    return global >= 0 ? [{ start: global, end: global + term.length }] : []
  })[0]
  const start = term?.start ?? (location === undefined ? -1 : content.indexOf(location))
  if (start < 0) return [content]
  const end = term?.end ?? start + (location?.length ?? 0)
  return [
    <Fragment key="before">{content.slice(0, start)}</Fragment>,
    <mark className="document-target-highlight" key="hit">{content.slice(start, end)}</mark>,
    <Fragment key="after">{content.slice(end)}</Fragment>,
  ]
}

function PdfDocumentPreview({ contentUrl, preview, targetLocation, targetQuery }: DocumentPreviewRendererProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'page' | 'text'>('page')
  const [pageCount, setPageCount] = useState(preview.pageCount ?? 0)
  const [pageNumber, setPageNumber] = useState(locationPage(targetLocation))
  const [stageWidth, setStageWidth] = useState(760)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [loadError, setLoadError] = useState<string>()

  useLayoutEffect(() => {
    if (mode !== 'page') return
    const stage = stageRef.current
    if (stage === null) return
    const update = (): void => setStageWidth(stage.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [mode])

  useEffect(() => {
    const target = locationPage(targetLocation)
    setPageNumber(pageCount > 0 ? Math.min(target, pageCount) : target)
  }, [pageCount, targetLocation])

  const moveToPage = (next: number): void => {
    setPageNumber(Math.min(Math.max(1, next), Math.max(1, pageCount)))
  }
  const pageWidth = Math.max(240, stageWidth - 48)

  return (
    <section className="pdf-preview" aria-label="PDF 页面预览">
      <div className="pdf-preview-toolbar">
        <div className="segmented pdf-preview-mode" aria-label="预览模式">
          <button className={mode === 'page' ? 'active' : ''} type="button" onClick={() => setMode('page')}>页面</button>
          <button className={mode === 'text' ? 'active' : ''} type="button" onClick={() => setMode('text')}>文本</button>
        </div>
        {mode === 'page' && (
          <>
            <div className="pdf-page-control">
              <button type="button" title="上一页" disabled={pageNumber <= 1} onClick={() => moveToPage(pageNumber - 1)}><ChevronLeft size={16} /></button>
              <label><input aria-label="当前页" min={1} max={Math.max(1, pageCount)} type="number" value={pageNumber} onChange={event => moveToPage(Number(event.target.value))} /><span>/ {pageCount || '...'}</span></label>
              <button type="button" title="下一页" disabled={pageCount === 0 || pageNumber >= pageCount} onClick={() => moveToPage(pageNumber + 1)}><ChevronRight size={16} /></button>
            </div>
            <div className="pdf-zoom-control">
              <button type="button" title="缩小" disabled={zoom <= 0.7} onClick={() => setZoom(value => Math.max(0.7, Number((value - 0.1).toFixed(1))))}><ZoomOut size={16} /></button>
              <button className="pdf-zoom-value" type="button" title="恢复原始缩放" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button type="button" title="放大" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, Number((value + 0.1).toFixed(1))))}><ZoomIn size={16} /></button>
              <button type="button" title="顺时针旋转" onClick={() => setRotation(value => (value + 90) % 360)}><RotateCw size={16} /></button>
            </div>
          </>
        )}
        <div className="pdf-file-actions">
          <a href={contentUrl} target="_blank" rel="noreferrer" title="在新窗口打开"><ExternalLink size={16} /></a>
          <a
            href={contentUrl}
            download={preview.document.originalName}
            title="下载原文件"
            onClick={event => {
              if (!confirmDownload(preview.document.originalName)) event.preventDefault()
            }}
          >
            <Download size={16} />
          </a>
        </div>
      </div>
      {mode === 'page' ? (
        <div className="pdf-page-stage" ref={stageRef}>
          <Document
            file={contentUrl}
            loading={<div className="pdf-render-state">正在渲染 PDF...</div>}
            error={<div className="pdf-render-state error-state"><strong>PDF 页面加载失败</strong><span>{loadError ?? '可以尝试在新窗口打开原文件。'}</span></div>}
            onLoadError={error => setLoadError(error.message)}
            onLoadSuccess={({ numPages }) => {
              setLoadError(undefined)
              setPageCount(numPages)
              setPageNumber(value => Math.min(Math.max(1, value), numPages))
            }}
          >
            <Page
              pageNumber={pageNumber}
              renderAnnotationLayer
              renderTextLayer
              rotate={rotation}
              scale={zoom}
              width={pageWidth}
            />
          </Document>
        </div>
      ) : (
        <pre className="document-content pdf-text-content">{highlightedText(preview.content, targetLocation, targetQuery)}</pre>
      )}
      {mode === 'text' && preview.truncated && <div className="preview-truncated">检索和 Wiki 只使用已提取的文本（最多前 500 页或约 200 万字），页面预览仍可翻阅全文。</div>}
    </section>
  )
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.clientApp.registerDocumentPreviewRenderer({
    component: PdfDocumentPreview,
    format: 'pdf',
  }), 'client-preview-pdf: register renderer')
}
