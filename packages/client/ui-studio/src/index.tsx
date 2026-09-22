import type { Context } from '@deepseek-ai/cordis'
import { ChevronDown, ChevronRight, FileText, FolderClosed, FolderPlus, ImagePlus, Mic, Pencil, PenLine, Settings, Square, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX, type ReactNode } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type {} from '@tiggyknowledge/client-runtime'
import type { KnowledgeDocument, KnowledgeLibrary } from '@tiggyknowledge/contracts'
import './styles.css'

export const inject = ['clientApp', 'connection']

const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const DEFAULT_CATEGORY = '未分类'
const DEFAULT_NOTE_TITLE = '未命名笔记'
const RECENT_LIMIT = 5

function documentCategory(document: KnowledgeDocument): string {
  const category = document.category?.trim()
  return category === undefined || category.length === 0 ? DEFAULT_CATEGORY : category
}

function lastUsedCategory(items: KnowledgeDocument[]): string {
  const latest = [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0]
  return latest === undefined ? DEFAULT_CATEGORY : documentCategory(latest)
}

function sortCategoryNames(names: Iterable<string>): string[] {
  return [...new Set(names)].sort((left, right) => {
    if (left === DEFAULT_CATEGORY) return 1
    if (right === DEFAULT_CATEGORY) return -1
    return left.localeCompare(right, 'zh-CN')
  })
}

function groupStudioItems(items: KnowledgeDocument[], categoryNames: string[]): {
  recent: KnowledgeDocument[]
  folders: Array<{ name: string, items: KnowledgeDocument[], total: number }>
} {
  const sorted = [...items].sort((left, right) => {
    const delta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    return delta === 0 ? left.title.localeCompare(right.title, 'zh-CN') : delta
  })
  const recent = sorted.slice(0, RECENT_LIMIT)
  const recentIds = new Set(recent.map(item => item.id))
  const names = sortCategoryNames([...categoryNames, ...items.map(documentCategory), DEFAULT_CATEGORY])
  return {
    recent,
    folders: names.map(name => {
      const all = sorted.filter(item => documentCategory(item) === name)
      return { name, items: all.filter(item => !recentIds.has(item.id)), total: all.length }
    }),
  }
}

type StudioView =
  | { kind: 'empty' }
  | { kind: 'note', documentId?: string }
  | { kind: 'recording', documentId?: string }

interface SpeechRecognitionLike extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean, 0: { transcript: string } }>
}

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | undefined {
  const speechWindow = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
}

function parseMarkdownNote(content: string): { title: string, body: string } {
  const normalized = content.replaceAll('\r\n', '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.startsWith('# ')) {
    const title = lines[0].slice(2).trim()
    const bodyStart = lines[1]?.trim().length === 0 ? 2 : 1
    return { title, body: lines.slice(bodyStart).join('\n').replace(/\s+$/u, '') }
  }
  return { title: '', body: normalized.replace(/\s+$/u, '') }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('录音编码失败'))
    reader.readAsDataURL(blob)
  })
}

