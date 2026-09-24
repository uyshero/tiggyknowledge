import type { Context } from '@deepseek-ai/cordis'
import { ChevronLeft, ChevronRight, CloudUpload, Download, ExternalLink, RotateCw, ScanText, Square, ZoomIn, ZoomOut } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { createWorker } from 'tesseract.js'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import type {} from '@tiggyknowledge/client-connection'
import type { DocumentPreviewRendererProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'
import type { KnowledgeDocumentPreview, MineruPdfOcrJob, MineruSettings } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

pdfjs.GlobalWorkerOptions.workerSrc = `${new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()}?v=5.4.296`

function locationPage(location: string | undefined): number {
  const page = Number(location?.match(/第\s*(\d+)\s*页/)?.[1] ?? 1)
  return Number.isInteger(page) && page > 0 ? page : 1
}

function confirmDownload(name: string): boolean {
  return window.confirm(`确认下载「${name}」？\n\n点击“确定”继续下载。`)
}

function mineruProgressLabel(job: MineruPdfOcrJob): string {
  if (job.phase === 'queued') return 'MinerU 任务已加入队列…'
  if (job.phase === 'validating') return '正在检查 PDF…'
  if (job.phase === 'uploading') return '正在上传 PDF 到 MinerU…'
  if (job.phase === 'extracting') {
    return job.totalPages === undefined
      ? 'MinerU 正在解析文档…'
      : `MinerU 正在解析第 ${job.extractedPages ?? 0} / ${job.totalPages} 页`
  }
  if (job.phase === 'downloading') return '正在下载 MinerU 解析结果…'
  if (job.phase === 'indexing') return '正在重建检索索引…'
  return job.phase === 'completed' ? 'MinerU OCR 完成' : 'MinerU OCR 失败'
}

async function waitForMineruPoll(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      window.clearTimeout(timer)
      reject(signal.reason ?? new DOMException('已取消', 'AbortError'))
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, 1_000)
    signal.addEventListener('abort', onAbort, { once: true })
  })
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

interface PdfDocumentPreviewProps extends DocumentPreviewRendererProps {
  saveOcr: (documentId: string, pages: string[], signal?: AbortSignal) => Promise<void>
  loadMineru: () => Promise<MineruSettings | undefined>
  runMineruOcr: (documentId: string, onProgress: (job: MineruPdfOcrJob) => void, signal: AbortSignal) => Promise<KnowledgeDocumentPreview>
}

