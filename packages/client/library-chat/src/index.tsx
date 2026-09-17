import type { Context } from '@deepseek-ai/cordis'
import { Bot, MessageCircle, Send, Square, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX, type KeyboardEvent, type ReactNode } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type {} from '@tiggyknowledge/client-runtime'
import {
  llmModelChoices,
  type LibraryChatMessage,
  type LibraryChatSnapshot,
  type LibraryChatStreamEvent,
  type LibraryChatTask,
  type LlmModelChoice,
  type SendLibraryChatMessageInput,
  type SystemSnapshot,
} from '@tiggyknowledge/contracts'
import './styles.css'

export const inject = ['clientApp', 'connection']

const selectedModels = new Map<string, string>()

export interface ChatGenerationIdentity {
  generation: number
  libraryId: string
}

interface ActiveChatStream extends ChatGenerationIdentity {
  controller: AbortController
  assistantMessageId?: string
}

export interface DocumentsPageState {
  libraryId?: string
  documentId?: string
}

export function documentsState(value: unknown): DocumentsPageState {
  if (value === null || typeof value !== 'object') return {}
  const state = value as Record<string, unknown>
  return {
    ...(typeof state.libraryId === 'string' ? { libraryId: state.libraryId } : {}),
    ...(typeof state.documentId === 'string' ? { documentId: state.documentId } : {}),
  }
}

export interface ChatToolActivity {
  task?: LibraryChatTask
  completed?: number
  total?: number
  phase?: string
  message?: string
}

export function chatTaskLabel(task: LibraryChatTask | undefined): string {
  if (task === 'summarize-current-document') return '总结当前文章'
  if (task === 'summarize-named-document') return '总结指定文章'
  if (task === 'summarize-library') return '总结整个知识库'
  return '检索知识'
}

export function applyChatToolEvent(
  activity: ChatToolActivity | undefined,
  event: LibraryChatStreamEvent,
): ChatToolActivity | undefined {
  if (event.type === 'routed') return { task: event.task }
  if (event.type === 'progress') {
    return {
      ...activity,
      completed: event.completed,
      total: event.total,
      ...(event.phase === undefined ? {} : { phase: event.phase }),
      ...(event.message === undefined ? {} : { message: event.message }),
    }
  }
  if (event.type === 'completed' || event.type === 'cancelled' || event.type === 'error') return undefined
  return activity
}

export function createChatSendInput(
  content: string,
  modelId: string,
  contextDocumentId: string | undefined,
): SendLibraryChatMessageInput {
  return {
    content,
    modelId,
    ...(contextDocumentId === undefined ? {} : { contextDocumentId }),
  }
}

export function preferredChatModel(system: SystemSnapshot | undefined, choices: LlmModelChoice[], remembered?: string): string {
  if (remembered !== undefined && choices.some(choice => choice.id === remembered)) return remembered
  const preferred = system?.llm?.preferredModelId
  if (preferred !== undefined && choices.some(choice => choice.id === preferred)) return preferred
  return choices[0]?.id ?? ''
}

export function applyChatStreamEvent(messages: LibraryChatMessage[], event: LibraryChatStreamEvent): LibraryChatMessage[] {
  if (event.type === 'started') {
    const ids = new Set([event.userMessage.id, event.assistantMessage.id])
    return [...messages.filter(message => !ids.has(message.id)), event.userMessage, event.assistantMessage]
  }
  if (event.type === 'completed' || event.type === 'cancelled') {
    return messages.map(message => message.id === event.message.id ? event.message : message)
  }
  if (event.type === 'routed' || event.type === 'progress') return messages
  return messages.map(message => {
    if (message.id !== event.messageId) return message
    if (event.type === 'delta') return { ...message, content: message.content + event.delta }
    if (event.type === 'sources') return { ...message, sources: event.sources }
    if (event.type === 'usage') return { ...message, tokenUsage: event.usage }
    return { ...message, state: 'failed', error: event.error }
  })
}

