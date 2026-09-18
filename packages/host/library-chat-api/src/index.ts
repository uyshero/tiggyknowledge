import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/library-chat'
import { libraryChatHttpRoutes } from '@tiggyknowledge/library-chat'
import { contributeSurface } from '@tiggyknowledge/plugin-surface'

export class LibraryChatApi extends Service {
  static inject = ['libraryChat']

  constructor(ctx: Context) {
    super(ctx, 'libraryChatApi')
    contributeSurface(ctx, {
      routes: libraryChatHttpRoutes(this.ctx.libraryChat),
    })
  }
}

export default LibraryChatApi
