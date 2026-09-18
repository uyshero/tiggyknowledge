# 第三方插件开发流程与标准

内置能力由产品交付，用户不能开关。第三方插件按本文契约编写；装上之后可以关闭。

插件是一个 Cordis 模块：Host 侧提供服务和 HTTP，可选再声明 Client 伴生。不要改内核，不要静态注入 `httpRouter`。

## 1. 形态

一个功能插件通常是一对包：

| 包 | 运行位置 | 职责 |
| --- | --- | --- |
| Host | Node（CLI / 桌面 Host） | 领域服务、HTTP、`/api/system` 快照字段、声明 Client 伴生 |
| Client | 浏览器 Cordis 树 | 页面、设置面板、知识库动作、条目检查器、预览、浮层 |

允许只有 Host（纯 API / 后台）。有界面就必须有 Client，并由 Host 用 `contributeSurface({ clients })` 声明，不要写进内核的 `client-bootstrap` 列表。

包名不要使用 `@tiggyknowledge/*`。建议 `scope/tiggyknowledge-<id>`，例如 `@acme/tiggyknowledge-highlights`。

## 2. 命名

| 项 | 规则 | 示例 |
| --- | --- | --- |
| Host YAML `id` | 小写、连字符、带前缀，全局唯一 | `acme-highlights` |
| Cordis 服务名 | camelCase，与 `super(ctx, name)` 一致 | `acmeHighlights` |
| HTTP `route.id` | `<plugin-id>:<action>` | `acme-highlights:list` |
| HTTP 路径 | `/api/ext/<plugin-id>/...` | `/api/ext/acme-highlights/items` |
| Client `id` | `client-<plugin-id>` 或更细的伴生 id | `client-acme-highlights` |
| Client `moduleName` | npm 包名，与 Host 声明一致 | `@acme/tiggyknowledge-highlights-ui` |

禁止占用：

- 路径 `/api/system`、`/api/health`、`/api/capabilities`、`/api/tiggyknowledge/*`
- Client 内核 id：`client-connection`、`client-runtime`、`client-ui-settings`、`client-ui-layout`
- 已有内置页面 / 设置面板 / 知识库动作 / 检查器 id（冲突会在注册时抛错）

## 3. Host 标准

### 3.1 包形态

- `"type": "module"`
- `main` / `exports` 指向编译后的 `lib/index.js`
- `export default` 一个 Cordis `Service` 子类（或 `export function apply`）
- `peerDependencies` 声明 `@deepseek-ai/cordis` 和实际用到的 Host 服务包
- 需要 HTTP 或 Client 时，peer 依赖 `@tiggyknowledge/plugin-surface`

### 3.2 生命周期

```ts
import { Context, Service } from '@deepseek-ai/cordis'
import { contributeSurface, HttpError, httpFromRange, pathSegment } from '@tiggyknowledge/plugin-surface'

declare module '@deepseek-ai/cordis' {
  interface Context {
    acmeHighlights: AcmeHighlights
  }
}

export class AcmeHighlights extends Service {
  static inject = ['knowledgeCatalog']

  constructor(ctx: Context) {
    super(ctx, 'acmeHighlights')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-acme-highlights',
        moduleName: '@acme/tiggyknowledge-highlights-ui',
        label: 'Highlights',
        description: 'Document highlights',
      }],
      snapshot: {
        id: 'acme-highlights',
        contribute: () => ({ acmeHighlights: this.snapshot() }),
      },
      routes: [{
        id: 'acme-highlights:item',
        methods: ['GET'],
        path: /^\/api\/ext\/acme-highlights\/items\/([^/]+)$/,
        handler: ({ json, match }) => {
          try {
            json(this.item(pathSegment(match)))
          } catch (error) {
            throw httpFromRange(error, 'highlight_not_found')
          }
        },
      }, {
        id: 'acme-highlights:create',
        methods: ['POST'],
        path: '/api/ext/acme-highlights/items',
        handler: async ({ assertSameOrigin, json, readJson }) => {
          assertSameOrigin()
          try {
            json(this.create(await readJson()), 201)
          } catch (error) {
            if (error instanceof RangeError) throw new HttpError(400, 'invalid_highlight', error.message)
            throw error
          }
        },
      }],
    })
  }

  async *[Service.init]() {
    const dispose = this.ctx.on('knowledge/document/deleted', ids => this.forget(ids))
    yield () => dispose()
  }
}

export default AcmeHighlights
```

### 3.3 依赖