export function applyChatSnapshotEvent(
  snapshot: LibraryChatSnapshot | undefined,
  libraryId: string,
  event: LibraryChatStreamEvent,
): LibraryChatSnapshot {
  const activeMessageId = event.type === 'started'
    ? event.assistantMessage.id
    : event.type === 'completed' || event.type === 'cancelled' || event.type === 'error'
      ? undefined
      : snapshot?.activeMessageId
  return {
    libraryId,
    messages: applyChatStreamEvent(snapshot?.messages ?? [], event),
    ...(snapshot?.summary === undefined ? {} : { summary: snapshot.summary }),
    ...(activeMessageId === undefined ? {} : { activeMessageId }),
  }
}

export function isCurrentChatGeneration(
  current: ChatGenerationIdentity | undefined,
  candidate: ChatGenerationIdentity,
  libraryId: string | undefined,
): boolean {
  return current?.generation === candidate.generation
    && current.libraryId === candidate.libraryId
    && libraryId === candidate.libraryId
}

export function isLibraryChatSettled(snapshot: LibraryChatSnapshot): boolean {
  return snapshot.activeMessageId === undefined
    && snapshot.messages.every(message => message.state !== 'generating')
}

export function hasExpectedTerminalMessage(snapshot: LibraryChatSnapshot, assistantMessageId: string): boolean {
  const message = snapshot.messages.find(candidate => candidate.id === assistantMessageId)
  return message !== undefined && message.role === 'assistant' && message.state !== 'generating'
}

export function canApplyChatReconciliation(
  current: ChatGenerationIdentity | undefined,
  candidate: ChatGenerationIdentity,
  currentLibraryId: string | undefined,
  snapshot: LibraryChatSnapshot,
): boolean {
  return isCurrentChatGeneration(current, candidate, currentLibraryId)
    && snapshot.libraryId === candidate.libraryId
}

export function shouldApplyPersistedChatSnapshot(
  snapshot: LibraryChatSnapshot,
  assistantMessageId: string,
  terminalReceived: boolean,
): boolean {
  return !terminalReceived || hasExpectedTerminalMessage(snapshot, assistantMessageId)
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

function inlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)\n]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${match.index}`
    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('[')) {
      const parts = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(token)
      nodes.push(parts === null
        ? token
        : <a href={parts[2]} key={key} target="_blank" rel="noreferrer">{parts[1]}</a>)
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    cursor = match.index + token.length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

export function ChatMarkdown({ content }: { content: string }): JSX.Element {
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
      const language = line.slice(3).trim()
      const code: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(<pre key={`code-${index}`}><code data-language={language || undefined}>{code.join('\n')}</code></pre>)
      continue
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line)
    if (heading !== null) {
      const children = inlineMarkdown(heading[2] ?? '', `heading-${index}`)
      const level = heading[1]?.length ?? 1
      blocks.push(level === 1 ? <h1 key={`heading-${index}`}>{children}</h1>
        : level === 2 ? <h2 key={`heading-${index}`}>{children}</h2>
          : level === 3 ? <h3 key={`heading-${index}`}>{children}</h3>
            : <h4 key={`heading-${index}`}>{children}</h4>)
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
    if (line.startsWith('> ')) {
      const quote: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('> ')) {
        quote.push((lines[index] ?? '').slice(2))
        index += 1
      }
      blocks.push(<blockquote key={`quote-${index}`}>{inlineMarkdown(quote.join(' '), `quote-${index}`)}</blockquote>)
      continue
    }
    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && (lines[index] ?? '').trim() !== '' && !/^(#{1,4})\s|^```|^> |^\s*[-*+]\s+|^\s*\d+\.\s+/.test(lines[index] ?? '')) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraph.join('\n'), `paragraph-${index}`)}</p>)
  }
  return <div className="library-chat-markdown">{blocks}</div>
}

