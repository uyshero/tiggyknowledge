import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LEGACY_LLM_MODEL_ID, LEGACY_LLM_PROVIDER_ID } from '@tiggyknowledge/contracts'
import { dump } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import FileSettings from '../src/index.ts'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('LLM integration settings', () => {
  it('keeps MinerU disabled by default and stores only non-secret options', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-settings-mineru-'))
    directories.push(dataDir)
    const filename = join(dataDir, 'settings.yaml')
    const ctx = new Context()
    try {
      await ctx.plugin(FileSettings, { path: filename })
      expect(ctx.settings.mineru()).toMatchObject({
        enabled: false,
        baseUrl: 'https://mineru.net',
        modelVersion: 'vlm',
        language: 'ch',
        apiKeyConfigured: false,
      })
      ctx.settings.updateMineru({ enabled: true, modelVersion: 'pipeline', enableTable: false })
      expect(ctx.settings.mineru(() => ({ configured: true, preview: 'sk-min…test' }))).toMatchObject({
        enabled: true,
        modelVersion: 'pipeline',
        enableTable: false,
        apiKeyConfigured: true,
        apiKeyPreview: 'sk-min…test',
      })
      expect(readFileSync(filename, 'utf8')).not.toContain('sk-min')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('migrates a legacy single-model configuration into a default provider', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-settings-legacy-'))
    directories.push(dataDir)
    writeFileSync(join(dataDir, 'settings.yaml'), dump({
      llmIntegration: {
        enabled: true,
        baseUrl: 'https://llm.example/v1/',
        model: 'legacy-model',
        requestTimeoutMs: 90_000,
        maxInputTokens: 16_000,
        maxOutputTokens: 2_000,
      },
    }))
    const ctx = new Context()
    try {
      await ctx.plugin(FileSettings, { path: join(dataDir, 'settings.yaml') })
      expect(ctx.settings.llmIntegration(id => ({ configured: id === LEGACY_LLM_PROVIDER_ID, preview: 'sk-leg…key' }))).toMatchObject({
        providers: [{
          id: LEGACY_LLM_PROVIDER_ID,
          name: '默认提供方',
          baseUrl: 'https://llm.example/v1',
          requestTimeoutMs: 90_000,
          maxInputTokens: 16_000,
          maxOutputTokens: 2_000,
          models: [{ id: LEGACY_LLM_MODEL_ID, name: 'legacy-model', model: 'legacy-model' }],
          apiKeyConfigured: true,
          apiKeyPreview: 'sk-leg…key',
        }],
        preferredModelId: LEGACY_LLM_MODEL_ID,
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('stores multiple providers and defaults wiki generation to the preferred model', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-settings-multi-'))
    directories.push(dataDir)
    const ctx = new Context()
    try {
      await ctx.plugin(FileSettings, { path: join(dataDir, 'settings.yaml') })
      ctx.settings.updateLlmIntegration({
        providers: [{
          id: 'openai-main',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          models: [
            { id: 'gpt-mini', name: 'GPT Mini', model: 'gpt-4.1-mini' },
            { id: 'gpt-full', model: 'gpt-4.1' },
          ],
        }, {
          id: 'local-qwen',
          name: '本地 Qwen',
          baseUrl: 'http://127.0.0.1:11434/v1',
          models: [{ id: 'qwen-plus', model: 'qwen-plus' }],
        }],
        preferredModelId: 'gpt-mini',
      })
      const settings = ctx.settings.llmIntegration(id => ({ configured: id === 'openai-main' }))
      expect(settings.preferredModelId).toBe('gpt-mini')
      expect(settings.wikiModelId).toBeUndefined()
      expect(settings.transcriptionModelId).toBeUndefined()
      expect(settings.providers).toHaveLength(2)
      expect(settings.providers[1]?.models[0]).toMatchObject({ id: 'qwen-plus', name: 'qwen-plus', model: 'qwen-plus' })

      ctx.settings.updateLlmIntegration({ wikiModelId: 'qwen-plus' })
      expect(ctx.settings.llmIntegration().wikiModelId).toBe('qwen-plus')
      ctx.settings.updateLlmIntegration({ wikiModelId: 'gpt-mini' })
      expect(ctx.settings.llmIntegration().wikiModelId).toBeUndefined()
      ctx.settings.updateLlmIntegration({ transcriptionModelId: 'qwen-plus' })
      expect(ctx.settings.llmIntegration().transcriptionModelId).toBe('qwen-plus')
      ctx.settings.updateLlmIntegration({ transcriptionModelId: 'gpt-mini' })
      expect(ctx.settings.llmIntegration().transcriptionModelId).toBe('gpt-mini')
      ctx.settings.updateLlmIntegration({ transcriptionModelId: null })
      expect(ctx.settings.llmIntegration().transcriptionModelId).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