- **静态 `static inject`**：只写本插件启动所必需、且属于内核/内置、始终存在的服务。例如 `knowledgeCatalog`、`knowledgeContent`、`settings`。
- **不要**把 `httpRouter`、`clientBootstrap` 放进 `static inject`。用 `contributeSurface`，它会按需 `ctx.inject`。
- 依赖另一个**可能被关掉的第三方插件**时，用 `ctx.inject(['otherService'], ...)`，不要静态注入，否则对方关闭后本插件会停在等待依赖。
- 不要静态注入可选能力。

可订阅的知识事件：

- `knowledge/library/deleted`
- `knowledge/document/changed`
- `knowledge/document/deleted`

在 `Service.init` 或 `ctx.effect` 里订阅，并返回 disposer。

### 3.4 HTTP

- 写操作（`POST` / `PUT` / `PATCH` / `DELETE`）必须 `assertSameOrigin()`。
- 领域校验失败抛 `RangeError`；HTTP 层转成 `HttpError` 或 `httpFromRange`。
- 路径参数用 `pathSegment(match)`，不要自己 `decodeURIComponent`。
- `route.id` 全局唯一；重复 id 会导致 Host 启动失败。
- JSON 体默认上限 16 KB。上传走 `readUpload()`，不要自己读 raw body。
- 不要拦截 `/api/tiggyknowledge/*`。智能体协议由内置 `agent-api` 声明能力。

### 3.5 系统快照

`contributeSurface.snapshot.id` 必须唯一。贡献到 `/api/system` 的字段名也必须唯一。第三方字段用自己的前缀，例如 `acmeHighlights`，不要覆盖 `catalog`、`settings`、`llm`、`hostPlugins`、`clientBoot`、`semanticSearch`。

## 4. Client 标准

### 4.1 包形态

```ts
export const inject = ['clientApp', 'connection']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.clientApp.registerPage({
    id: 'acme-highlights',
    label: '高亮',
    icon: Highlighter,
    component: HighlightsPage,
    order: 50,
    section: 'secondary',
  }), 'acme-highlights: page')
}
```

- 必须导出 `apply`；需要服务时导出 `inject`。
- 所有 `register*` 放在 `ctx.effect(...)` 里，插件卸载时自动撤销。
- 使用 `connection` 调用内置 API。自己的 Host 路由用 `fetch`，写操作不要省略浏览器同源。
- 不要给 `client-connection` 打补丁。

### 4.2 扩展点

通过 `ctx.clientApp` 注册，id 冲突会抛错：

| 方法 | 用途 | `section` / 说明 |
| --- | --- | --- |
| `registerPage` | 侧栏或隐藏页 | `primary` / `secondary` / `tags` / `hidden` |
| `registerSettingsPanel` | 设置分类 | `order` 建议 ≥ 100 |
| `registerLibraryAction` | 知识库列表行内动作 | |
| `registerDocumentInspector` | 条目详情检查器 | |
| `registerAppOverlay` | 全局浮层（对话框、侧栏聊天等） | |
| `registerDocumentPreviewRenderer` | 某种 `sourceType` 的预览 | 每种格式只能有一个 |

当前 `sourceType` 是闭合联合：`text` | `markdown` | `pdf` | `url`。第三方**不能**新增来源类型或替换已有预览器。新格式要等产品打开该联合后再做 parser / preview 插件。

页面 `order`：内置主功能占用较小数字。第三方用 50 以上，避免插到「知识库 / 搜索 / 设置」前面。

### 4.3 内核 Client 服务

可以 inject：

- `clientApp`：注册 UI
- `connection`：调用内置 Host API

不要依赖未声明的内部模块路径。不要改 React 根节点，根节点由 `client-ui-layout` 渲染。

## 5. 开发流程

1. **定 id**  
   选不会碰撞的 `plugin-id`、服务名、路由前缀、Client `moduleName`。

2. **写 Host**  
   `Service` + `contributeSurface`。领域错误用 `RangeError`。单测里 `Context` + `HttpRouter` + 本插件即可，不要拉起整棵 Host 树。

3. **写 Client（如需界面）**  
   `inject` + `apply`，用 `ctx.effect` 注册扩展点。用 `fetch` 打自己的 `/api/ext/...`。