function documentIdOf(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const documentId = (value as Record<string, unknown>).documentId
  return typeof documentId === 'string' && documentId.length > 0 ? documentId : undefined
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

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

function insertAtCursor(textarea: HTMLTextAreaElement | null, current: string, snippet: string): string {
  const start = textarea?.selectionStart ?? current.length
  const end = textarea?.selectionEnd ?? current.length
  const before = current.slice(0, start)
  const after = current.slice(end)
  const padBefore = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const padAfter = after.startsWith('\n') ? '' : '\n\n'
  const next = `${before}${padBefore}${snippet}${padAfter}${after}`
  const cursor = before.length + padBefore.length + snippet.length + (padAfter === '\n\n' ? 2 : 0)
  queueMicrotask(() => {
    if (textarea === null) return
    textarea.focus()
    textarea.setSelectionRange(cursor, cursor)
  })
  return next
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

function MarkdownPreview({ content }: { content: string }): JSX.Element {
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
  return <div className="note-markdown">{blocks.length === 0 ? <p className="note-preview-empty">开始写正文后，这里会显示预览。</p> : blocks}</div>
}

function itemKindLabel(item: KnowledgeDocument): string {
  if (item.sourceType === 'audio') return item.transcript?.trim() ? '录音 · 已转写' : '录音 · 待转写'
  return `笔记 · ${documentCategory(item)}`
}

function StudioListRow({
  item,
  active,
  onOpen,
  onDelete,
}: {
  item: KnowledgeDocument
  active: boolean
  onOpen: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <div className={`document-row ${active ? 'active' : ''}`}>
      <span />
      <button className="document-open" type="button" onClick={onOpen}>
        {item.sourceType === 'audio' ? <Mic size={16} /> : <FileText size={16} />}
        <span>
          <strong>{item.title}</strong>
          <small>{itemKindLabel(item)} · {DATE_FORMATTER.format(new Date(item.updatedAt))}</small>
        </span>
      </button>
      <button className="document-delete" type="button" title="删除草稿" onClick={onDelete}><Trash2 size={15} /></button>
    </div>
  )
}

function CategoryField({
  category,
  categories,
  onChange,
}: {
  category: string
  categories: string[]
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <label className="form-field studio-category-field">
      <span>分类</span>
      <input
        list="studio-categories"
        maxLength={40}
        value={category}
        onChange={event => onChange(event.target.value)}
        placeholder="给这篇笔记一个分类"
      />
      <datalist id="studio-categories">
        {categories.map(name => <option key={name} value={name} />)}
      </datalist>
    </label>
  )
}

export function apply(ctx: Context): void {
  function StudioPage(): JSX.Element {
    const app = useSyncExternalStore(ctx.clientApp.subscribe, ctx.clientApp.getSnapshot)
    const [items, setItems] = useState<KnowledgeDocument[]>([])
    const [namedCategories, setNamedCategories] = useState<string[]>([DEFAULT_CATEGORY])
    const [transcriptionReady, setTranscriptionReady] = useState(false)
    const [preferredCategory, setPreferredCategory] = useState(DEFAULT_CATEGORY)
    const [categoryDialog, setCategoryDialog] = useState<{ kind: 'create' } | { kind: 'rename', from: string }>()
    const [deleteCategoryName, setDeleteCategoryName] = useState<string>()
    const [categoryName, setCategoryName] = useState('')
    const [categoryBusy, setCategoryBusy] = useState(false)
    const [categoryError, setCategoryError] = useState<string>()
    const [libraries, setLibraries] = useState<KnowledgeLibrary[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string>()
    const [view, setView] = useState<StudioView>({ kind: 'empty' })
    const [title, setTitle] = useState('')
    const [body, setBody] = useState('')
    const [category, setCategory] = useState(DEFAULT_CATEGORY)
    const [transcript, setTranscript] = useState('')
    const [dirty, setDirty] = useState(false)
    const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({})
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string>()
    const [status, setStatus] = useState<string>()
    const [recording, setRecording] = useState(false)
    const [elapsedMs, setElapsedMs] = useState(0)
    const [recordError, setRecordError] = useState<string>()
    const [transcribing, setTranscribing] = useState(false)
    const [insertingImage, setInsertingImage] = useState(false)
    const [transferTarget, setTransferTarget] = useState<KnowledgeDocument>()
    const [transferLibraryId, setTransferLibraryId] = useState('')
    const [transferring, setTransferring] = useState(false)
    const [transferError, setTransferError] = useState<string>()
    const [deleteTarget, setDeleteTarget] = useState<KnowledgeDocument>()
    const [deleting, setDeleting] = useState(false)
    const recorderRef = useRef<MediaRecorder>()
    const bodyRef = useRef<HTMLTextAreaElement>(null)
    const imageInputRef = useRef<HTMLInputElement>(null)
    const chunksRef = useRef<Blob[]>([])
    const streamRef = useRef<MediaStream>()
    const recognitionRef = useRef<SpeechRecognitionLike>()
    const startedAtRef = useRef(0)
    const appliedIdRef = useRef<string>()
    const draftRef = useRef({ title: '', body: '', category: DEFAULT_CATEGORY, transcript: '', dirty: false, saving: false })
    const groups = useMemo(() => groupStudioItems(items, namedCategories), [items, namedCategories])
    const categories = useMemo(() => {
      const names = new Set(namedCategories)
      for (const item of items) names.add(documentCategory(item))
      if (category.trim().length > 0) names.add(category.trim())
      return sortCategoryNames(names)
    }, [category, items, namedCategories])
    const audioUrl = useMemo(() => {
      if (view.kind !== 'recording' || view.documentId === undefined) return undefined
      return ctx.connection.documentContentUrl(view.documentId)
    }, [view])
    const preview = useMemo(() => (title.trim().length === 0 ? body : `# ${title.trim()}\n\n${body}`), [body, title])
    const selectedId = view.kind === 'empty' ? undefined : view.documentId
    const selected = selectedId === undefined ? undefined : items.find(item => item.id === selectedId)
    draftRef.current = { title, body, category, transcript, dirty, saving }

    const reload = async (signal?: AbortSignal): Promise<KnowledgeDocument[]> => {
      const [workspace, knowledgeLibraries] = await Promise.all([
        ctx.connection.studio(signal),
        ctx.connection.libraries(signal),
      ])
      setItems(workspace.items)
      setNamedCategories(workspace.categories.length === 0 ? [DEFAULT_CATEGORY] : workspace.categories)
      setTranscriptionReady(workspace.transcriptionReady)
      setLibraries(knowledgeLibraries)
      if (transferLibraryId.length === 0 && knowledgeLibraries[0] !== undefined) setTransferLibraryId(knowledgeLibraries[0].id)
      return workspace.items
    }

    useEffect(() => {
      const controller = new AbortController()
      void reload(controller.signal).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '创作内容加载失败')
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
      return () => controller.abort()
    }, [])

    useEffect(() => {
      const documentId = documentIdOf(app.pageState)
      if (documentId === undefined || documentId === appliedIdRef.current || items.length === 0) return
      const document = items.find(item => item.id === documentId)
      if (document === undefined) return
      appliedIdRef.current = documentId
      void showDocument(document, false)
    }, [app.pageState, items])

    useEffect(() => () => {
      void stopMedia()
    }, [])

    useEffect(() => {
      if (!recording) return
      const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200)
      return () => window.clearInterval(timer)
    }, [recording])

    const stopMedia = async (): Promise<string> => {
      const recorder = recorderRef.current
      const mimeType = recorder?.mimeType ?? 'audio/webm'
      if (recorder !== undefined && recorder.state !== 'inactive') {
        await new Promise<void>(resolve => {
          recorder.addEventListener('stop', () => resolve(), { once: true })
          recorder.stop()
        })
      }
      recorderRef.current = undefined
      recognitionRef.current?.stop()
      recognitionRef.current = undefined
      for (const track of streamRef.current?.getTracks() ?? []) track.stop()
      streamRef.current = undefined
      setRecording(false)
      return mimeType
    }

    const showDocument = async (document: KnowledgeDocument, persistCurrent: boolean): Promise<void> => {
      if (persistCurrent && !(await persistCurrentDraft())) return
      await stopMedia()
      chunksRef.current = []
      setSaveError(undefined)
      setRecordError(undefined)
      setStatus(undefined)
      setDirty(false)
      appliedIdRef.current = document.id
      ctx.clientApp.updatePageState({ documentId: document.id })
      if (document.sourceType === 'audio') {
        setTitle(document.title)
        setCategory(documentCategory(document))
        setTranscript(document.transcript ?? '')
        setBody('')
        setView({ kind: 'recording', documentId: document.id })
        return
      }
      setView({ kind: 'note', documentId: document.id })
      setTitle(document.title)
      setCategory(documentCategory(document))
      setBody('')
      try {
        const previewResult = await ctx.connection.documentPreview(document.id)
        const parsed = parseMarkdownNote(previewResult.content)
        setTitle(parsed.title || document.title)
        setBody(parsed.body)
      } catch (reason: unknown) {
        setSaveError(reason instanceof Error ? reason.message : '笔记加载失败')
      }
    }

    const persistCurrentDraft = async (): Promise<boolean> => {
      if (saving) return true
      if (view.kind === 'note') {
        if (!dirty) return true
        return (await saveNote(false)) !== undefined
      }
      if (view.kind === 'recording') {
        if (recording || chunksRef.current.length > 0) {
          await saveRecording()
          return true
        }
        if (!dirty || title.trim().length === 0 || view.documentId === undefined) return true
        try {
          await ctx.connection.updateStudioRecording(view.documentId, { title, transcript, category })
          setDirty(false)
          return true
        } catch (reason: unknown) {
          setSaveError(reason instanceof Error ? reason.message : '草稿保存失败')
          return false
        }
      }
      return true
    }

    const startNewNote = async (): Promise<void> => {
      if (!(await persistCurrentDraft())) return
      await stopMedia()
      chunksRef.current = []
      appliedIdRef.current = undefined
      ctx.clientApp.updatePageState({})
      setTitle('')
      setBody('')
      setCategory(preferredCategory || lastUsedCategory(items))
      setTranscript('')
      setDirty(false)
      setSaveError(undefined)
      setRecordError(undefined)
      setStatus(undefined)
      setView({ kind: 'note' })
    }

    const startNewRecording = async (): Promise<void> => {
      if (!(await persistCurrentDraft())) return
      await stopMedia()
      chunksRef.current = []
      appliedIdRef.current = undefined
      ctx.clientApp.updatePageState({})
      setTitle(`录音 ${DATE_FORMATTER.format(new Date())}`)
      setBody('')
      setCategory(preferredCategory || lastUsedCategory(items))
      setTranscript('')
      setDirty(false)
      setElapsedMs(0)
      setSaveError(undefined)
      setRecordError(undefined)
      setStatus(undefined)
      setView({ kind: 'recording' })
    }

    const saveNote = async (reloadList = true): Promise<KnowledgeDocument | undefined> => {
      if (view.kind !== 'note' || saving) return undefined
      const resolvedTitle = title.trim() || DEFAULT_NOTE_TITLE
      const resolvedCategory = category.trim() || DEFAULT_CATEGORY
      setSaving(true)
      setSaveError(undefined)
      try {
        const snapshot = { title, body, category }
        const saved = view.documentId === undefined
          ? await ctx.connection.createStudioNote({ title: resolvedTitle, body, category: resolvedCategory })
          : await ctx.connection.updateStudioNote(view.documentId, { title: resolvedTitle, body, category: resolvedCategory })
        appliedIdRef.current = saved.id
        setView({ kind: 'note', documentId: saved.id })
        ctx.clientApp.updatePageState({ documentId: saved.id })
        const latest = draftRef.current
        const stillDirty = latest.title !== snapshot.title || latest.body !== snapshot.body || latest.category !== snapshot.category
        setDirty(stillDirty)
        if (!stillDirty) {
          if (title.trim().length === 0) setTitle(saved.title)
          setCategory(saved.category ?? DEFAULT_CATEGORY)
        }
        setStatus('已自动保存')
        if (reloadList) await reload()
        return saved
      } catch (reason: unknown) {
        setSaveError(reason instanceof Error ? reason.message : '笔记保存失败')
        return undefined
      } finally {
        setSaving(false)
      }
    }

    const attachImages = async (files: File[]): Promise<void> => {
      const images = files.filter(file => file.type.startsWith('image/'))
      if (images.length === 0 || insertingImage) return
      setInsertingImage(true)
      setSaveError(undefined)
      try {
        for (let attempt = 0; attempt < 20 && draftRef.current.saving; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        let documentId = view.kind === 'note' ? view.documentId : undefined
        if (documentId === undefined) documentId = appliedIdRef.current
        if (documentId === undefined) {
          const saved = await saveNote(true)
          documentId = saved?.id
        }
        if (documentId === undefined) {
          setSaveError('图片已准备好，先写个标题就会自动插入')
          return
        }
        let nextBody = body
        for (const [index, file] of images.entries()) {
          const attached = await ctx.connection.attachStudioNoteImage(documentId, {
            mimeType: file.type,
            imageBase64: await blobToBase64(file),
            name: file.name.replace(/\.[^.]+$/u, '') || '图片',
          })
          nextBody = index === 0
            ? insertAtCursor(bodyRef.current, nextBody, attached.markdown)
            : `${nextBody.replace(/\s+$/u, '')}\n\n${attached.markdown}\n`
        }
        setBody(nextBody)
        setDirty(true)
        setStatus(images.length === 1 ? '已插入图片' : `已插入 ${images.length} 张图片`)
      } catch (reason: unknown) {
        setSaveError(reason instanceof Error ? reason.message : '图片插入失败')
      } finally {
        setInsertingImage(false)
      }
    }

    const startRecording = async (): Promise<void> => {
      setRecordError(undefined)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
        const recorder = new MediaRecorder(stream, { mimeType })
        chunksRef.current = []
        recorder.ondataavailable = event => {
          if (event.data.size > 0) chunksRef.current.push(event.data)
        }
        recorder.start(250)
        recorderRef.current = recorder
        startedAtRef.current = Date.now()
        setElapsedMs(0)
        setRecording(true)
        const Recognition = speechRecognitionCtor()
        if (Recognition === undefined) return
        const prefix = transcript.trim()
        const recognition = new Recognition()
        recognition.lang = 'zh-CN'
        recognition.continuous = true
        recognition.interimResults = true
        recognition.onresult = event => {
          let finals = ''
          let interim = ''
          for (let index = 0; index < event.results.length; index += 1) {
            const result = event.results[index]
            if (result === undefined) continue
            if (result.isFinal) finals += result[0].transcript
            else interim += result[0].transcript
          }
          const spoken = `${finals}${interim}`.trim()
          setTranscript([prefix, spoken].filter(part => part.length > 0).join(' '))
          setDirty(true)
        }
        recognition.onerror = event => {
          if (event.error === 'not-allowed') setRecordError('没有语音识别权限。录音仍可保存，保存后可再转文字。')
        }
        recognition.onend = () => {
          if (recorderRef.current?.state === 'recording') {
            try { recognition.start() } catch { /* recognition can end while still recording */ }
          }
        }
        recognitionRef.current = recognition
        try { recognition.start() } catch { /* live transcription is optional */ }
      } catch (reason: unknown) {
        setRecordError(reason instanceof Error ? reason.message : '无法开始录音，请检查麦克风权限')
        await stopMedia()
      }
    }

    const saveRecording = async (): Promise<void> => {
      if (view.kind !== 'recording' || title.trim().length === 0 || saving) return
      setSaving(true)
      setSaveError(undefined)
      try {
        if (view.documentId !== undefined && chunksRef.current.length === 0 && !recording) {
          const snapshot = { title, transcript, category }
          const saved = await ctx.connection.updateStudioRecording(view.documentId, { title, transcript, category })
          appliedIdRef.current = saved.id
          const latest = draftRef.current
          setDirty(latest.title !== snapshot.title || latest.transcript !== snapshot.transcript || latest.category !== snapshot.category)
          setStatus('已自动保存')
          await reload()
          return
        }
        const mimeType = ((await stopMedia()) || 'audio/webm').split(';')[0] ?? 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        if (blob.size === 0) throw new Error('还没有录到声音，请先点开始录音')
        const saved = await ctx.connection.createStudioRecording({
          title,
          mimeType,
          audioBase64: await blobToBase64(blob),
          transcript,
          category,
        })
        chunksRef.current = []
        appliedIdRef.current = saved.id
        setView({ kind: 'recording', documentId: saved.id })
        ctx.clientApp.updatePageState({ documentId: saved.id })
        setDirty(false)
        setStatus('已自动保存')
        await reload()
        if ((saved.transcript ?? transcript).trim().length === 0) {
          if (transcriptionReady) {
            setTranscribing(true)
            try {
              const transcribed = await ctx.connection.transcribeStudioRecording(saved.id)
              setTranscript(transcribed.transcript ?? '')
              setStatus('已自动转成文字')
              await reload()
            } catch (reason: unknown) {
              setStatus(reason instanceof Error ? `录音已保存。${reason.message}` : '录音已保存，稍后可再转文字')
            } finally {
              setTranscribing(false)
            }
          } else {
            setStatus('录音已保存。自动转文字需要先在设置中指定语音转写模型')
          }
        }
      } catch (reason: unknown) {
        setSaveError(reason instanceof Error ? reason.message : '录音保存失败')
      } finally {
        setSaving(false)
      }
    }

    const transcribe = async (): Promise<void> => {
      if (view.kind !== 'recording' || view.documentId === undefined || transcribing || !transcriptionReady) return
      setTranscribing(true)
      setSaveError(undefined)
      try {
        const saved = await ctx.connection.transcribeStudioRecording(view.documentId)
        setTranscript(saved.transcript ?? '')
        setDirty(false)
        setStatus('已转成文字')
        await reload()
      } catch (reason: unknown) {
        setSaveError(reason instanceof Error ? reason.message : '自动转写失败，可先手动改文字')
      } finally {
        setTranscribing(false)
      }
    }

    const confirmTransfer = async (): Promise<void> => {
      if (transferTarget === undefined || transferring) return
      setTransferring(true)
      setTransferError(undefined)
      try {
        if (!(await persistCurrentDraft())) {
          setTransferring(false)
          return
        }
        const library = libraries.find(item => item.id === transferLibraryId)
        await ctx.connection.transferStudioDocument(transferTarget.id, { libraryId: transferLibraryId })
        setTransferTarget(undefined)
        appliedIdRef.current = undefined
        ctx.clientApp.updatePageState({})
        setView({ kind: 'empty' })
        setTitle('')
        setBody('')
        setCategory(DEFAULT_CATEGORY)
        setTranscript('')
        setDirty(false)
        setStatus(`已转入「${library?.name ?? '知识库'}」，Wiki 仍需逐篇确认`)
        await reload()
      } catch (reason: unknown) {
        setTransferError(reason instanceof Error ? reason.message : '转存失败')
      } finally {
        setTransferring(false)
      }
    }

    const applyWorkspace = (workspace: { items: KnowledgeDocument[], categories: string[], transcriptionReady: boolean }): void => {
      setItems(workspace.items)
      setNamedCategories(workspace.categories.length === 0 ? [DEFAULT_CATEGORY] : workspace.categories)
      setTranscriptionReady(workspace.transcriptionReady)
    }

    const openCreateCategory = (): void => {
      setCategoryError(undefined)
      setCategoryName('')
      setCategoryDialog({ kind: 'create' })
    }

    const openRenameCategory = (from: string): void => {
      setCategoryError(undefined)
      setCategoryName(from)
      setCategoryDialog({ kind: 'rename', from })
    }

    const confirmCategoryDialog = async (): Promise<void> => {
      if (categoryDialog === undefined || categoryBusy) return
      const name = categoryName.trim()
      if (name.length === 0) {
        setCategoryError('请输入分类名称')
        return
      }
      setCategoryBusy(true)
      setCategoryError(undefined)
      try {
        const workspace = categoryDialog.kind === 'create'
          ? await ctx.connection.createStudioCategory({ name })
          : await ctx.connection.renameStudioCategory({ from: categoryDialog.from, name })
        applyWorkspace(workspace)
        setPreferredCategory(name)
        if (categoryDialog.kind === 'rename') {
          setCollapsedFolders(current => {
            const next = { ...current }
            const wasCollapsed = next[categoryDialog.from]
            delete next[categoryDialog.from]
            if (wasCollapsed === true) next[name] = true
            return next
          })
          if (category === categoryDialog.from) setCategory(name)
        }
        setCategoryDialog(undefined)
        setStatus(categoryDialog.kind === 'create' ? `已创建分类「${name}」` : `已将分类改为「${name}」`)
      } catch (reason: unknown) {
        setCategoryError(reason instanceof Error ? reason.message : '分类保存失败')
      } finally {
        setCategoryBusy(false)
      }
    }

    const confirmDeleteCategory = async (): Promise<void> => {
      if (deleteCategoryName === undefined || categoryBusy) return
      setCategoryBusy(true)
      setCategoryError(undefined)
      try {
        const workspace = await ctx.connection.deleteStudioCategory({ name: deleteCategoryName })
        applyWorkspace(workspace)
        setCollapsedFolders(current => {
          const next = { ...current }
          delete next[deleteCategoryName]
          return next
        })
        if (category === deleteCategoryName) setCategory(DEFAULT_CATEGORY)
        if (preferredCategory === deleteCategoryName) setPreferredCategory(DEFAULT_CATEGORY)
        setDeleteCategoryName(undefined)
        setStatus(`已删除分类「${deleteCategoryName}」，其中草稿已归入「${DEFAULT_CATEGORY}」`)
      } catch (reason: unknown) {
        setCategoryError(reason instanceof Error ? reason.message : '分类删除失败')
      } finally {
        setCategoryBusy(false)
      }
    }

    const confirmDelete = async (): Promise<void> => {
      if (deleteTarget === undefined || deleting) return
      setDeleting(true)
      try {
        await ctx.connection.deleteDocuments([deleteTarget.id])
        const deletingCurrent = selectedId === deleteTarget.id
        setDeleteTarget(undefined)
        if (deletingCurrent) {
          appliedIdRef.current = undefined
          ctx.clientApp.updatePageState({})
          setView({ kind: 'empty' })
          setTitle('')
          setBody('')
          setCategory(DEFAULT_CATEGORY)
          setTranscript('')
          setDirty(false)
        }
        await reload()
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : '删除失败')
      } finally {
        setDeleting(false)
      }
    }

    const markEdited = (): void => {
      setDirty(true)
      setSaveError(undefined)
      setStatus(undefined)
    }

    useEffect(() => {
      if (!dirty || saving || saveError !== undefined) return
      if (view.kind === 'note') {
        const timer = window.setTimeout(() => { void saveNote(true) }, 700)
        return () => window.clearTimeout(timer)
      }
      if (view.kind === 'recording' && view.documentId !== undefined && !recording) {
        const timer = window.setTimeout(() => { void saveRecording() }, 700)
        return () => window.clearTimeout(timer)
      }
      return undefined
    }, [body, category, dirty, recording, saveError, saving, title, transcript, view])

    return (
      <div className="page studio-page documents-page">
        <header className="page-header compact-header documents-header">
          <div>
            <p className="eyebrow">草稿</p>
            <h1>创作</h1>
          </div>
          <div className="header-actions">
            <button className="secondary-button" type="button" onClick={() => void startNewNote()}><PenLine size={16} />创建笔记</button>
            <button className="secondary-button" type="button" onClick={() => void startNewRecording()}><Mic size={16} />创建录音</button>
            {selected !== undefined && (
              <button className="secondary-button" type="button" onClick={() => { setTransferError(undefined); setTransferTarget(selected) }}>
                <Upload size={16} />转存到知识库
              </button>
            )}
            {view.kind !== 'empty' && (
              <span className={`studio-autosave ${saveError === undefined ? '' : 'error'}`}>
                {saving ? '正在保存...' : dirty ? '编辑后自动保存' : status ?? '已自动保存'}
              </span>
            )}
          </div>
        </header>

        <div className="documents-workbench studio-workbench">
          <section className="document-list-pane" aria-label="创作草稿列表">
            <div className="document-list-heading">
              <span>草稿 · {items.length} 篇</span>
              <button className="studio-heading-action" type="button" onClick={openCreateCategory}><FolderPlus size={13} />创建分类</button>
            </div>
            {loading ? (
              <div className="document-pane-state">正在读取创作草稿...</div>
            ) : error !== undefined ? (
              <div className="document-pane-state error-state"><strong>无法读取创作内容</strong><span>{error}</span></div>
            ) : (
              <div className="document-list">
                {groups.recent.length > 0 && (
                  <div className="studio-list-section">
                    <p className="studio-list-label">最近修改</p>
                    {groups.recent.map(item => (
                      <StudioListRow
                        active={selectedId === item.id}
                        item={item}
                        key={item.id}
                        onDelete={() => setDeleteTarget(item)}
                        onOpen={() => void showDocument(item, true)}
                      />
                    ))}
                  </div>
                )}
                {groups.folders.map(folder => {
                  const collapsed = collapsedFolders[folder.name] === true
                  return (
                    <div className="studio-list-section" key={folder.name}>
                      <div className="studio-folder-row">
                        <button
                          className="studio-folder"
                          type="button"
                          onClick={() => {
                            setPreferredCategory(folder.name)
                            setCollapsedFolders(current => ({ ...current, [folder.name]: current[folder.name] !== true }))
                          }}
                        >
                          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                          <FolderClosed size={13} />
                          <span>{folder.name}</span>
                          <em>{folder.total}</em>
                        </button>
                        <div className="studio-folder-actions">
                          <button
                            className="studio-folder-rename"
                            type="button"
                            title="重命名分类"
                            onClick={() => openRenameCategory(folder.name)}
                          >
                            <Pencil size={12} />
                          </button>
                          {folder.name !== DEFAULT_CATEGORY && (
                            <button
                              className="studio-folder-rename"
                              type="button"
                              title="删除分类"
                              onClick={() => { setCategoryError(undefined); setDeleteCategoryName(folder.name) }}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                      {collapsed ? undefined : folder.items.length === 0 ? (
                        <p className="studio-folder-empty">{folder.total === 0 ? '空分类，创建笔记时可选它' : '其余篇目在「最近修改」里'}</p>
                      ) : folder.items.map(item => (
                        <StudioListRow
                          active={selectedId === item.id}
                          item={item}
                          key={item.id}
                          onDelete={() => setDeleteTarget(item)}
                          onOpen={() => void showDocument(item, true)}
                        />
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="document-preview-pane studio-editor-pane" aria-label="创作编辑区">
            {view.kind === 'empty' ? (
              <div className="document-preview-empty">
                <PenLine size={26} />
                <strong>从左侧打开草稿，或创建笔记 / 创建录音</strong>
                <span>草稿默认不进知识库，也不会自动解析到 Wiki。</span>
              </div>
            ) : view.kind === 'note' ? (
              <div className="studio-note-editor">
                <div className="studio-editor-meta">
                  <label className="note-title-field">
                    <span className="visually-hidden">标题</span>
                    <input autoFocus maxLength={200} value={title} onChange={event => { setTitle(event.target.value); markEdited() }} placeholder="笔记标题" />
                  </label>
                  <CategoryField
                    categories={categories}
                    category={category}
                    onChange={value => { setCategory(value); markEdited() }}
                  />
                </div>
                <div className="studio-note-toolbar">
                  <button className="secondary-button" type="button" disabled={insertingImage} onClick={() => imageInputRef.current?.click()}>
                    <ImagePlus size={15} />{insertingImage ? '插入中...' : '插入图片'}
                  </button>
                  <span>Markdown 笔记，可粘贴或拖入图片</span>
                  <input
                    ref={imageInputRef}
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    hidden
                    multiple
                    type="file"
                    onChange={event => {
                      const files = [...(event.target.files ?? [])]
                      event.target.value = ''
                      void attachImages(files)
                    }}
                  />
                </div>
                <div className="note-split" aria-label="笔记编辑与预览">
                  <label className="note-body-field">
                    <span className="visually-hidden">正文</span>
                    <textarea
                      ref={bodyRef}
                      value={body}
                      onChange={event => { setBody(event.target.value); markEdited() }}
                      onPaste={event => {
                        const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'))
                        if (files.length === 0) return
                        event.preventDefault()
                        void attachImages(files)
                      }}
                      onDrop={event => {
                        const files = [...event.dataTransfer.files].filter(file => file.type.startsWith('image/'))
                        if (files.length === 0) return
                        event.preventDefault()
                        void attachImages(files)
                      }}
                      onDragOver={event => {
                        if ([...event.dataTransfer.types].includes('Files')) event.preventDefault()
                      }}
                      placeholder="写下 Markdown 正文。可直接粘贴或拖入图片，改完会自动保存。"
                    />
                  </label>
                  <section className="note-preview-pane" aria-label="实时预览">
                    <p className="note-preview-label">预览</p>
                    <MarkdownPreview content={preview} />
                  </section>
                </div>
              </div>
            ) : (
              <div className="studio-recording-editor">
                <div className="studio-editor-meta">
                  <label className="note-title-field">
                    <span className="visually-hidden">标题</span>
                    <input maxLength={200} value={title} onChange={event => { setTitle(event.target.value); markEdited() }} placeholder="录音标题" />
                  </label>
                  <CategoryField
                    categories={categories}
                    category={category}
                    onChange={value => { setCategory(value); markEdited() }}
                  />
                </div>
                {audioUrl !== undefined && (
                  <audio className="studio-audio" controls preload="metadata" src={audioUrl}>当前浏览器无法播放这段录音。</audio>
                )}
                {(view.documentId === undefined || recording) && (
                  <div className="studio-record-panel">
                    <button className={recording ? 'danger-button' : 'primary-button'} type="button" onClick={() => recording ? void saveRecording() : void startRecording()}>
                      {recording ? <Square size={16} /> : <Mic size={16} />}
                      {recording ? `停止并保存 ${formatElapsed(elapsedMs)}` : '开始录音'}
                    </button>
                    {recording && <span className="studio-recording-live">{transcriptionReady ? '停止后会自动保存并转写' : '停止后会自动保存，转写需先配置语音模型'}</span>}
                  </div>
                )}
                {view.documentId !== undefined && !recording && (
                  <p className="studio-recording-hint">{transcriptionReady ? '改标题、分类或转写会自动保存。也可点右上角「创建录音」再录一段新的。' : '改标题、分类或文字会自动保存。自动转文字需先指定语音转写模型。'}</p>
                )}
                <label className="form-field studio-transcript-field">
                  <span>转写文字</span>
                  <textarea rows={12} value={transcript} onChange={event => { setTranscript(event.target.value); markEdited() }} placeholder={transcriptionReady ? '保存录音后会用已配置的语音模型转成文字，之后改文字也会自动保存。' : '可先手写或粘贴文字。自动转写需要在设置中指定语音转写模型。'} />
                </label>
                {view.documentId !== undefined && (
                  <div className="header-actions">
                    <button className="secondary-button" type="button" disabled={!transcriptionReady || transcribing} onClick={() => void transcribe()}>
                      <FileText size={16} />{transcribing ? '转写中...' : '重新转文字'}
                    </button>
                    {!transcriptionReady && (
                      <button className="secondary-button" type="button" onClick={() => ctx.clientApp.selectPage('settings', { panelId: 'llm' })}>
                        <Settings size={16} />配置语音模型
                      </button>
                    )}
                  </div>
                )}
                {!transcriptionReady && view.kind === 'recording' && (
                  <p className="studio-recording-hint">没有配置语音转写模型时不能自动转文字。录音仍可保存，也可手动填写转写。</p>
                )}
              </div>
            )}
            {recordError !== undefined && <div className="form-error studio-banner" role="alert">{recordError}</div>}
            {saveError !== undefined && <div className="form-error studio-banner" role="alert">{saveError}</div>}
            {status !== undefined && saveError === undefined && <p className="studio-status">{status}</p>}
          </section>
        </div>

        {transferTarget !== undefined && (
          <div className="dialog-backdrop">
            <section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="studio-transfer-title">
              <header className="dialog-header">
                <div><p className="eyebrow">转存</p><h2 id="studio-transfer-title">把“{transferTarget.title}”转入知识库</h2></div>
                <button className="dialog-close" type="button" disabled={transferring} onClick={() => setTransferTarget(undefined)}><X size={18} /></button>
              </header>
              <div className="dialog-body">
                <p>转存后才会出现在知识库和搜索里。Wiki 仍需你逐篇确认后才会生成词条。</p>
                {libraries.length === 0 ? (
                  <div className="form-error" role="alert">还没有知识库，请先到知识库页面新建一个。</div>
                ) : (
                  <label className="form-field">
                    <span>目标知识库</span>
                    <select value={transferLibraryId} onChange={event => setTransferLibraryId(event.target.value)}>
                      {libraries.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}
                    </select>
                  </label>
                )}
                {transferError !== undefined && <div className="form-error" role="alert">{transferError}</div>}
              </div>
              <footer className="dialog-footer">
                <button className="secondary-button" type="button" disabled={transferring} onClick={() => setTransferTarget(undefined)}>取消</button>
                <button className="primary-button" type="button" disabled={transferring || libraries.length === 0} onClick={() => void confirmTransfer()}>{transferring ? '转存中...' : '转存'}</button>
              </footer>
            </section>
          </div>
        )}

        {categoryDialog !== undefined && (
          <div className="dialog-backdrop">
            <section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="studio-category-title">
              <header className="dialog-header">
                <div>
                  <p className="eyebrow">分类</p>
                  <h2 id="studio-category-title">{categoryDialog.kind === 'create' ? '创建分类' : `重命名「${categoryDialog.from}」`}</h2>
                </div>
                <button className="dialog-close" type="button" disabled={categoryBusy} onClick={() => setCategoryDialog(undefined)}><X size={18} /></button>
              </header>
              <div className="dialog-body">
                <label className="form-field">
                  <span>分类名称</span>
                  <input
                    autoFocus
                    disabled={categoryBusy}
                    maxLength={40}
                    value={categoryName}
                    onChange={event => setCategoryName(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') void confirmCategoryDialog() }}
                    placeholder="例如：会议、灵感、产品"
                  />
                </label>
                {categoryDialog.kind === 'rename' && <p>这个分类下的笔记和录音都会改成新名称。</p>}
                {categoryError !== undefined && <div className="form-error" role="alert">{categoryError}</div>}
              </div>
              <footer className="dialog-footer">
                <button className="secondary-button" type="button" disabled={categoryBusy} onClick={() => setCategoryDialog(undefined)}>取消</button>
                <button className="primary-button" type="button" disabled={categoryBusy} onClick={() => void confirmCategoryDialog()}>
                  {categoryBusy ? '保存中...' : categoryDialog.kind === 'create' ? '创建' : '保存名称'}
                </button>
              </footer>
            </section>
          </div>
        )}

        {deleteCategoryName !== undefined && (
          <div className="dialog-backdrop">
            <section className="dialog-panel delete-dialog" role="dialog" aria-modal="true" aria-labelledby="studio-delete-category-title">
              <header className="dialog-header">
                <div><p className="eyebrow">删除分类</p><h2 id="studio-delete-category-title">确认删除分类“{deleteCategoryName}”？</h2></div>
                <button className="dialog-close" type="button" disabled={categoryBusy} onClick={() => setDeleteCategoryName(undefined)}><X size={18} /></button>
              </header>
              <div className="dialog-body">
                <p>分类会删掉。里面的笔记和录音不会删除，会归到「{DEFAULT_CATEGORY}」。</p>
                {categoryError !== undefined && <div className="form-error" role="alert">{categoryError}</div>}
              </div>
              <footer className="dialog-footer">
                <button className="secondary-button" type="button" disabled={categoryBusy} onClick={() => setDeleteCategoryName(undefined)}>取消</button>
                <button className="danger-button" type="button" disabled={categoryBusy} onClick={() => void confirmDeleteCategory()}>
                  <Trash2 size={16} />{categoryBusy ? '删除中...' : '删除分类'}
                </button>
              </footer>
            </section>
          </div>
        )}

        {deleteTarget !== undefined && (
          <div className="dialog-backdrop">
            <section className="dialog-panel delete-dialog" role="dialog" aria-modal="true" aria-labelledby="studio-delete-title">
              <header className="dialog-header">
                <div><p className="eyebrow">删除草稿</p><h2 id="studio-delete-title">确认删除“{deleteTarget.title}”？</h2></div>
                <button className="dialog-close" type="button" disabled={deleting} onClick={() => setDeleteTarget(undefined)}><X size={18} /></button>
              </header>
              <div className="dialog-body">
                <p>草稿将从创作空间移除。若尚未转存，知识库和 Wiki 都不会包含它。</p>
              </div>
              <footer className="dialog-footer">
                <button className="secondary-button" type="button" disabled={deleting} onClick={() => setDeleteTarget(undefined)}>取消</button>
                <button className="danger-button" type="button" disabled={deleting} onClick={() => void confirmDelete()}><Trash2 size={16} />{deleting ? '删除中...' : '删除'}</button>
              </footer>
            </section>
          </div>
        )}
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerPage({
    id: 'studio',
    label: '创作',
    icon: PenLine,
    component: StudioPage,
    order: 10.5,
    section: 'primary',
  }), 'ui-studio: page')
}
