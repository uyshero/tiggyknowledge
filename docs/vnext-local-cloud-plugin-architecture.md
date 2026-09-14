# TiggyKnowledge 下一版本迭代要求与设计：本地 / 云端双形态与插件化

## 背景

TiggyKnowledge 当前本地 MVP 已验证了知识库、文档上传、PDF 预览、标签、收藏、OKF、图谱、设置、插件页、智能体集成 API 与 DSH 参考接入。下一版本要开始为企业云端形态做准备，但不能把 MVP 重新拖重。

本阶段参考 CodexHarness 的组织方式：不是拆成两个完全独立项目，而是在一个 monorepo 内拆清楚核心、协议、运行环境、客户端、存储边界与插件边界。

## 核心判断

- 保持一个项目，不先新开完全独立仓库。
- 本地版和云端版是两种部署形态，不是两套产品内核。
- 本地和云端不做实时同步。
- 最多支持手动迁移：导出 `.tiggykb`，再导入到另一端。
- 智能体接入必须走标准接口，不绑定 DSH。
- 继续坚持 everything is plugin，尤其是文件解析、预览、索引、迁移、智能体接入、企业能力。

## 下一版本目标

下一版本不是直接做完整企业 SaaS，而是把本地产品升级成“可云端化”的架构。

必须完成：

- 抽出共享协议与类型边界。
- 明确插件类型和插件生命周期。
- 把文件解析等通用能力按插件组织。
- 设计本地 / 云端共用的 API 与 SDK。
- 增加手动迁移包设计。
- 为云端 Web、云端 API、企业存储预留 app/package 边界。

不做：

- 不做实时同步。
- 不做后台自动同步。
- 不做双向增量同步。
- 不做多端冲突合并。
- 不做复杂企业组织架构。
- 不做在线协同编辑。

## 推荐 monorepo 结构

```text
tiggyknowledge
├─ apps/web                         # 当前本地 Web，可逐步重命名为 local-web
├─ apps/cli                         # 当前本地开发/启动入口
├─ apps/cloud-web                   # TODO：云端浏览器界面
├─ apps/cloud-api                   # TODO：云端 API 服务
├─ packages/protocol                # TODO：共享协议、类型、错误码、Schema
├─ packages/client                  # TODO：外部 JS/TS SDK
├─ packages/core                    # TODO：知识库核心领域逻辑
├─ packages/storage-local           # TODO：本地文件/SQLite 存储实现
├─ packages/storage-cloud           # TODO：云端数据库/对象存储实现
├─ packages/agent-integration       # TODO：标准智能体接入能力
├─ packages/plugins                 # TODO：内置插件集合
│  ├─ parser-pdf
│  ├─ parser-markdown
│  ├─ parser-text
│  ├─ preview-pdf
│  ├─ index-keyword
│  ├─ index-okf
│  ├─ migration-tiggykb
│  └─ graph
└─ packages/dsh                     # DSH 参考接入插件
```

第一步不要求马上完成目录大迁移。可以先在现有结构内按这些边界新增包，后续再整理命名。

## 本地版与云端版职责

### 本地版

本地版继续定位为个人/本机可用的知识库产品。

能力：

- 本地 Web 界面。
- 本地 Host API。
- 本地数据目录。
- 本地原文件保存。
- 标签、收藏、预览、搜索、OKF、图谱。
- 智能体通过 `http://127.0.0.1:3210` 接入。
- 不依赖云端账号。
- 无需登录也能完整使用本地知识库基础能力。
- 如果用户选择登录云端账号，本地端可以展示云端入口，并支持打开浏览器新标签进入云端版使用。

本地专属插件：

- `storage.local`
- `storage.sqlite`
- `local.open-folder`
- `local.file-watcher`
- `local.cloud-launcher`

### 云端版

云端版必须有界面，不只是 API。它面向企业客户通过浏览器访问。

能力：

- 企业 Web 界面。
- 云端 API。
- 登录和租户空间。
- 知识库列表、创建、上传、预览、搜索。
- 成员分享。
- 访问 Key 管理。
- 智能体集成配置。
- 导入/导出 `.tiggykb`。

