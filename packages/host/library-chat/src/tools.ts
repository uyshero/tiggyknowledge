import type { LibraryChatTask } from '@tiggyknowledge/contracts'
import type { ToolCall, ToolSchema } from '@tiggyknowledge/llm-client'

export const TOOL_NAMES = [
  'search_knowledge',
  'summarize_current_document',
  'summarize_named_document',
  'summarize_library',
] as const

export type LibraryToolName = typeof TOOL_NAMES[number]

export type LibraryToolArguments =
  | { name: 'search_knowledge', query: string }
  | { name: 'summarize_current_document', focus?: string }
  | { name: 'summarize_named_document', title: string, focus?: string }
  | { name: 'summarize_library', focus?: string }

export const MAX_SEARCH_QUERY_CHARACTERS = 200
export const MAX_SEARCH_QUERY_TERMS = 16

export const LIBRARY_CHAT_TOOLS: ToolSchema[] = [{
  type: 'function',
  function: {
    name: 'search_knowledge',
    description: '在当前知识库中按关键词检索证据。query 应只包含 1-3 个最有区分度的关键词或短语（优先专有名词、英文、数字），不要复制用户的完整问句。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: { query: { type: 'string', minLength: 1, maxLength: MAX_SEARCH_QUERY_CHARACTERS } },
    },
  },
}, {
  type: 'function',
  function: {
    name: 'summarize_current_document',
    description: '总结用户界面中当前选中的文档。仅在存在当前文档上下文时使用。',
    parameters: focusParameters(),
  },
}, {
  type: 'function',
  function: {
    name: 'summarize_named_document',
    description: '按标题或原文件名查找并总结当前知识库中的文档。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['title'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 500 },
        focus: { type: 'string', minLength: 1, maxLength: 2_000 },
      },
    },
  },
}, {
  type: 'function',
  function: {
    name: 'summarize_library',
    description: '总结当前知识库内全部已就绪文档。',
    parameters: focusParameters(),
  },
}]

export function parseToolCall(call: ToolCall): LibraryToolArguments {
  if (!isToolName(call.function.name)) throw new Error(`模型选择了未知工具：${call.function.name || '(空名称)'}`)
  let raw: unknown
  try {
    raw = JSON.parse(call.function.arguments)
  } catch {
    throw new Error(`工具 ${call.function.name} 的 arguments 不是有效 JSON`)
  }
  const input = objectValue(raw, call.function.name)
  rejectUnknownKeys(input, call.function.name === 'search_knowledge'
    ? ['query']
    : call.function.name === 'summarize_named_document' ? ['title', 'focus'] : ['focus'])
  if (call.function.name === 'search_knowledge') {
    const query = requiredString(input.query, 'query', MAX_SEARCH_QUERY_CHARACTERS)
    const terms = [...new Set(query.match(/\S+/g) ?? [])]
    if (terms.length > MAX_SEARCH_QUERY_TERMS) {
      throw new Error(`工具参数 query 最多包含 ${MAX_SEARCH_QUERY_TERMS} 个非重复词项`)
    }
    return { name: call.function.name, query: terms.join(' ') }
  }
  if (call.function.name === 'summarize_named_document') {
    const focus = optionalString(input.focus, 'focus', 2_000)
    return {
      name: call.function.name,
      title: requiredString(input.title, 'title', 500),
      ...(focus === undefined ? {} : { focus }),
    }
  }
  const focus = optionalString(input.focus, 'focus', 2_000)
  return { name: call.function.name, ...(focus === undefined ? {} : { focus }) }
}

export function taskForTool(name: LibraryToolName): LibraryChatTask {
  switch (name) {
    case 'search_knowledge': return 'retrieval'
    case 'summarize_current_document': return 'summarize-current-document'
    case 'summarize_named_document': return 'summarize-named-document'
    case 'summarize_library': return 'summarize-library'
  }
}

function isToolName(value: string): value is LibraryToolName {
  return (TOOL_NAMES as readonly string[]).includes(value)
}

function focusParameters(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: { focus: { type: 'string', minLength: 1, maxLength: 2_000 } },
  }
}

function objectValue(value: unknown, tool: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`工具 ${tool} 的 arguments 必须是 JSON 对象`)
  }
  return value as Record<string, unknown>
}

function rejectUnknownKeys(input: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(input).find(key => !allowed.includes(key))
  if (unknown !== undefined) throw new Error(`工具 arguments 包含未知字段：${unknown}`)
}

function requiredString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`工具参数 ${field} 必须是 1 到 ${maximum} 个字符的字符串`)
  }
  return value.trim()
}

function optionalString(value: unknown, field: string, maximum: number): string | undefined {
  return value === undefined ? undefined : requiredString(value, field, maximum)
}