function PdfDocumentPreview({ contentUrl, preview, targetLocation, targetQuery, saveOcr, loadMineru, runMineruOcr }: PdfDocumentPreviewProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const ocrWorkerRef = useRef<Awaited<ReturnType<typeof createWorker>>>()
  const ocrSaveControllerRef = useRef<AbortController>()
  const ocrCancelledRef = useRef(false)
  const ocrRunIdRef = useRef(0)
  const mineruRunIdRef = useRef(0)
  const mineruControllerRef = useRef<AbortController>()
  const [mode, setMode] = useState<'page' | 'text'>('page')
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy>()
  const [pageCount, setPageCount] = useState(preview.pageCount ?? 0)
  const [pageNumber, setPageNumber] = useState(locationPage(targetLocation))
  const [stageWidth, setStageWidth] = useState(760)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [loadError, setLoadError] = useState<string>()
  const [ocrRunning, setOcrRunning] = useState(false)
  const [ocrProgress, setOcrProgress] = useState('')
  const [ocrPercent, setOcrPercent] = useState<number>()
  const [ocrError, setOcrError] = useState<string>()
  const [ocrText, setOcrText] = useState<string>()
  const [mineru, setMineru] = useState<MineruSettings>()
  const [mineruRunning, setMineruRunning] = useState(false)

  useEffect(() => {
    let active = true
    void loadMineru().then(settings => {
      if (active) setMineru(settings)
    }).catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

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

  useEffect(() => () => {
    ocrRunIdRef.current += 1
    mineruRunIdRef.current += 1
    ocrCancelledRef.current = true
    ocrSaveControllerRef.current?.abort()
    mineruControllerRef.current?.abort()
    void ocrWorkerRef.current?.terminate()
  }, [])

  const moveToPage = (next: number): void => {
    setPageNumber(Math.min(Math.max(1, next), Math.max(1, pageCount)))
  }
  const pageWidth = Math.max(240, stageWidth - 48)
  const runOcr = async (): Promise<void> => {
    if (ocrRunning) return
    if (pdfDocument === undefined || pageCount === 0) {
      setOcrProgress('')
      setOcrError('PDF 页面尚未加载完成，请稍后重试')
      return
    }
    if (pageCount > 5_000) {
      setOcrProgress('')
      setOcrError('单次本地 OCR 最多支持 5000 页，请拆分 PDF 后识别')
      return
    }
    const pagesToRead = pageCount
    setOcrRunning(true)
    setOcrError(undefined)
    setOcrPercent(undefined)
    setOcrProgress('正在加载中文 OCR 模型…')
    ocrCancelledRef.current = false
    const runId = ++ocrRunIdRef.current
    const pages: string[] = []
    let recognizingPage = 0
    let worker: Awaited<ReturnType<typeof createWorker>> | undefined
    try {
      worker = await createWorker('chi_sim+eng', 1, {
        logger(message) {
          if (ocrRunIdRef.current !== runId) return
          if (message.status === 'recognizing text') {
            setOcrProgress(current => current.replace(/\s·\s\d+%$/, '') + ` · ${Math.round(message.progress * 100)}%`)
            setOcrPercent(Math.round(((recognizingPage - 1 + message.progress) / pagesToRead) * 100))
          }
        },
      })
      if (ocrRunIdRef.current !== runId || ocrCancelledRef.current) return
      ocrWorkerRef.current = worker
      for (let number = 1; number <= pagesToRead; number += 1) {
        if (ocrCancelledRef.current) throw new Error('OCR 已取消')
        setOcrProgress(`正在识别第 ${number} / ${pagesToRead} 页`)
        recognizingPage = number
        setOcrPercent(Math.round(((number - 1) / pagesToRead) * 100))
        const page = await pdfDocument.getPage(number)
        const viewport = page.getViewport({ scale: 2 })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const context = canvas.getContext('2d', { alpha: false })
        if (context === null) throw new Error('无法创建 OCR 图像画布')
        await page.render({ canvas, canvasContext: context, viewport }).promise
        const result = await worker.recognize(canvas)
        pages.push(result.data.text.trim())
        setOcrPercent(Math.round((number / pagesToRead) * 100))
        page.cleanup()
      }
      if (ocrRunIdRef.current !== runId || ocrCancelledRef.current) return
      setOcrProgress('正在重建检索索引…')
      setOcrPercent(99)
      const saveController = new AbortController()
      ocrSaveControllerRef.current = saveController
      await saveOcr(preview.document.id, pages, saveController.signal)
      if (ocrRunIdRef.current !== runId || ocrCancelledRef.current) return
      setOcrText(pages.map((text, index) => `第 ${index + 1} 页\n\n${text}`).join('\n\n'))
      setMode('text')
      setOcrPercent(100)
      setOcrProgress(`OCR 完成，共识别 ${pagesToRead} 页`)
    } catch (error) {
      if (ocrRunIdRef.current === runId) setOcrError(error instanceof Error ? error.message : 'OCR 识别失败')
    } finally {
      await worker?.terminate().catch(() => undefined)
      if (ocrWorkerRef.current === worker) ocrWorkerRef.current = undefined
      if (ocrRunIdRef.current === runId) ocrSaveControllerRef.current = undefined
      if (ocrRunIdRef.current === runId) setOcrRunning(false)
    }
  }

  const cancelOcr = (): void => {
    ocrRunIdRef.current += 1
    ocrCancelledRef.current = true
    ocrSaveControllerRef.current?.abort()
    ocrSaveControllerRef.current = undefined
    setOcrRunning(false)
    setOcrProgress('')
    setOcrError('OCR 已取消')
    void ocrWorkerRef.current?.terminate()
    ocrWorkerRef.current = undefined
  }

  const runMineru = async (): Promise<void> => {
    if (mineruRunning) return
    if (mineru?.enabled !== true) {
      setOcrProgress('')
      setOcrError('MinerU 尚未开启，请先在设置中启用')
      return
    }
    if (!mineru.apiKeyConfigured) {
      setOcrProgress('')
      setOcrError('请先在设置中配置 MinerU API Token')
      return
    }
    if (pdfDocument === undefined || pageCount === 0) {
      setOcrProgress('')
      setOcrError('PDF 页面尚未加载完成，请稍后重试')
      return
    }
    setMineruRunning(true)
    setOcrError(undefined)
    setOcrPercent(0)
    setOcrProgress('MinerU 任务正在启动…')
    const runId = ++mineruRunIdRef.current
    const controller = new AbortController()
    mineruControllerRef.current = controller
    try {
      const freshPreview = await runMineruOcr(preview.document.id, job => {
        if (mineruRunIdRef.current !== runId) return
        setOcrPercent(job.progress)
        setOcrProgress(mineruProgressLabel(job))
      }, controller.signal)
      if (mineruRunIdRef.current !== runId) return
      setOcrText(freshPreview.content)
      setMode('text')
      setOcrPercent(100)
      setOcrProgress(`MinerU OCR 完成${freshPreview.pageCount === undefined ? '' : `，共识别 ${freshPreview.pageCount} 页`}`)
    } catch (error) {
      if (mineruRunIdRef.current === runId && !controller.signal.aborted) {
        setOcrError(error instanceof Error ? error.message : 'MinerU OCR 失败')
      }
    } finally {
      if (mineruRunIdRef.current === runId) {
        mineruControllerRef.current = undefined
        setMineruRunning(false)
      }
    }
  }

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
              <button type="button" title="缩小" disabled={zoom <= 0.3} onClick={() => setZoom(value => Math.max(0.3, Number((value - 0.1).toFixed(1))))}><ZoomOut size={16} /></button>
              <button className="pdf-zoom-value" type="button" title="恢复原始缩放" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button type="button" title="放大" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, Number((value + 0.1).toFixed(1))))}><ZoomIn size={16} /></button>
              <button type="button" title="顺时针旋转" onClick={() => setRotation(value => (value + 90) % 360)}><RotateCw size={16} /></button>
            </div>
          </>
        )}
        {mineru?.enabled === true && (
          <button
            className="pdf-ocr-button"
            type="button"
            disabled={mineruRunning || ocrRunning}
            title={mineru.apiKeyConfigured ? '上传到 MinerU 进行精准解析' : '请先在设置中配置 MinerU API Token'}
            onClick={() => void runMineru()}
          >
            <CloudUpload size={15} />{mineruRunning ? 'MinerU 识别中…' : 'MinerU OCR'}
          </button>
        )}
        <button className="pdf-ocr-button" type="button" disabled={mineruRunning} onClick={() => ocrRunning ? cancelOcr() : void runOcr()}>
          {ocrRunning ? <Square size={15} /> : <ScanText size={15} />}{ocrRunning ? '取消 OCR' : 'OCR 识别'}
        </button>
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
            onLoadSuccess={document => {
              setLoadError(undefined)
              setPdfDocument(document)
              const { numPages } = document
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
        <pre className="document-content pdf-text-content">{highlightedText(ocrText ?? preview.content, targetLocation, targetQuery)}</pre>
      )}
      {(ocrProgress !== '' || ocrError !== undefined) && (
        <div className={`pdf-ocr-status${ocrError === undefined ? '' : ' error-state'}`}>
          <span>{ocrError ?? ocrProgress}</span>
          {ocrError === undefined && (ocrRunning || mineruRunning || ocrPercent !== undefined) && (
            <div
              className={`pdf-ocr-progress-track${ocrPercent === undefined ? ' indeterminate' : ''}`}
              role="progressbar"
              aria-label="OCR 识别进度"
              aria-valuemin={0}
              aria-valuemax={100}
              {...(ocrPercent === undefined ? {} : { 'aria-valuenow': ocrPercent })}
            >
              <i style={ocrPercent === undefined ? undefined : { width: `${ocrPercent}%` }} />
            </div>
          )}
        </div>
      )}
      {mode === 'text' && preview.truncated && <div className="preview-truncated">检索和 Wiki 只使用已提取的文本（最多前 5000 页或约 200 万字），页面预览仍可翻阅全文。</div>}
    </section>
  )
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.clientApp.registerDocumentPreviewRenderer({
    component: props => <PdfDocumentPreview {...props} saveOcr={async (documentId, pages, signal) => {
      await ctx.connection.updatePdfOcr(documentId, { pages }, signal)
    }} loadMineru={async () => (await ctx.connection.system()).mineru} runMineruOcr={async (documentId, onProgress, signal) => {
      let job = await ctx.connection.startMineruPdfOcr(documentId, signal)
      onProgress(job)
      while (job.state === 'queued' || job.state === 'running') {
        await waitForMineruPoll(signal)
        job = await ctx.connection.mineruPdfOcrJob(job.id, signal)
        onProgress(job)
      }
      if (job.state === 'failed') throw new Error(job.error ?? 'MinerU OCR 失败')
      return await ctx.connection.documentPreview(documentId)
    }} />,
    format: 'pdf',
  }), 'client-preview-pdf: register renderer')
}
