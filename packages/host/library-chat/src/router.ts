import type { KnowledgeDocument, LibraryChatTask, SendLibraryChatMessageInput } from '@tiggyknowledge/contracts'

export type RoutedLibraryChatMessage =
  | { task: 'retrieval', toolName: 'search_knowledge', args: { query: string } }
  | { task: 'summarize-current-document', toolName: 'summarize_current_document', args: { focus?: string } }
  | { task: 'summarize-named-document', toolName: 'summarize_named_document', args: { title: string, focus?: string } }
  | { task: 'summarize-library', toolName: 'summarize_library', args: { focus?: string } }

export interface RouteLibraryChatInput extends SendLibraryChatMessageInput {
  documents: KnowledgeDocument[]
}

export interface ParsedLibraryChatRoute {
  source: 'task-override' | 'command' | 'fallback'
  forced: boolean
  route?: RoutedLibraryChatMessage
}

export class LibraryChatRouteClarification extends Error {
  readonly task: LibraryChatTask

  constructor(task: LibraryChatTask, message: string) {
    super(message)
    this.name = 'LibraryChatRouteClarification'
    this.task = task
  }
}

const TASKS: readonly LibraryChatTask[] = [
  'retrieval',
  'summarize-current-document',
  'summarize-named-document',
  'summarize-library',
]

const COMMAND_TASKS = new Map<string, LibraryChatTask>([
  ['/检索', 'retrieval'],
  ['/search', 'retrieval'],
  ['/总结当前文章', 'summarize-current-document'],
  ['/summarize-current', 'summarize-current-document'],
  ['/总结文章', 'summarize-named-document'],
  ['/summarize-document', 'summarize-named-document'],
  ['/总结知识库', 'summarize-library'],
  ['/summarize-library', 'summarize-library'],
])

const SUMMARY_INTENT = /总结|概括|摘要|梳理/
const LIBRARY_SCOPE = /(?:这个|当前|整个|全部|所有)?知识库|(?:整个|全部|所有).{0,8}(?:库|文章|文档)|(?:库|文章|文档).{0,8}(?:整个|全部|所有)/
const CURRENT_SCOPE = /当前|本文|本篇|这篇|该文档|此文|这份文档/

interface ParsedContent {
  commandTask?: LibraryChatTask
  commandArgument?: string
  commandTitle?: string
  commandFocus?: string
}

export function routeLibraryChatMessage(input: RouteLibraryChatInput): RoutedLibraryChatMessage {
  const content = requiredText(input.content, 'content', 20_000)
  const parsed = parseContent(content)
  const task = input.taskOverride === undefined ? parsed.commandTask ?? naturalTask(content, input) : validatedTask(input.taskOverride)
  return buildRoute(input, content, parsed, task)
}

export function parseLibraryChatRoute(input: RouteLibraryChatInput): ParsedLibraryChatRoute {
  const content = requiredText(input.content, 'content', 20_000)
  const parsed = parseContent(content)
  if (input.taskOverride !== undefined) {
    return {
      source: 'task-override',
      forced: true,
      route: buildRoute(input, content, parsed, validatedTask(input.taskOverride)),
    }
  }
  if (parsed.commandTask !== undefined) {
    return {
      source: 'command',
      forced: true,
      route: buildRoute(input, content, parsed, parsed.commandTask),
    }
  }
  return { source: 'fallback', forced: false }
}

export function isSafeDirectChat(content: string): boolean {
  if (typeof content !== 'string' || content.trim().length === 0 || content.length > 80) return false
  const normalized = content
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s，。！？、,.!?;；:：'"“”‘’（）()]+/g, '')
  return /^(?:你好|您好|hello|hi|嗨|哈喽|早上好|下午好|晚上好|早安|晚安)$/.test(normalized)
    || /^(?:谢谢|谢谢你|感谢|感谢你|多谢|thanks|thankyou)$/.test(normalized)
    || /^(?:你是谁|你是什么助手|介绍一下你自己)$/.test(normalized)
    || /^(?:你能做什么|你会做什么|怎么使用问答|如何使用问答|怎么用问答|如何用问答|使用帮助)$/.test(normalized)
}

function buildRoute(
  input: RouteLibraryChatInput,
  content: string,
  parsed: ParsedContent,
  task: LibraryChatTask,
): RoutedLibraryChatMessage {
  if (task === 'retrieval') {
    const query = parsed.commandTask === undefined ? content : parsed.commandArgument
    return {
      task,
      toolName: 'search_knowledge',
      args: { query: searchQuery(query ?? '') },
    }
  }

  if (task === 'summarize-current-document') {
    const focus = summaryFocus(content, parsed)
    return {
      task,
      toolName: 'summarize_current_document',
      args: focus === undefined ? {} : { focus },
    }
  }

  if (task === 'summarize-library') {
    const focus = summaryFocus(content, parsed)
    return {
      task,
      toolName: 'summarize_library',
      args: focus === undefined ? {} : { focus },
    }
  }

  const focus = summaryFocus(content, parsed)
  const title = parsed.commandTask === undefined
    ? longestUniqueDocumentTitle(content, input.documents) ?? extractNamedDocumentCandidate(content)
    : parsed.commandTitle ?? optionalText(parsed.commandArgument, 500)
  if (title === undefined) {
    throw new LibraryChatRouteClarification(task, '请提供要总结的文章标题，例如：/总结文章 文档标题 -- 关注点')
  }
  return {
    task,
    toolName: 'summarize_named_document',
    args: {
      title: requiredText(title, 'title', 500),
      ...(focus === undefined ? {} : { focus }),
    },
  }
}

