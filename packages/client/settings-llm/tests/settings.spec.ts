import { describe, expect, it } from 'vitest'
import type { LlmIntegrationSettings, SystemSnapshot } from '@tiggyknowledge/contracts'
import { applyLlmSettingsSnapshot } from '../src/index.tsx'

describe('LLM settings panel state', () => {
  it('publishes saved settings to both the live system field and settings snapshot', () => {
    const previous: LlmIntegrationSettings = {
      enabled: false,
      baseUrl: 'https://old.example/v1',
      model: 'old-model',
      requestTimeoutMs: 60_000,
      maxInputTokens: 10_000,
      maxOutputTokens: 1_000,
      apiKeyConfigured: false,
    }
    const next: LlmIntegrationSettings = {
      ...previous,
      enabled: true,
      model: 'new-model',
      apiKeyConfigured: true,
      apiKeyPreview: 'sk-new…test',
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
