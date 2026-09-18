import agentApi from '../content/docs/agent-api.md?raw'
import desktop from '../content/docs/desktop.md?raw'
import features from '../content/docs/features.md?raw'
import gettingStarted from '../content/docs/getting-started.md?raw'
import plugins from '../../../docs/third-party-plugins.md?raw'
import roadmap from '../content/docs/roadmap.md?raw'

export interface DocPage {
  slug: string
  title: string
  description: string
  markdown: string
}

export const DOC_PAGES: DocPage[] = [
  {
    slug: 'getting-started',
    title: '快速开始',
    description: '安装桌面版，创建知识库并导入第一批文档。',
    markdown: gettingStarted,
  },
  {
    slug: 'features',
    title: '产品功能',
    description: '知识库、搜索、Wiki、自定义插件与本地模型。',
    markdown: features,
  },
  {
    slug: 'desktop',
    title: '桌面客户端',
    description: '数据目录、本地服务端口、更新检查与签名状态。',
    markdown: desktop,
  },
  {
    slug: 'agent-api',
    title: '智能体接入',
    description: '面向外部智能体的只读知识库接口。',
    markdown: agentApi,
  },
  {
    slug: 'plugins',
    title: '第三方插件',
    description: 'Host / Client 契约、命名、HTTP 与本地挂载流程。',
    markdown: plugins,
  },
  {
    slug: 'roadmap',
    title: '后续规划',
    description: '企业版、共享知识库、更多格式与创作能力。',
    markdown: roadmap,
  },
]

export const DEFAULT_DOC_SLUG = DOC_PAGES[0]?.slug ?? 'getting-started'

export function findDoc(slug: string | undefined): DocPage | undefined {
  return DOC_PAGES.find(page => page.slug === slug)
}
