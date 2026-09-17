import { ArrowRight, BookOpen, Download, Github } from 'lucide-react'
import { Link } from 'react-router-dom'
import brandIcon from '../brand-icon.png'
import { GITHUB_URL, PRODUCT_ENGLISH_NAME, PRODUCT_NAME } from '../constants'

const FEATURES = [
  { id: '01', title: '本地优先', body: '文档和索引写在本机。默认不上传云端。' },
  { id: '02', title: '全文检索', body: '按知识库搜索 Markdown、文本和 PDF。' },
  { id: '03', title: '图谱与 Wiki', body: '看文档关系，生成带来源引用的 Wiki。' },
  { id: '04', title: '智能体接口', body: '只读 HTTP API，不绑定单一 Agent。' },
  { id: '05', title: '自定义插件', body: '自己写、快速装，立刻扩展。' },
]

const PLUGIN_SLOTS = ['parser', 'preview', 'index', 'ui', 'agent']

const PLUGIN_STEPS = [
  { id: '01', title: '自己写', body: '按 Host / Client 接口实现新格式、页面或接入。' },
  { id: '02', title: '快速安装', body: '加入运行时并启用，设置里能看到状态。' },
  { id: '03', title: '立刻扩展', body: '新能力出现在知识库，不必改内核、不用等发版。' },
]

const ROADMAP = [
  { id: '01', title: '企业共享知识库', body: '团队共用、按范围授权。本地与云端是同一种产品的两种形态。' },
  { id: '02', title: '更多格式解析', body: '按插件扩展办公文档等格式的解析与预览。' },
  { id: '03', title: '笔记与录音', body: '在库内写笔记、录音并转成可检索条目。' },
  { id: '04', title: '智能修改文件', body: '按指令改写正文，先预览再确认，保留版本。' },
]

export function HomePage(): JSX.Element {
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-kicker">
            <span className="signal-dot" />
            <p>{PRODUCT_ENGLISH_NAME} / LOCAL AI RUNTIME</p>
          </div>
          <h1>本地优先的知识库。</h1>
          <p className="lede">
            {PRODUCT_NAME} 把文档、检索、图谱和 Wiki 放在本机，并向智能体提供只读接口。能力按插件组装：你可以自定义插件，快速安装，立刻扩展。
          </p>
          <div className="hero-actions">
            <Link className="button-dark" to="/download">
              <Download size={16} />
              下载桌面版
            </Link>
            <Link className="button-light" to="/docs">
              文档
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="runtime-signals" aria-label="运行时特性">
            <span><i />LOCAL CORE</span>
            <span>PLUGIN BUS</span>
            <span>AGENT READY</span>
          </div>
        </div>
        <div className="app-preview" aria-hidden="true">
          <div className="preview-coordinate">TK://LOCAL/CORE</div>
          <div className="preview-sidebar">
            <div className="preview-brand">
              <img src={brandIcon} alt="" width={22} height={22} />
              <strong>{PRODUCT_NAME}</strong>
            </div>
            <div className="preview-nav">
              <span className="active">知识库</span>
              <span>搜索</span>
              <span>图谱</span>
              <span>Wiki</span>
            </div>
            <div className="preview-status"><i />127.0.0.1:3210</div>
          </div>
          <div className="preview-main">
            <header>
              <p className="eyebrow">NODE 01 / RUNTIME</p>
              <h2>工作区</h2>
            </header>
            <div className="preview-stats">
              <div><span>libraries</span><strong>3</strong></div>
              <div><span>docs</span><strong>128</strong></div>
              <div><span>plugins</span><strong>24</strong></div>
            </div>
            <div className="preview-rows">
              <div><strong>product-manual</strong><span>● ready</span></div>
              <div><strong>research-notes</strong><span>● ready</span></div>
              <div><strong>internal-spec</strong><span>● indexed</span></div>
            </div>
          </div>
          <div className="preview-axis preview-axis-x">X / 04</div>
          <div className="preview-axis preview-axis-y">Y / 12</div>
        </div>
      </section>

      <section className="spec-grid" aria-label="产品特点">
        {FEATURES.map(feature => (
          <article key={feature.id}>
            <span>{feature.id}</span>
            <h2>{feature.title}</h2>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>

      <section className="kernel">
        <div className="kernel-copy">
          <p className="eyebrow">PLUGIN KERNEL</p>
          <h2>自定义插件，立刻扩展。</h2>
          <p>解析、预览、检索、Wiki、界面和智能体接入都是插槽。写自己的插件或安装现成插件，装上即用，不必改内核。</p>
          <Link className="text-link invert" to="/docs/features">
            插件如何工作
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="kernel-board">
          <p className="kernel-label">slots</p>
          <div className="kernel-slots">
            {PLUGIN_SLOTS.map(slot => <code key={slot}>{slot}</code>)}
          </div>
          <ol className="kernel-flow">
            {PLUGIN_STEPS.map(step => (
              <li key={step.id}>
                <span>{step.id}</span>
                <strong>{step.title}</strong>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="roadmap">
        <div className="roadmap-intro">
          <p className="eyebrow">ROADMAP</p>
          <h2>后续规划</h2>
          <p>尚未发布。本地优先不会被企业版取代；新能力继续以插件加入。</p>
          <Link className="text-link" to="/docs/roadmap">
            完整规划
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="roadmap-list">
          {ROADMAP.map(item => (
            <article key={item.id}>
              <span>{item.id}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="split-band">
        <div>
          <p className="eyebrow">AGENT API</p>
          <h2>只读接口，不绑定某一个 Agent。</h2>
          <p>生成访问 Key，限制知识库范围，按标准 HTTP 搜索和读取。deepseek-harness 只是参考接入。</p>
          <Link className="text-link" to="/docs/agent-api">
            接入文档
            <ArrowRight size={15} />
          </Link>
        </div>
        <pre className="terminal-sample"><code>{`POST /api/tiggyknowledge/search
Authorization: Bearer <access-key>

{ "query": "向量化", "topK": 5 }`}</code></pre>
      </section>

      <section className="cta-band">
        <div>
          <h2>从桌面版开始</h2>
          <p>macOS / Windows 安装包由 GitHub Releases 提供。</p>
        </div>
        <div className="hero-actions">
          <Link className="button-dark" to="/download"><Download size={16} />下载</Link>
          <a className="button-light" href={GITHUB_URL} rel="noreferrer" target="_blank"><Github size={16} />GitHub</a>
          <Link className="button-light" to="/docs"><BookOpen size={16} />文档</Link>
        </div>
      </section>
    </div>
  )
}
