import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import HttpRouter, { HttpError } from '@tiggyknowledge/http-router'
import { describe, expect, it } from 'vitest'
import ExternalPlugins from '../src/index.ts'
import { sharedModuleSource } from '../src/shims.ts'

async function listen(ctx: Context): Promise<{ baseUrl: string, close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    void ctx.httpRouter.dispatch(request, response, url).then(handled => {
      if (!handled) {
        response.writeHead(404)
        response.end()
      }
    }).catch((error: unknown) => {
      if (error instanceof HttpError) {
        response.writeHead(error.status, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: error.code, message: error.message }))
        return
      }
      response.writeHead(500)
      response.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))),
  }
}

describe('external plugin client serving', () => {
  it('serves shared shims and discovered client modules', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'tiggyknowledge-ext-serve-'))
    const directory = join(dataRoot, 'plugins', 'sample')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'client.js'), 'export const ok = true\n')
    const ctx = new Context()
    ctx.provide('externalPluginRegistry', [{
      id: 'acme-sample',
      packageName: '@acme/tiggyknowledge-sample',
      directory,
      hostEntry: join(directory, 'host.js'),
      clientFile: join(directory, 'client.js'),
      config: {},
    }])

    let server: Awaited<ReturnType<typeof listen>> | undefined
    try {
      await ctx.plugin(HttpRouter)
      await ctx.plugin(ExternalPlugins)
      server = await listen(ctx)

      const shim = await fetch(`${server.baseUrl}/ext/shared/react.js`)
      expect(shim.status).toBe(200)
      expect(await shim.text()).toBe(sharedModuleSource('react.js'))
      expect(shim.headers.get('content-type')).toMatch(/javascript/)

      const missingShim = await fetch(`${server.baseUrl}/ext/shared/unknown.js`)
      expect(missingShim.status).toBe(404)

      const client = await fetch(`${server.baseUrl}/ext/plugins/acme-sample/client.js`)
      expect(client.status).toBe(200)
      expect(await client.text()).toBe('export const ok = true\n')

      const missingClient = await fetch(`${server.baseUrl}/ext/plugins/missing/client.js`)
      expect(missingClient.status).toBe(404)
    } finally {
      await server?.close()
      await ctx.fiber.dispose()
      rmSync(dataRoot, { recursive: true, force: true })
    }
  })
})