export function apply(ctx: Context): void {
  function LibraryChatOverlay(): JSX.Element | null {
    const app = useSyncExternalStore(ctx.clientApp.subscribe, ctx.clientApp.getSnapshot)
    const pageState = app.selectedPageId === 'documents' ? documentsState(app.pageState) : {}
    const libraryId = pageState.libraryId
    const contextDocumentId = pageState.documentId
    const [open, setOpen] = useState(false)
    const [snapshot, setSnapshot] = useState<LibraryChatSnapshot>()
    const [system, setSystem] = useState<SystemSnapshot>()
    const [modelId, setModelId] = useState('')
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [sending, setSending] = useState(false)
    const [stopping, setStopping] = useState(false)
    const [clearing, setClearing] = useState(false)
    const [error, setError] = useState<string>()
    const [toolActivity, setToolActivity] = useState<ChatToolActivity>()
    const [recoveryMessageId, setRecoveryMessageId] = useState<string>()
    const streamGeneration = useRef(0)
    const activeStream = useRef<ActiveChatStream>()
    const currentLibraryId = useRef(libraryId)
    currentLibraryId.current = libraryId
    const timelineRef = useRef<HTMLDivElement>(null)
    const choices = useMemo(
      () => system?.llm === undefined ? [] : llmModelChoices(system.llm).filter(choice => choice.apiKeyConfigured),
      [system],
    )
    const messages = snapshot?.messages ?? []
    const generating = sending || messages.some(message => message.state === 'generating')

    useEffect(() => {
      streamGeneration.current += 1
      activeStream.current?.controller.abort()
      activeStream.current = undefined
      setSending(false)
      setStopping(false)
      setToolActivity(undefined)
      setRecoveryMessageId(undefined)
      if (libraryId === undefined) {
        setOpen(false)
        return
      }
      const controller = new AbortController()
      setLoading(true)
      setError(undefined)
      setSnapshot(undefined)
      void Promise.all([
        ctx.connection.libraryChatSnapshot(libraryId, controller.signal),
        ctx.connection.system(controller.signal),
      ]).then(([nextSnapshot, nextSystem]) => {
        setSnapshot(nextSnapshot)
        setSystem(nextSystem)
        const nextChoices = nextSystem.llm === undefined
          ? []
          : llmModelChoices(nextSystem.llm).filter(choice => choice.apiKeyConfigured)
        setModelId(preferredChatModel(nextSystem, nextChoices, selectedModels.get(libraryId)))
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason, '问答记录加载失败'))
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
      return () => {
        controller.abort()
        activeStream.current?.controller.abort()
      }
    }, [libraryId])

    useEffect(() => {
      if (!open) return
      const timeline = timelineRef.current
      if (timeline !== null) timeline.scrollTop = timeline.scrollHeight
    }, [messages, open])

    useEffect(() => {
      if (!generating || libraryId === undefined || recoveryMessageId === undefined) return
      let disposed = false
      let checking = false
      const checkPersistedState = async (): Promise<void> => {
        if (disposed || checking) return
        checking = true
        const identity = activeStream.current
        if (identity === undefined || identity.assistantMessageId !== recoveryMessageId) {
          checking = false
          return
        }
        try {
          const next = await ctx.connection.libraryChatSnapshot(libraryId)
          if (
            disposed
            || !canApplyChatReconciliation(activeStream.current, identity, currentLibraryId.current, next)
            || !hasExpectedTerminalMessage(next, recoveryMessageId)
          ) return
          setSnapshot(next)
          activeStream.current?.controller.abort()
          activeStream.current = undefined
          setSending(false)
          setStopping(false)
          setToolActivity(undefined)
          setRecoveryMessageId(undefined)
        } catch {
          // The active SSE request remains authoritative while status polling is unavailable.
        } finally {
          checking = false
        }
      }
      void checkPersistedState()
      const timer = window.setInterval(() => void checkPersistedState(), 750)
      return () => {
        disposed = true
        window.clearInterval(timer)
      }
    }, [generating, libraryId, recoveryMessageId])

    if (libraryId === undefined) return null

    const chooseModel = (nextModelId: string): void => {
      setModelId(nextModelId)
      selectedModels.set(libraryId, nextModelId)
    }

    const sendMessage = async (): Promise<void> => {
      const content = input.trim()
      if (content.length === 0 || generating || modelId.length === 0) return
      const controller = new AbortController()
      const identity: ActiveChatStream = {
        controller,
        generation: ++streamGeneration.current,
        libraryId,
      }
      activeStream.current = identity
      selectedModels.set(libraryId, modelId)
      setInput('')
      setSending(true)
      setError(undefined)
      setToolActivity(undefined)
      setRecoveryMessageId(undefined)
      const sendInput = createChatSendInput(content, modelId, contextDocumentId)
      let terminalReceived = false
      let failure: unknown
      let reconciledTerminal = false
      let reconciliationFailed = false
      try {
        for await (const event of ctx.connection.sendLibraryChatMessage(libraryId, sendInput, controller.signal)) {
          if (!isCurrentChatGeneration(activeStream.current, identity, currentLibraryId.current)) continue
          if (event.type === 'started') {
            identity.assistantMessageId = event.assistantMessage.id
            setRecoveryMessageId(event.assistantMessage.id)
          }
          if (event.type === 'completed' || event.type === 'cancelled' || event.type === 'error') {
            terminalReceived = true
            setSending(false)
            setStopping(false)
          }
          setToolActivity(value => applyChatToolEvent(value, event))
          setSnapshot(value => {
            if (!isCurrentChatGeneration(activeStream.current, identity, currentLibraryId.current)) return value
            if (value !== undefined && value.libraryId !== libraryId) return value
            return applyChatSnapshotEvent(value, libraryId, event)
          })
        }
      } catch (reason) {
        failure = reason
      }
      if (
        !controller.signal.aborted
        && identity.assistantMessageId !== undefined
        && isCurrentChatGeneration(activeStream.current, identity, currentLibraryId.current)
      ) {
        try {
          const persisted = await ctx.connection.libraryChatSnapshot(libraryId)
          if (canApplyChatReconciliation(activeStream.current, identity, currentLibraryId.current, persisted)) {
            reconciledTerminal = hasExpectedTerminalMessage(persisted, identity.assistantMessageId)
            if (shouldApplyPersistedChatSnapshot(persisted, identity.assistantMessageId, terminalReceived)) {
              setSnapshot(persisted)
            }
          }
        } catch {
          reconciliationFailed = true
        }
      }
      if (
        failure !== undefined
        && !controller.signal.aborted
        && isCurrentChatGeneration(activeStream.current, identity, currentLibraryId.current)
        && (
          identity.assistantMessageId === undefined
          || (!terminalReceived && reconciliationFailed)
        )
      ) {
        setError(errorMessage(failure, '回答生成失败'))
      }
      if (isCurrentChatGeneration(activeStream.current, identity, currentLibraryId.current)) {
        if (terminalReceived || reconciledTerminal || identity.assistantMessageId === undefined) {
          activeStream.current = undefined
          setRecoveryMessageId(undefined)
        }
        setSending(false)
        setStopping(false)
        setToolActivity(undefined)
      }
    }

    const stopGeneration = async (): Promise<void> => {
      if (!generating || stopping) return
      setStopping(true)
      setError(undefined)
      try {
        const result = await ctx.connection.cancelLibraryChat(libraryId)
        if (currentLibraryId.current === libraryId) {
          setToolActivity(undefined)
          if (result.message !== undefined) {
            setSnapshot(value => value === undefined ? value : {
              ...value,
              messages: value.libraryId === libraryId
                ? value.messages.map(message => message.id === result.message?.id ? result.message : message)
                : value.messages,
            })
          }
        }
      } catch (reason) {
        if (currentLibraryId.current === libraryId) {
          setError(errorMessage(reason, '停止生成失败'))
          setStopping(false)
        }
      }
    }

    const clearChat = async (): Promise<void> => {
      if (clearing || generating || !window.confirm('确认清空当前知识库的全部问答记录？此操作无法撤销。')) return
      setClearing(true)
      setError(undefined)
      try {
        const next = await ctx.connection.clearLibraryChat(libraryId)
        if (currentLibraryId.current === libraryId) setSnapshot(next)
      } catch (reason) {
        if (currentLibraryId.current === libraryId) setError(errorMessage(reason, '清空问答失败'))
      } finally {
        if (currentLibraryId.current === libraryId) setClearing(false)
      }
    }

    const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
      event.preventDefault()
      void sendMessage()
    }

    return (
      <div className={`library-chat-overlay ${open ? 'open' : ''}`}>
        {open && (
          <aside className="library-chat-drawer" aria-label="知识库问答面板">
            <header className="library-chat-header">
              <div><span>当前知识库</span><strong><Bot size={17} />知识库问答</strong></div>
              <div>
                <button type="button" title="清空问答" aria-label="清空问答" disabled={clearing || generating || messages.length === 0} onClick={() => void clearChat()}><Trash2 size={16} /></button>
                <button type="button" title="关闭问答" aria-label="关闭问答" onClick={() => setOpen(false)}><X size={18} /></button>
              </div>
            </header>

            <div className="library-chat-timeline" ref={timelineRef} aria-live="polite">
              {loading ? (
                <div className="library-chat-empty">正在读取问答记录...</div>
              ) : messages.length === 0 ? (
                <div className="library-chat-empty"><MessageCircle size={27} /><strong>基于当前知识库提问</strong><span>回答会引用已索引的知识条目，并提供可跳转的来源。</span></div>
              ) : messages.map(message => (
                <article className={`library-chat-message ${message.role}`} key={message.id}>
                  <div className="library-chat-bubble">
                    {message.content.length > 0
                      ? message.role === 'assistant' ? <ChatMarkdown content={message.content} /> : message.content
                      : message.state === 'generating' ? '正在思考…' : '未生成内容'}
                  </div>
                  {message.role === 'assistant' && message.sources.length > 0 && (
                    <div className="library-chat-sources">
                      <span>来源</span>
                      {message.sources.map((source, index) => (
                        <button
                          type="button"
                          key={`${message.id}-${source.documentId}-${source.location}-${index}`}
                          onClick={() => ctx.clientApp.selectPage('documents', { libraryId: source.libraryId, documentId: source.documentId, location: source.location })}
                        >
                          [{source.citationNumber ?? index + 1}] {source.title} · {source.location}
                        </button>
                      ))}
                    </div>
                  )}
                  {message.state === 'cancelled' && <small>已停止生成</small>}
                  {message.state === 'failed' && <small className="library-chat-failed">{message.error ?? '生成失败'}</small>}
                </article>
              ))}
            </div>

            {error !== undefined && <div className="library-chat-error" role="alert">{error}</div>}
            <footer className="library-chat-composer">
              <div className={`library-chat-context ${contextDocumentId === undefined ? 'empty' : 'linked'}`}>
                {contextDocumentId === undefined ? '总结当前文章需先选择一篇文章' : '已关联当前文章'}
              </div>
              {toolActivity !== undefined && (
                <div className="library-chat-tool-status" role="status">
                  <strong>{chatTaskLabel(toolActivity.task)}</strong>
                  <span>
                    {toolActivity.message ?? '正在处理'}
                    {toolActivity.completed !== undefined && toolActivity.total !== undefined
                      ? ` · ${toolActivity.completed}/${toolActivity.total}`
                      : ''}
                  </span>
                </div>
              )}
              <label>
                <span className="visually-hidden">回答模型</span>
                <select aria-label="回答模型" value={modelId} disabled={generating || choices.length === 0} onChange={event => chooseModel(event.target.value)}>
                  {choices.length === 0 ? <option value="">尚未配置可用模型</option> : choices.map(choice => <option value={choice.id} key={choice.id}>{choice.label}</option>)}
                </select>
              </label>
              <details className="library-chat-command-hint">
                <summary>快捷命令：/检索 · /总结当前文章 · /总结文章 · /总结知识库</summary>
                <span>/总结文章 标题 -- 关注点（关注点可省略）</span>
              </details>
              <div>
                <textarea aria-label="输入问题" rows={2} maxLength={4000} value={input} disabled={generating || choices.length === 0} placeholder="询问当前知识库，Enter 发送…" onChange={event => setInput(event.target.value)} onKeyDown={handleInputKeyDown} />
                {generating
                  ? <button className="library-chat-stop" type="button" disabled={stopping} onClick={() => void stopGeneration()}><Square size={14} fill="currentColor" />{stopping ? '停止中' : '停止'}</button>
                  : <button className="library-chat-send" type="button" aria-label="发送问题" disabled={input.trim().length === 0 || modelId.length === 0} onClick={() => void sendMessage()}><Send size={16} /></button>}
              </div>
              <small>回答仅基于检索到的本地知识内容，请核对引用来源。</small>
            </footer>
          </aside>
        )}
        <button className="library-chat-trigger" type="button" aria-label={open ? '关闭知识库问答' : '打开知识库问答'} aria-expanded={open} onClick={() => setOpen(value => !value)}>
          {open ? <X size={19} /> : <MessageCircle size={19} />}
          <span>{open ? '收起' : '问答'}</span>
        </button>
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerAppOverlay({
    component: LibraryChatOverlay,
    id: 'library-chat',
    order: 20,
  }), 'library-chat: app overlay')
}
