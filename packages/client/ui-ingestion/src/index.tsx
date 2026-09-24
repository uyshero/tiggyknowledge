import type { Context } from '@deepseek-ai/cordis'
import { CheckCircle2, FileText, RotateCcw, Upload, X, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type {} from '@tiggyknowledge/client-runtime'
import type { IngestionBatchResult, KnowledgeLibrary } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

const ACCEPTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.pdf', '.url', '.webloc']
const MAX_FILE_SIZE = 200 * 1024 * 1024

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function tagNames(input: string): string[] {
  return input.split(/[,，\n]/).map(name => name.trim()).filter(Boolean)
}

export function apply(ctx: Context): void {
  function IngestionPage(): JSX.Element {
    const inputRef = useRef<HTMLInputElement>(null)
    const [libraries, setLibraries] = useState<KnowledgeLibrary[]>([])
    const [libraryId, setLibraryId] = useState('')
    const [files, setFiles] = useState<File[]>([])
    const [result, setResult] = useState<IngestionBatchResult>()
    const [tagInput, setTagInput] = useState('')
    const [resultTags, setResultTags] = useState<string[]>([])
    const [error, setError] = useState<string>()
    const [loading, setLoading] = useState(true)
    const [uploading, setUploading] = useState(false)
    const [dragging, setDragging] = useState(false)

    useEffect(() => {
      const controller = new AbortController()
      void ctx.connection.libraries(controller.signal).then(items => {
        setLibraries(items)
        setLibraryId(items[0]?.id ?? '')
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取知识库')
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
      return () => controller.abort()
    }, [])

    const stageFiles = (incoming: File[]): void => {
      const accepted: File[] = []
      const rejected: string[] = []
      for (const file of incoming) {
        const lower = file.name.toLowerCase()
        if (!ACCEPTED_EXTENSIONS.some(extension => lower.endsWith(extension))) {
          rejected.push(`${file.name}：格式不支持`)
        } else if (file.size > MAX_FILE_SIZE) {
          rejected.push(`${file.name}：超过 200 MB`)
        } else {
          accepted.push(file)
        }
      }
      setFiles(current => {
        const known = new Set(current.map(fileKey))
        return [...current, ...accepted.filter(file => !known.has(fileKey(file)))].slice(0, 50)
      })
      setResult(undefined)
      setError(rejected.length === 0 ? undefined : rejected.join('；'))
    }

    const onFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
      stageFiles(Array.from(event.target.files ?? []))
      event.target.value = ''
    }

    const onDrop = (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault()
      setDragging(false)
      stageFiles(Array.from(event.dataTransfer.files))
    }

    const uploadFiles = async (): Promise<void> => {
      if (uploading || libraryId.length === 0 || files.length === 0) return
      setUploading(true)
      setError(undefined)
      try {
        const tags = tagNames(tagInput)
        const next = await ctx.connection.ingestFiles(libraryId, files, tags)
        setResult(next)
        setResultTags(next.importedFiles === 0 ? [] : tags)
        setFiles([])
        setTagInput('')
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '批量上传失败')
      } finally {
        setUploading(false)
      }
    }

    return (
      <div className="page ingestion-page">
        <header className="page-header compact-header">
          <div><p className="eyebrow">本地空间</p><h1>上传中心</h1></div>
          <div className="header-actions">
            <button className="secondary-button" type="button" disabled={uploading || libraries.length === 0} onClick={() => inputRef.current?.click()}><FileText size={16} />选择文件</button>
            <button className="primary-button" type="button" disabled={uploading || files.length === 0 || libraryId.length === 0} onClick={() => void uploadFiles()}><Upload size={16} />{uploading ? '处理中...' : `导入 ${files.length || ''}`}</button>
          </div>
        </header>
        <input ref={inputRef} hidden disabled={libraries.length === 0} type="file" multiple accept=".txt,.md,.markdown,.pdf,.url,.webloc,text/plain,text/markdown,application/pdf" onChange={onFileChange} />
        <div className="ingestion-workspace">
          <section className="ingestion-toolbar" aria-label="导入目标">
            <div className="ingestion-toolbar-fields">
              <label><span>目标知识库</span><select disabled={loading || uploading || libraries.length === 0} value={libraryId} onChange={event => setLibraryId(event.target.value)}>{libraries.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>
              <label className="ingestion-tag-field"><span>批量标签</span><input disabled={uploading} maxLength={340} value={tagInput} onChange={event => setTagInput(event.target.value)} placeholder="产品，规范" /></label>
            </div>
            <div className="ingestion-toolbar-info"><strong>支持 TXT、Markdown、文本型 PDF、网址快捷方式</strong><span>单文件不超过 200 MB，每批最多 50 个。超过 5000 页的 PDF 仍可导入，检索和 Wiki 使用前 5000 页文本</span></div>
          </section>
          {libraries.length === 0 && !loading ? (
            <div className="workspace-state"><span>请先创建一个知识库，再导入文件。</span><button className="secondary-button" type="button" onClick={() => ctx.clientApp.selectPage('knowledge')}>返回知识库</button></div>
          ) : result !== undefined ? (
            <section className="ingestion-results" aria-labelledby="ingestion-result-title">
              <div className="ingestion-section-heading"><div><h2 id="ingestion-result-title">本次导入完成</h2><p>成功 {result.importedFiles}，重复 {result.duplicateFiles}，失败 {result.failedFiles}{resultTags.length === 0 ? '' : ` · 标签：${resultTags.join('、')}`}</p></div><button className="secondary-button" type="button" onClick={() => { setResult(undefined); setResultTags([]) }}><RotateCcw size={15} />继续导入</button></div>
              <div className="ingestion-file-list">{result.results.map((item, index) => <div className="ingestion-result-row" key={`${item.fileName}:${index}`}><span className={`result-icon result-${item.status}`}>{item.status === 'imported' ? <CheckCircle2 size={17} /> : item.status === 'duplicate' ? <RotateCcw size={17} /> : <XCircle size={17} />}</span><div><strong>{item.fileName}</strong><span>{item.status === 'imported' ? '已写入并完成全文索引' : item.message}</span></div><em>{item.status === 'imported' ? '已导入' : item.status === 'duplicate' ? '重复' : '失败'}</em></div>)}</div>
            </section>
          ) : (
            <section className="ingestion-staging" aria-labelledby="staging-title">
              <div className={`upload-dropzone ${dragging ? 'dragging' : ''}`} onDragEnter={event => { event.preventDefault(); setDragging(true) }} onDragOver={event => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
                <Upload size={24} /><h2 id="staging-title">拖放文件到这里</h2><p>也可以从本机选择多个文件</p><button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}>选择文件</button>
              </div>
              {files.length > 0 && <div className="ingestion-file-list" aria-label="待导入文件">{files.map(file => <div className="ingestion-file-row" key={fileKey(file)}><FileText size={17} /><div><strong>{file.name}</strong><span>{formatBytes(file.size)}</span></div><button className="icon-button" type="button" title={`移除 ${file.name}`} disabled={uploading} onClick={() => setFiles(current => current.filter(item => fileKey(item) !== fileKey(file)))}><X size={16} /></button></div>)}</div>}
            </section>
          )}
          {error !== undefined && <div className="form-error ingestion-error" role="alert">{error}</div>}
        </div>
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerPage({
    id: 'ingestion',
    label: '上传',
    icon: Upload,
    component: IngestionPage,
    order: 20,
    section: 'primary',
  }), 'ui-ingestion: page')
}
