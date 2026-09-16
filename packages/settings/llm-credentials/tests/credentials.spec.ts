import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import LlmCredentials from '../src/index.ts'

const originalEnvironmentKey = process.env.TIGGYKNOWLEDGE_LLM_API_KEY

afterEach(() => {
  if (originalEnvironmentKey === undefined) delete process.env.TIGGYKNOWLEDGE_LLM_API_KEY
  else process.env.TIGGYKNOWLEDGE_LLM_API_KEY = originalEnvironmentKey
})

describe('LLM credentials', () => {
  it('stores only encrypted key material and decrypts it through the platform codec', async () => {
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
      expect(ctx.llmCredentials.setApiKey(apiKey)).toMatchObject({ configured: true })
      expect(ctx.llmCredentials.getApiKey()).toBe(apiKey)
      expect(ctx.llmCredentials.snapshot()).toEqual({ configured: true, preview: 'sk-tes…alue' })

      const stored = readFileSync(join(dataDir, 'llm-credentials.json'), 'utf8')
      expect(stored).not.toContain(apiKey)
      expect(JSON.parse(stored)).toMatchObject({ preview: 'sk-tes…alue' })
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
      expect(ctx.llmCredentials.getApiKey()).toBe('sk-environment-secret')
      expect(ctx.llmCredentials.snapshot()).toEqual({ configured: true, preview: 'sk-env…cret' })
      expect(() => ctx.llmCredentials.setApiKey('sk-another-secret')).toThrow('不支持安全保存')
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
