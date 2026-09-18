import type { Context } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/client-bootstrap'
import type { ClientPluginDescriptor } from '@tiggyknowledge/contracts'
import { HttpError, type HttpRouteDefinition } from '@tiggyknowledge/http-router'
import type {} from '@tiggyknowledge/http-router'

export interface PluginSurface {
  routes?: HttpRouteDefinition[]
  snapshot?: { id: string, contribute: () => Record<string, unknown> }
  clients?: ClientPluginDescriptor[]
}

export function contributeSurface(ctx: Context, surface: PluginSurface): void {
  if ((surface.routes?.length ?? 0) > 0 || surface.snapshot !== undefined) {
    ctx.inject(['httpRouter'], ctx => {
      const disposers: Array<() => void> = []
      for (const route of surface.routes ?? []) disposers.push(ctx.httpRouter.register(route))
      if (surface.snapshot !== undefined) {
        disposers.push(ctx.httpRouter.registerSnapshotContributor(surface.snapshot.id, surface.snapshot.contribute))
      }
      return () => {
        for (const dispose of disposers.reverse()) dispose()
      }
    })
  }
  if ((surface.clients?.length ?? 0) > 0) {
    ctx.inject(['clientBootstrap'], ctx => ctx.clientBootstrap.registerAll(surface.clients ?? []))
  }
}

export function pathSegment(match: RegExpMatchArray | undefined, index = 1): string {
  try {
    return decodeURIComponent(match?.[index] ?? '')
  } catch {
    throw new HttpError(400, 'invalid_path', '路径无效')
  }
}

export function httpFromRange(error: unknown, notFoundCode: string, invalidCode = notFoundCode): unknown {
  if (!(error instanceof RangeError)) return error
  return new HttpError(error.message.includes('不存在') ? 404 : 400, error.message.includes('不存在') ? notFoundCode : invalidCode, error.message)
}

export { HttpError }
export type { ClientPluginDescriptor, HttpRouteDefinition }
