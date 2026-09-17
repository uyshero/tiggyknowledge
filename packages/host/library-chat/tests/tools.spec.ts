import { describe, expect, it } from 'vitest'
import { LIBRARY_CHAT_TOOLS, parseToolCall } from '../src/tools.ts'

describe('library chat tool schemas', () => {
  it('exposes exactly the four native function names', () => {
    expect(LIBRARY_CHAT_TOOLS.map(tool => tool.function.name)).toEqual([
      'search_knowledge',
      'summarize_current_document',
      'summarize_named_document',
      'summarize_library',
    ])
  })

  it('validates JSON arguments and rejects unknown fields', () => {
    expect(() => parseToolCall({
      id: 'call',
      type: 'function',
      function: { name: 'search_knowledge', arguments: '{bad' },
    })).toThrow('有效 JSON')
    expect(() => parseToolCall({
      id: 'call',
      type: 'function',
      function: { name: 'summarize_library', arguments: '{"extra":true}' },
    })).toThrow('未知字段')
    expect(parseToolCall({
      id: 'call',
      type: 'function',
      function: { name: 'summarize_named_document', arguments: '{"title":" 报告 ","focus":"收入"}' },
    })).toEqual({ name: 'summarize_named_document', title: '报告', focus: '收入' })
  })

  it('keeps search queries within the host search contract', () => {
    expect(() => parseToolCall({
      id: 'call',
      type: 'function',
      function: { name: 'search_knowledge', arguments: JSON.stringify({ query: '甲'.repeat(201) }) },
    })).toThrow('200')
    expect(() => parseToolCall({
      id: 'call',
      type: 'function',
      function: {
        name: 'search_knowledge',
        arguments: JSON.stringify({ query: Array.from({ length: 17 }, (_, index) => `词${index}`).join(' ') }),
      },
    })).toThrow('16')
  })
})
