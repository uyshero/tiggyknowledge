import { Context, Service } from '@deepseek-ai/cordis'
import { contributeSurface } from '@tiggyknowledge/plugin-surface'
import type {} from '@tiggyknowledge/wiki-governance'
import { wikiGovernanceHttpRoutes } from '@tiggyknowledge/wiki-governance'

export class WikiGovernanceApi extends Service {
  static inject = ['wikiGovernance']

  constructor(ctx: Context) {
    super(ctx, 'wikiGovernanceApi')
    contributeSurface(ctx, {
      routes: wikiGovernanceHttpRoutes(this.ctx.wikiGovernance),
    })
  }
}

export default WikiGovernanceApi