function naturalTask(content: string, input: RouteLibraryChatInput): LibraryChatTask {
  if (!SUMMARY_INTENT.test(content)) return 'retrieval'
  if (LIBRARY_SCOPE.test(content)) return 'summarize-library'
  if (CURRENT_SCOPE.test(content)) return 'summarize-current-document'
  if (longestUniqueDocumentTitle(content, input.documents) !== undefined) return 'summarize-named-document'
  if (input.contextDocumentId !== undefined) return 'summarize-current-document'
  return 'summarize-named-document'
}

function parseContent(content: string): ParsedContent {
  const command = /^(\S+)(?:\s+([\s\S]*))?$/.exec(content)
  if (command === null) return {}
  const commandTask = COMMAND_TASKS.get((command[1] ?? '').toLocaleLowerCase())
  if (commandTask === undefined) return {}
  const argument = command[2]?.trim()
  if (commandTask !== 'summarize-named-document') {
    return { commandTask, ...(argument === undefined ? {} : { commandArgument: argument, commandFocus: argument }) }
  }
  const named = splitNamedCommand(argument ?? '')
  return {
    commandTask,
    ...(argument === undefined ? {} : { commandArgument: argument }),
    ...(named.title === undefined ? {} : { commandTitle: named.title }),
    ...(named.focus === undefined ? {} : { commandFocus: named.focus }),
  }
}

function splitNamedCommand(argument: string): { title?: string, focus?: string } {
  const [rawTitle, ...focusParts] = argument.split(/\s+--\s+/)
  const title = optionalText(rawTitle, 500)
  const focus = optionalText(focusParts.join(' -- '), 2_000)
  return {
    ...(title === undefined ? {} : { title }),
    ...(focus === undefined ? {} : { focus }),
  }
}

function summaryFocus(content: string, parsed: ParsedContent): string | undefined {
  if (parsed.commandTask !== undefined) {
    if (parsed.commandTask === 'summarize-named-document') return parsed.commandFocus
    return optionalText(parsed.commandArgument, 2_000)
  }
  const separated = /(?:--|重点(?:是|关注)?|关注(?:点|于)?|聚焦(?:于)?|侧重(?:于)?)[：:\s]*([\s\S]+)$/i.exec(content)?.[1]
  return optionalText(separated, 2_000)
}

function longestUniqueDocumentTitle(content: string, documents: KnowledgeDocument[]): string | undefined {
  const haystack = content.toLocaleLowerCase()
  const matches = new Map<string, { document: KnowledgeDocument, label: string }>()
  for (const document of documents) {
    if (document.indexStatus !== 'ready') continue
    for (const label of [document.title, document.originalName]) {
      const normalized = label.trim().toLocaleLowerCase()
      if (normalized.length > 0 && haystack.includes(normalized)) {
        const current = matches.get(document.id)
        if (current === undefined || label.length > current.label.length) matches.set(document.id, { document, label })
      }
    }
  }
  if (matches.size === 0) return undefined
  const longest = Math.max(...[...matches.values()].map(match => match.label.length))
  const winners = [...matches.values()].filter(match => match.label.length === longest)
  return winners.length === 1 ? winners[0]?.label.trim() : undefined
}

function extractNamedDocumentCandidate(content: string): string | undefined {
  const quoted = /《([^》]{1,500})》|["“]([^"”]{1,500})["”]/.exec(content)
  if (quoted !== null) return optionalText(quoted[1] ?? quoted[2], 500)
  const beforeFocus = content.split(/\s+--\s+|[，,；;]\s*(?:重点|关注|聚焦|侧重)/, 1)[0] ?? ''
  const candidate = beforeFocus
    .replace(/^(?:请|麻烦)?(?:帮我|为我)?(?:总结|概括|摘要|梳理)(?:一下|下)?/u, '')
    .replace(/^(?:这篇|该|指定的?)?(?:文章|文档|报告|文件)[：:\s]*/u, '')
    .replace(/[。！？!?]+$/u, '')
    .trim()
  return optionalText(candidate, 500)
}

function searchQuery(value: string): string {
  const normalized = requiredText(value, 'query', 20_000).replace(/\s+/g, ' ')
  const terms = normalized.split(' ')
  return terms.slice(0, 16).join(' ').slice(0, 200).trim()
}

function optionalText(value: string | undefined, maximum: number): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined
  return value.trim().slice(0, maximum)
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new RangeError(`${field} 必须是 1 到 ${maximum} 个字符的字符串`)
  }
  return value.trim()
}

function validatedTask(value: LibraryChatTask): LibraryChatTask {
  if (!(TASKS as readonly unknown[]).includes(value)) throw new RangeError('taskOverride 无效')
  return value
}

