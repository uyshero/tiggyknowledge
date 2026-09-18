import type { AddressInfo } from 'node:net'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, describe, expect, it } from 'vitest'
import HttpRouter, { HttpError } from '@tiggyknowledge/http-router'
import PluginInventory from '../src/index.ts'
import { readProfilePatches, profilePatchPath } from '../src/profile.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async server => await new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })))
})

async function listen(ctx: Context): Promise<string> {
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
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

async function withInventory<T>(run: (ctx: Context, dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = mkdtempSync(join(tmpdir(), 'tiggyknowledge-plugin-toggle-'))
  const ctx = new Context()
  ctx.provide('builtinPluginIds', new Set(['kernel']))
  ctx.provide('dataRoot', dataRoot)
  ctx.provide('externalPluginRegistry', [{
    id: 'acme-sample',
    packageName: '@acme/tiggyknowledge-sample',
    directory: '/tmp/acme-sample',
    hostEntry: '/tmp/acme-sample/host.js',
    config: {},
  }])
  try {
    await ctx.plugin(Loader)
    ctx.loader.builtins.kernel = { apply() {} }
    ctx.loader.builtins.acme = { apply() {} }
    await ctx.loader.root.update([
      { id: 'kernel', name: 'cordis:kernel' },
      { id: 'acme-sample', name: 'cordis:acme' },
    ])
    await ctx.plugin(PluginInventory)
    return await run(ctx, dataRoot)
  } finally {
    await ctx.fiber.dispose()
    rmSync(dataRoot, { recursive: true, force: true })
  }
}

describe('plugin inventory origin', () => {
  it('marks extra host entries as third-party and disableable', async () => {
    const ctx = new Context()
    ctx.provide('builtinPluginIds', new Set(['kernel']))
    ctx.provide('externalPluginRegistry', [{
      id: 'acme-sample',
      packageName: '@acme/tiggyknowledge-sample',
      directory: '/tmp/acme-sample',
      hostEntry: '/tmp/acme-sample/host.js',
      config: {},
    }])
    try {
      await ctx.plugin(Loader)
      ctx.loader.builtins.kernel = { apply() {} }
      ctx.loader.builtins.acme = { apply() {} }
      await ctx.loader.root.update([
        { id: 'kernel', name: 'cordis:kernel' },
        { id: 'acme-sample', name: 'cordis:acme', disabled: true },
      ])
      await ctx.plugin(PluginInventory)
      expect(ctx.pluginInventory.list()).toEqual([
        expect.objectContaining({
          entryId: 'kernel',
          moduleName: 'cordis:kernel',
          origin: 'builtin',
          disableable: false,
          enabled: true,
        }),
        expect.objectContaining({
          entryId: 'acme-sample',
          moduleName: '@acme/tiggyknowledge-sample',
          origin: 'third-party',
          disableable: true,
          enabled: false,
          phase: 'disabled',
        }),
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('plugin inventory toggle', () => {
  it('persists and unloads third-party host entries', async () => {
    await withInventory(async (ctx, dataRoot) => {
      const listed = await ctx.pluginInventory.setEnabled('acme-sample', false)
      expect(listed).toMatchObject({ entryId: 'acme-sample', enabled: false, phase: 'disabled' })
      const entry = [...ctx.loader.entries()].find(item => item.id === 'acme-sample')
      expect(entry?.disabled).toBe(true)
      expect(readProfilePatches(profilePatchPath(dataRoot))).toEqual([{ id: 'acme-sample', disabled: true }])
      const kernel = [...ctx.loader.entries()].find(item => item.id === 'kernel')
      expect(kernel?.fiber?.state).toBe(FiberState.ACTIVE)

      const enabled = await ctx.pluginInventory.setEnabled('acme-sample', true)
      expect(enabled).toMatchObject({ enabled: true, phase: 'active' })
      expect(readProfilePatches(profilePatchPath(dataRoot))).toEqual([{ id: 'acme-sample', disabled: false }])
    })
  })

  it('rejects builtin entries and missing ids', async () => {
    await withInventory(async ctx => {
      await expect(ctx.pluginInventory.setEnabled('kernel', false)).rejects.toMatchObject({
        status: 403,
        code: 'plugin_not_disableable',
      })
      await expect(ctx.pluginInventory.setEnabled('missing', false)).rejects.toMatchObject({
        status: 404,
        code: 'plugin_not_found',
      })
    })
  })

  it('restores the profile when enable fails', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'tiggyknowledge-plugin-fail-'))
    const ctx = new Context()
    ctx.provide('builtinPluginIds', new Set(['kernel']))
    ctx.provide('dataRoot', dataRoot)
    try {
      await ctx.plugin(Loader)
      ctx.loader.builtins.kernel = { apply() {} }
      ctx.loader.builtins.broken = { apply() { throw new Error('boom') } }
      await ctx.loader.root.update([
        { id: 'kernel', name: 'cordis:kernel' },
        { id: 'broken', name: 'cordis:broken', disabled: true },
      ])
      await ctx.plugin(PluginInventory)
      mkdirSync(join(dataRoot, 'profiles/local'), { recursive: true })
      writeFileSync(profilePatchPath(dataRoot), '- id: broken\n  disabled: true\n')
      await expect(ctx.pluginInventory.setEnabled('broken', true)).rejects.toMatchObject({
        status: 500,
        code: 'plugin_toggle_failed',
      })
      expect(readProfilePatches(profilePatchPath(dataRoot))).toEqual([{ id: 'broken', disabled: true }])
      const entry = [...ctx.loader.entries()].find(item => item.id === 'broken')
      expect(entry?.disabled).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataRoot, { recursive: true, force: true })
    }
  })

  it('serves PUT /api/plugins/:id for third-party hosts only', async () => {
    await withInventory(async ctx => {
      await ctx.plugin(HttpRouter)
      const baseUrl = await listen(ctx)
      const disabled = await fetch(`${baseUrl}/api/plugins/acme-sample`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ enabled: false }),
      })
      expect(disabled.status).toBe(200)
      await expect(disabled.json()).resolves.toMatchObject({ plugin: { entryId: 'acme-sample', enabled: false } })

      const builtin = await fetch(`${baseUrl}/api/plugins/kernel`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ enabled: false }),
      })
      expect(builtin.status).toBe(403)

      const missingOrigin = await fetch(`${baseUrl}/api/plugins/acme-sample`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      })
      expect(missingOrigin.status).toBe(403)
    })
  })
})
