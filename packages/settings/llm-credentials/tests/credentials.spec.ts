import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LEGACY_LLM_PROVIDER_ID } from '@tiggyknowledge/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import LlmCredentials from '../src/index.ts'

const originalEnvironmentKey = process.env.TIGGYKNOWLEDGE_LLM_API_KEY

afterEach(() => {
  if (originalEnvironmentKey === undefined) delete process.env.TIGGYKNOWLEDGE_LLM_API_KEY
  else process.env.TIGGYKNOWLEDGE_LLM_API_KEY = originalEnvironmentKey
})

describe('LLM credentials', () => {
  it('stores only encrypted key material per provider and decrypts it through the platform codec', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-llm-credentials-'))
    const ctx = new Context()
    delete process.env.TIGGYKNOWLEDGE_LLM_API_KEY
    ctx.provide('secretCodec', {
      encrypt: value => Buffer.from(value, 'utf8').toString('base64'),
      decrypt: value => Buffer.from(value, 'base64').toString('utf8'),
    })
    try {
      await ctx.plugin(LlmCredentials, { dataDir })
      const apiKey = 'sk-test-super-secret-value'
      expect(ctx.llmCredentials.setApiKey('openai-main', apiKey)).toMatchObject({ configured: true })
      expect(ctx.llmCredentials.getApiKey('openai-main')).toBe(apiKey)
      expect(ctx.llmCredentials.status('openai-main')).toEqual({ configured: true, preview: 'sk-tes…alue' })
      expect(ctx.llmCredentials.status('other-provider')).toEqual({ configured: false })
      expect(ctx.llmCredentials.snapshot()).toMatchObject({
        environmentConfigured: false,
        providers: { 'openai-main': { configured: true, preview: 'sk-tes…alue' } },
      })

      const stored = readFileSync(join(dataDir, 'llm-credentials.json'), 'utf8')
      expect(stored).not.toContain(apiKey)
      expect(JSON.parse(stored)).toMatchObject({
        providers: { 'openai-main': { preview: 'sk-tes…alue' } },
      })
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('uses the environment key without requiring a desktop encryption codec', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-llm-environment-'))
    const ctx = new Context()
    process.env.TIGGYKNOWLEDGE_LLM_API_KEY = 'sk-environment-secret'
    try {
      await ctx.plugin(LlmCredentials, { dataDir })
      expect(ctx.llmCredentials.getApiKey('any-provider')).toBe('sk-environment-secret')
      expect(ctx.llmCredentials.status('any-provider')).toEqual({ configured: true, preview: 'sk-env…cret' })
      expect(ctx.llmCredentials.snapshot()).toMatchObject({
        environmentConfigured: true,
        environmentPreview: 'sk-env…cret',
      })
      expect(() => ctx.llmCredentials.setApiKey('any-provider', 'sk-another-secret')).toThrow('不支持安全保存')
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('reads a legacy single-key file as the migrated default provider', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-llm-legacy-'))
    const ctx = new Context()
    delete process.env.TIGGYKNOWLEDGE_LLM_API_KEY
    writeFileSync(join(dataDir, 'llm-credentials.json'), `${JSON.stringify({
      encryptedApiKey: Buffer.from('sk-legacy-secret-key', 'utf8').toString('base64'),
      preview: 'sk-leg…-key',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })}\n`)
    ctx.provide('secretCodec', {
      encrypt: value => Buffer.from(value, 'utf8').toString('base64'),
      decrypt: value => Buffer.from(value, 'base64').toString('utf8'),
    })
    try {
      await ctx.plugin(LlmCredentials, { dataDir })
      expect(ctx.llmCredentials.getApiKey(LEGACY_LLM_PROVIDER_ID)).toBe('sk-legacy-secret-key')
      expect(ctx.llmCredentials.status(LEGACY_LLM_PROVIDER_ID)).toEqual({ configured: true, preview: 'sk-leg…-key' })
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
