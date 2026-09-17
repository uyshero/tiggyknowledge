import { describe, expect, it } from 'vitest'
import type { LlmIntegrationSettings, SystemSnapshot } from '@tiggyknowledge/contracts'
import { applyLlmSettingsSnapshot } from '../src/index.tsx'

describe('LLM settings panel state', () => {
  it('publishes saved settings to both the live system field and settings snapshot', () => {
    const previous: LlmIntegrationSettings = {
      providers: [],
    }
    const next: LlmIntegrationSettings = {
      providers: [{
        id: 'openai-main',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        requestTimeoutMs: 120_000,
        maxInputTokens: 32_000,
        maxOutputTokens: 4_096,
        models: [{ id: 'gpt-mini', name: 'GPT Mini', model: 'gpt-4.1-mini' }],
        apiKeyConfigured: true,
        apiKeyPreview: 'sk-new…test',
      }],
      preferredModelId: 'gpt-mini',
    }
    const system = {
      product: 'tiggyknowledge',
      version: 'test',
      llm: previous,
      settings: { path: '/tmp/settings.yaml', values: { llmIntegration: previous } },
    } as SystemSnapshot

    const result = applyLlmSettingsSnapshot(system, next)
    expect(result.llm).toEqual(next)
    expect(result.settings.values.llmIntegration).toEqual(next)
  })
})
