import { Context, Service } from '@deepseek-ai/cordis'
import { contributeSurface } from '@tiggyknowledge/plugin-surface'
import type {} from '@tiggyknowledge/preview-text'

declare module '@deepseek-ai/cordis' {
  interface Context {
    audioPreview: AudioPreview
  }
}

export class AudioPreview extends Service {
  static inject = ['knowledgePreview']

  constructor(ctx: Context) {
    super(ctx, 'audioPreview')
    ctx.effect(() => ctx.knowledgePreview.register(['audio'], document => ({
      content: document.transcript?.trim() || '尚未转写文字。',
      truncated: false,
    })), 'preview-audio: register')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-preview-audio',
        moduleName: '@tiggyknowledge/client-preview-audio',
        label: 'Audio Preview',
        description: 'Recording playback and transcript preview',
      }],
    })
  }
}

export default AudioPreview
