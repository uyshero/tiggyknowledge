import type { KnowledgeDocument } from '@tiggyknowledge/contracts'
import { describe, expect, it } from 'vitest'
import {
  isSafeDirectChat,
  LibraryChatRouteClarification,
  parseLibraryChatRoute,
  routeLibraryChatMessage,
} from '../src/router.ts'

function document(id: string, title: string, originalName = `${id}.md`): KnowledgeDocument {
  return {
    id,
    libraryId: 'library-a',
    title,
    originalName,
    sourceType: 'markdown',
    sourceAssetId: `asset-${id}`,
    contentHash: `hash-${id}`,
    sizeBytes: 100,
    indexStatus: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const documents = [
  document('annual', '年度报告 2026', 'annual-2026.md'),
  document('product', '产品路线图', 'roadmap.md'),
]

describe('deterministic library chat router', () => {
  it('allows only conservative greeting and assistant-meta direct chat', () => {
    for (const content of ['你好', '您好！', 'hello', 'Hi', '谢谢你', '你是谁？', '你能做什么', '怎么使用问答']) {
      expect(isSafeDirectChat(content), content).toBe(true)
    }
    for (const content of [
      '你好，报告说了什么？',
      '报告中的行业 Skills 数量是多少？',
      '文档里有什么',
      '总结文章',
      '知识库有多少文档',
      '谁提出了这个观点',
      '为什么收入下降',
      '什么是行业 Skills',
    ]) {
      expect(isSafeDirectChat(content), content).toBe(false)
    }
  })

  it('exposes whether routing is forced and where it came from', () => {
    expect(parseLibraryChatRoute({ content: '普通知识问题', documents })).toEqual({
      source: 'fallback',
      forced: false,
    })
    expect(parseLibraryChatRoute({ content: '/检索 缓存', documents })).toMatchObject({
      source: 'command',
      forced: true,
      route: { toolName: 'search_knowledge' },
    })
    expect(parseLibraryChatRoute({
      content: '普通知识问题',
      taskOverride: 'summarize-library',
      documents,
    })).toMatchObject({
      source: 'task-override',
      forced: true,
      route: { toolName: 'summarize_library' },
    })
  })

  it('uses task override before explicit commands while extracting safe arguments', () => {
    expect(routeLibraryChatMessage({
      content: '/检索 产品路线',
      taskOverride: 'summarize-library',
      documents,
    })).toEqual({
      task: 'summarize-library',
      toolName: 'summarize_library',
      args: { focus: '产品路线' },
    })
  })

  it('routes Chinese and English slash commands with named focus separator', () => {
    expect(routeLibraryChatMessage({ content: '/检索 缓存策略', documents })).toMatchObject({
      task: 'retrieval',
      args: { query: '缓存策略' },
    })
    expect(routeLibraryChatMessage({ content: '/summarize-current 关键结论', documents })).toMatchObject({
      task: 'summarize-current-document',
      args: { focus: '关键结论' },
    })
    expect(routeLibraryChatMessage({ content: '/总结文章 年度报告 2026 -- 风险', documents })).toEqual({
      task: 'summarize-named-document',
      toolName: 'summarize_named_document',
      args: { title: '年度报告 2026', focus: '风险' },
    })
    expect(routeLibraryChatMessage({ content: '/summarize-library 收入', documents })).toMatchObject({
      task: 'summarize-library',
      args: { focus: '收入' },
    })
  })

  it('routes all-document language to the whole library before current scope', () => {
    expect(routeLibraryChatMessage({
      content: '请总结整个知识库的所有文章，并与当前文档比较',
      contextDocumentId: 'annual',
      documents,
    }).task).toBe('summarize-library')
    expect(routeLibraryChatMessage({
      content: '总结这个知识库',
      documents,
    }).task).toBe('summarize-library')
  })

  it('routes current wording and context fallback to the current document', () => {
    expect(routeLibraryChatMessage({ content: '梳理本文重点', documents }).task).toBe('summarize-current-document')
    expect(routeLibraryChatMessage({
      content: '概括主要观点',
      contextDocumentId: 'annual',
      documents,
    }).task).toBe('summarize-current-document')
  })

  it('uses the unique longest ready title contained in natural language', () => {
    expect(routeLibraryChatMessage({
      content: '请总结年度报告 2026，关注现金流',
      documents,
    })).toMatchObject({
      task: 'summarize-named-document',
      args: { title: '年度报告 2026', focus: '现金流' },
    })
  })

  it('leaves ambiguous named candidates to the existing tool clarification', () => {
    const ambiguous = [
      document('a', '年度报告 2025'),
      document('b', '年度报告 2026'),
    ]
    expect(routeLibraryChatMessage({
      content: '总结年度报告',
      documents: ambiguous,
    })).toMatchObject({
      task: 'summarize-named-document',
      args: { title: '年度报告' },
    })
  })

  it('defaults non-summary language to retrieval using the original question', () => {
    expect(routeLibraryChatMessage({
      content: '中国电信开发了多少个行业 Skills？',
      documents,
    })).toEqual({
      task: 'retrieval',
      toolName: 'search_knowledge',
      args: { query: '中国电信开发了多少个行业 Skills？' },
    })
  })

  it('deterministically requests a title when forced named routing cannot extract one', () => {
    expect(() => routeLibraryChatMessage({
      content: '总结一下',
      taskOverride: 'summarize-named-document',
      documents,
    })).toThrow(LibraryChatRouteClarification)
  })
})