4. **本地挂载**  
   把编译后的插件目录放到数据目录的 `plugins/` 下，例如 `app-data/plugins/acme-highlights/`（桌面版数据目录见桌面客户端文档）。目录里要有 `package.json`：

   ```json
   {
     "name": "@acme/tiggyknowledge-highlights",
     "type": "module",
     "main": "./dist/host.js",
     "tiggyknowledgePlugin": {
       "id": "acme-highlights",
       "host": "./dist/host.js",
       "client": {
         "moduleName": "@acme/tiggyknowledge-highlights-ui",
         "entry": "./dist/client.js"
       }
     }
   }
   ```

   Host 入口用 ESM。`@deepseek-ai/*` 和 `@tiggyknowledge/*` 由产品解析，不要打进插件包。有界面时再提供 `client.entry`：打成浏览器 ESM，`react`、`react/jsx-runtime`、`@deepseek-ai/cordis`、`@tiggyknowledge/client-runtime`、`@tiggyknowledge/client-connection` 保持外部依赖。Client 描述里写上 `url: "/ext/plugins/<plugin-id>/client.js"`。

   仓库里的样例：`examples/duplicates`。在仓库根目录执行 `node examples/duplicates/build.mjs`，再把该目录拷到 `app-data/plugins/example-duplicates`。

   仍可用 profile / `--patch` 插入 Host-only 插件（包名需能被 Node 解析）。不要改 `packages/bundle/local/cordis.patch.yml`。

5. **确认启动**  
   Host 必须全部 ACTIVE。重复路由 id、重复 Client id、静态注入缺失服务，都会让启动失败。

6. **确认表面**  
   - `GET /api/system` 出现你的快照字段（若有）  
   - `clientBoot.plugins` 含伴生 Client；有界面时应带 `url`  
   - 设置 → 插件列表里该条目标成「第三方 / 可关」  
   - 写接口无 `Origin` 时返回 403

7. **关闭（仅第三方）**  
   设置 → 插件列表里，第三方 Host 有开关。关掉后写入 `app-data/profiles/local/cordis.patch.yml`：

   ```yaml
   - id: acme-highlights
     disabled: true
   ```

   也可以直接改同一 profile。`PUT /api/plugins/<id>` `{ "enabled": false }` 只接受第三方 Host；内置条目返回 403。关闭后路由、快照字段、Client 伴生必须一起消失，且不得把内置插件拖成等待依赖。

## 6. 加载与开关

| | 内置 | 第三方 |
| --- | --- | --- |
| 来源 | 产品 bundle | `dataRoot/plugins/*/package.json`，或 profile / `--patch` 插入的额外包 |
| 清单 | `origin: builtin`，不可关 | `origin: third-party`，可关 |
| 关闭手段 | 无 | 设置页开关，或 profile `disabled: true` |
| Client | Web 打包 `packages/client/*` | Host 声明的 `url`（`/ext/plugins/<id>/client.js`） |

启动时扫描 `plugins/`，把发现的 Host 插进 bundle 之后、profile 之前，因此 profile 可以覆盖配置或关掉它们。Web 先加载内置 Client，再按 `url` 加载第三方伴生。关掉 Host 后，对应路由和伴生 UI 一起撤；设置页只给第三方 Host 开关，内置条目没有开关。

## 7. 禁止

- 修改或关闭内置插件。
- 把 `httpRouter` / `clientBootstrap` 写进 `static inject`。
- 在内核 `client-bootstrap.config.plugins` 里登记第三方 Client。
- 占用 `/api/tiggyknowledge/*` 或改智能体 capabilities。
- 替换已有 `sourceType` 预览器。
- 在 Client 里直接操作 DOM 根节点，或绕过 `clientApp` 往布局里塞页面。
- 把密钥写进插件配置明文仓库；密钥走现有设置/凭据服务。
- 注册时吞掉重复 id 错误。

## 8. 验收清单

- [ ] 包名不是 `@tiggyknowledge/*`
- [ ] Host `id`、服务名、`route.id`、Client `id`、`moduleName` 均唯一且带自己的前缀
- [ ] HTTP 只挂在 `/api/ext/<plugin-id>/`
- [ ] 写操作 `assertSameOrigin()`
- [ ] HTTP / Client 经 `contributeSurface` 注册
- [ ] `static inject` 不含 `httpRouter`、`clientBootstrap`、其他第三方服务
- [ ] Client 用 `ctx.effect` 注册，关掉 Host 后伴生会撤
- [ ] 单测覆盖：主路径、校验失败、关掉后路由 404
- [ ] 关闭本插件后，内置 Host 树仍全部 ACTIVE
- [ ] 设置页可为该 Host 开关，内置条目没有开关
- [ ] 有界面时 `client.entry` 可被 `GET /ext/plugins/<id>/client.js` 取到
