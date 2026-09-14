import { Context, Service } from '@deepseek-ai/cordis'
import type { KnowledgeSearchMode, SemanticCapabilityProvider, SemanticCapabilitySnapshot } from '@tiggyknowledge/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeSemanticCapabilities: KnowledgeSemanticCapabilities
  }
}

export interface RegisterSemanticProviderInput {
  id: string
  label: string
  description?: string
  model?: string
  dimensions?: number
  modes: Exclude<KnowledgeSearchMode, 'auto' | 'keyword'>[]
}

function normalizeProvider(input: RegisterSemanticProviderInput): SemanticCapabilityProvider {
  const id = input.id.trim()
  const label = input.label.trim()
  const modes = [...new Set(input.modes)]
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(id)) throw new RangeError('语义检索 Provider ID 无效')
  if (label.length === 0 || label.length > 80) throw new RangeError('语义检索 Provider 名称长度应为 1 到 80 个字符')
  if (modes.length === 0 || modes.some(mode => mode !== 'semantic' && mode !== 'hybrid')) throw new RangeError('语义检索 Provider 模式无效')
  if (input.dimensions !== undefined && (!Number.isInteger(input.dimensions) || input.dimensions < 1)) throw new RangeError('语义向量维度必须是正整数')
  return {
    id,
    label,
    modes,
    status: 'active',
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.dimensions === undefined ? {} : { dimensions: input.dimensions }),
  }
}

export class KnowledgeSemanticCapabilities extends Service {
  private readonly providers = new Map<string, SemanticCapabilityProvider>()

  constructor(ctx: Context) {
    super(ctx, 'knowledgeSemanticCapabilities')
  }

  registerProvider(input: RegisterSemanticProviderInput): () => void {
    const provider = normalizeProvider(input)
    if (this.providers.has(provider.id)) throw new Error(`semantic-capabilities: duplicate provider ${provider.id}`)
    this.providers.set(provider.id, provider)
    return () => this.providers.delete(provider.id)
  }

  snapshot(): SemanticCapabilitySnapshot {
    const providers = [...this.providers.values()].sort((left, right) => left.label.localeCompare(right.label))
    const semanticModes = new Set<Exclude<KnowledgeSearchMode, 'auto' | 'keyword'>>()
    for (const provider of providers) {
      if (provider.status !== 'active') continue
      for (const mode of provider.modes) semanticModes.add(mode)
    }
    const enabledModes: KnowledgeSearchMode[] = ['keyword', ...semanticModes]
    return {
      keyword: {
        provider: 'SQLite FTS5',
        status: 'active',
        modes: ['keyword'],
      },
      semantic: {
        status: providers.some(provider => provider.status === 'active') ? 'available' : 'not-configured',
        modes: [...semanticModes],
        providers,
        message: providers.length === 0 ? '尚未安装语义检索 Provider；当前使用本地关键词索引。' : '语义检索 Provider 已注册。',
      },
      enabledModes,
    }
  }

  hasSemanticSearch(): boolean {
    return this.snapshot().semantic.status === 'available'
  }
}

export default KnowledgeSemanticCapabilities