云端专属插件：

- `storage.postgres`
- `storage.s3`
- `enterprise.auth`
- `enterprise.tenant`
- `enterprise.members`
- `enterprise.share`
- `enterprise.audit-log`

本地端登录云端账号不代表自动同步。本地端登录后的第一阶段只提供：

- 显示当前云端账号/企业空间。
- 打开云端 Web 新标签。
- 复制或配置云端 API 地址。
- 后续可选支持手动导出到云端/从云端导入。

明确不做：

- 登录后自动上传本地知识库。
- 登录后自动下载云端知识库。
- 登录后把本地数据和云端数据混成一个库。
- 登录后绕过 `.tiggykb` 手动迁移边界。

## 插件化原则

核心只定义协议、生命周期和最小领域模型。能力尽量通过插件提供。

核心保留：

- 插件加载。
- 配置管理。
- 权限/Token 基础能力。
- 知识库模型。
- 文档模型。
- 标准 API 路由注册。
- 事件总线。
- 本地/云端运行环境适配。

插件提供：

- 存储。
- 文件解析。
- 文档预览。
- 搜索索引。
- OKF 映射。
- 图谱。
- 导入导出。
- 智能体接入。
- 企业成员、分享、审计。

## 插件类型设计

### 文件解析插件

文件解析是最重要的通用插件类型。PDF、Markdown、TXT、Word、PPT、Excel、论文、OCR 后续都会变复杂，不能写死在 core 里。

```ts
interface DocumentParserPlugin {
  id: string
  name: string
  supportedMimeTypes: string[]

  parse(input: {
    filePath?: string
    buffer?: Buffer
    mimeType: string
    fileName: string
  }): Promise<ParsedDocument>
}

interface ParsedDocument {
  title?: string
  text: string
  pages?: ParsedPage[]
  metadata?: Record<string, unknown>
  attachments?: ParsedAsset[]
}
```

### 预览插件

```ts
interface PreviewPlugin {
  id: string
  name: string
  supportedMimeTypes: string[]

  render(input: {
    documentId: string
    fileUrl: string
    parsed?: ParsedDocument
  }): PreviewView
}
```

### 索引插件

关键词搜索作为默认内置能力，向量化和图谱作为可选插件。

```ts
interface IndexPlugin {
  id: string
  name: string
  mode: 'keyword' | 'vector' | 'graph' | 'okf'

  indexDocument(input: {
    libraryId: string
    documentId: string
    parsed: ParsedDocument
  }): Promise<void>

  search(input: {
    query: string
    libraryIds?: string[]
    topK?: number
  }): Promise<SearchResult[]>
}
```

### 迁移插件

下一版本只做手动迁移，不做同步。迁移能力也应该插件化。

```ts
interface MigrationPlugin {
  id: string
  name: string
  format: string

  exportLibrary(input: {
    libraryId: string
    includeOriginalFiles: boolean
  }): Promise<MigrationArchive>

  importLibrary(input: {
    archivePath: string
    targetName?: string
  }): Promise<ImportResult>
}
```

## 手动迁移设计

迁移包格式：

```text
example.tiggykb
├─ manifest.json
├─ metadata
│  ├─ libraries.json
│  ├─ documents.json
│  ├─ tags.json
│  ├─ favorites.json
│  └─ okf.json
└─ documents
   ├─ original
   └─ parsed
```

迁移支持：

- 本地知识库导出为 `.tiggykb`。
- 云端导入 `.tiggykb`。
- 云端知识库导出为 `.tiggykb`。
- 本地导入 `.tiggykb`。

迁移不承诺：

- 不保留本地文件绝对路径。
- 不做实时变化跟踪。
- 不做冲突合并。
- 不做增量双向同步。

导入策略：

- 默认创建一个新的知识库。
- 不覆盖已有知识库。
- 如果名称重复，自动加后缀。
- 文档 ID 可以重新生成，但迁移包里要保留 `sourceId` 方便后续追踪。

