import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import ClientBootstrap from '@tiggyknowledge/client-bootstrap'
import HttpRouter from '@tiggyknowledge/http-router'
import { contributeSurface, httpFromRange, HttpError } from '../src/index.ts'

describe('plugin surface', () => {
  it('registers routes when the router appears even without client bootstrap', async () => {
    const ctx = new Context()
    try {
      contributeSurface(ctx, {
        snapshot: { id: 'example', contribute: () => ({ example: true }) },
        routes: [{
          id: 'example:ping',
          methods: ['GET'],
          path: '/api/ping',
          handler: ({ json }) => json({ ok: true }),
        }],
        clients: [{
          id: 'client-example',
          moduleName: '@tiggyknowledge/client-example',
          label: 'Example',
          description: 'Example companion',
        }],
      })
      await ctx.plugin(HttpRouter)
      expect(ctx.httpRouter.snapshot()).toEqual({ example: true })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('registers companions when bootstrap appears', async () => {
    const ctx = new Context()
    try {
      contributeSurface(ctx, {
        clients: [{
          id: 'client-example',
          moduleName: '@tiggyknowledge/client-example',
          label: 'Example',
          description: 'Example companion',
        }],
      })
      await ctx.plugin(ClientBootstrap, { plugins: [] })
      expect(ctx.clientBootstrap.manifest().plugins.map(plugin => plugin.id)).toEqual(['client-example'])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('maps missing range errors to 404', () => {
    const error = httpFromRange(new RangeError('知识库不存在'), 'library_not_found', 'invalid_library')
    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({ status: 404, code: 'library_not_found' })
  })
})