## 智能体接入设计

智能体只依赖标准 API 和 SDK，不关心后端是本地还是云端。

本地：

```text
http://127.0.0.1:3210
```

云端：

```text
https://knowledge.example.com
```

SDK 示例：

```ts
const client = new TiggyKnowledgeClient({
  baseUrl: 'http://127.0.0.1:3210',
  token: process.env.TIGGYKNOWLEDGE_TOKEN,
})

const results = await client.search({
  query: 'OKF 是什么',
  knowledgeBaseIds: [],
  topK: 5,
})
```

下一版本要把当前 `/api/tiggyknowledge/*` 文档沉淀成：

- `packages/protocol`
- `packages/client`
- OpenAPI / JSON Schema 导出
- 智能体接入手册页面

DSH 只是参考实现。其他智能体应该能照着同一套接口接入。

## UI 设计要求

本地版和云端版尽量复用 UI 组件。

共用界面：

- 知识库列表。
- 文档列表。
- 上传。
- 文档预览。
- 标签。
- 收藏。
- 搜索。
- OKF 展示。
- 图谱。
- 插件。
- 智能体集成。

本地专属界面：

- 设置 → 存储 → 打开本地数据目录。
- 本地数据目录展示。
- 本地文件夹相关能力。
- 设置 → 云端入口：未登录也不影响本地使用；登录后可打开云端版新标签。

云端专属界面：

- 登录。
- 企业空间。
- 成员管理。
- 分享审批。
- 企业访问 Key。
- 审计日志。
- 云端导入/导出。

视觉继续保持当前倾向：

- 中性灰/白。
- 避免绿色作为主按钮或选中态。
- 插件和设置布局参考 DSH / Obsidian 的清晰侧边栏风格。

## 下一版本 P0/P1/P2

### P0：架构边界落地

- 新增 `packages/protocol`，沉淀知识库、文档、搜索、OKF、错误码类型。
- 新增 `packages/client`，封装标准 API 调用。
- 将智能体接口文档与 SDK 类型保持一致。
- 明确插件类型：parser、preview、index、migration、agent、enterprise、storage。
- 当前内置能力先不外部安装，但代码组织按插件边界走。

### P1：通用插件化改造

- PDF 解析改造成 `parser.pdf` 内置插件。
- Markdown/TXT 解析改造成解析插件。
- PDF 预览改造成 `preview.pdf` 内置插件。
- 关键词搜索改造成 `index.keyword` 内置插件。
- OKF 映射改造成 `index.okf` 或 `okf.mapping` 内置插件。
- 图谱保持默认关闭，作为 `graph` 插件管理。

### P2：手动迁移

- 新增 `migration.tiggykb` 内置插件。
- 支持导出当前知识库为 `.tiggykb`。
- 支持从 `.tiggykb` 导入为新知识库。
- 导入/导出必须包含原文件、解析文本、标签、收藏、OKF 元数据。
- 迁移包格式写入标准文档。

### P3：云端预留

- 新增 `apps/cloud-web` 与 `apps/cloud-api` 的空壳或设计文档。
- 设计 `storage-cloud` 接口，不急于实现。
- 设计企业插件边界：auth、tenant、members、share、audit-log。
- 云端 API 必须复用 `/api/tiggyknowledge/*` 标准接口。

## 验收标准

下一版本完成后，应满足：

- 本地版继续独立可用。
- DSH 插件继续可用。
- 标准智能体接口不绑定 DSH。
- 文件解析、预览、索引、迁移都有明确插件边界。
- 能导出/导入 `.tiggykb` 完成手动迁移。
- 文档明确说明不支持实时同步。
- 云端版有清晰 app/package 预留，不影响当前本地 MVP。

## 当前结论

TiggyKnowledge 下一版本的重点不是“马上做云端完整产品”，而是把当前本地 MVP 变成一个可扩展的知识库 Kernel。云端版、本地版、DSH 接入、未来其他智能体接入，都应该围绕同一套协议和插件边界生长。
