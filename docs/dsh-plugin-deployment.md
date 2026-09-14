# TiggyKnowledge DSH 插件部署手册

这份文档用于把 TiggyKnowledge 接入到其他 DeepSeek Harness / DSH 实例。目标是安装插件产物，而不是复制或修改 DSH 源码。

## 插件组成

| 插件 | 包名 | 运行位置 | 作用 |
|---|---|---|---|
| Composer 上下文选择器 | `@tiggyknowledge/dsh-context` | DSH Web client | 在输入框提供“启用知识库”和范围选择，并随 prompt 发送 `knowledgeContext`。 |
| 知识库工具连接器 | `@tiggyknowledge/dsh-connector` | DSH Host | 注册 `knowledge_*` 工具，调用 TiggyKnowledge `/api/tiggyknowledge/*` 接口。 |

两者建议一起安装。只装 connector 时，模型仍可手动调用 `knowledge_*` 工具；只装 context 时，输入框能选择范围，但没有工具就无法真正检索内容。

## DSH 版本要求

目标 DSH 实例需要具备以下基础扩展点：

- Web conversation 提供 `conversationPromptContext`；
- `session.prompt` 支持可选 `knowledgeContext`；
- Host proxy 提供浏览器可调用的：
  - `tiggyknowledge.libraries`
  - `tiggyknowledge.searchDocuments`
- DSH credentials 能保存 `TIGGYKNOWLEDGE_TOKEN`。

如果目标 DSH 还没有这些基础扩展点，需要先升级到包含 TiggyKnowledge integration seam 的 DSH 版本。业务逻辑仍在插件里，但基础 seam 属于 DSH 平台能力。

## 打包

在 TiggyKnowledge 仓库根目录执行：

```sh
pnpm run pack:dsh
```

产物会生成到：

```text
dist/dsh/
  tiggyknowledge-dsh-context-0.0.1.tgz
  tiggyknowledge-dsh-connector-0.0.1.tgz
```

这两个 tgz 可以复制到其他 DSH 机器，不需要附带源码。

说明：`@tiggyknowledge/dsh-context` 的 DSH 运行时依赖由目标 DSH module loader 提供，包管理器不会去公网解析 DSH 内部 client 包；它的 `dsh.client.inject` 字段才是加载依赖声明。

## 安装到 DSH profile

示例 profile 名称用 `web`，实际以目标实例为准：

```sh
pnpm dsh plugin --profile web add /path/to/tiggyknowledge-dsh-context-0.0.1.tgz
pnpm dsh plugin --profile web add /path/to/tiggyknowledge-dsh-connector-0.0.1.tgz
```

然后在该 profile 的 `cordis.patch.yml` 添加：

```yaml
- insert:
    - id: tiggyknowledge-context
      name: '@tiggyknowledge/dsh-context'

    - id: tiggyknowledge-connector
      name: '@tiggyknowledge/dsh-connector'
      config:
        endpoint: 'http://127.0.0.1:3210'
        tools:
          search: true
          read: true
          okf: true
          write: false
```

## 配置访问 Key

1. 启动 TiggyKnowledge。
2. 进入「设置 → 智能体集成」。
3. 点击生成访问 Key。
4. 在 DSH credentials 中保存为：

```text
TIGGYKNOWLEDGE_TOKEN
```

connector 每次工具调用都会读取这个凭据。没有 credentials 服务时，也可以用环境变量兜底：

```sh
export TIGGYKNOWLEDGE_TOKEN="tk_..."
pnpm dsh web
```

## 使用方式

在 DSH Web 输入框左侧点击“知识库”：

- 关闭：不注入任何知识库上下文；
- 全部知识库：模型会被提示使用 `knowledge_search` 搜索全部知识库；
- 指定知识库：先读取知识库列表，再选择一个或多个知识库；
- 指定文件：搜索文件后选择具体文档，模型会优先用 `knowledge_read` 读取。

模型实际拿内容仍依赖 `@tiggyknowledge/dsh-connector` 注册的工具：

- `knowledge_status`
- `knowledge_list_libraries`
- `knowledge_search`
- `knowledge_read`
- `knowledge_okf`

## 验证

启动 DSH 后：

1. 页面不应卡在 `Loading plugins…`。
2. 输入框左侧应出现“知识库”按钮。
3. 点击后能读取知识库列表。
4. 发送问题时，如果启用了知识库，session prompt 会携带 `knowledgeContext`。
5. 模型可以调用 `knowledge_search` / `knowledge_read`。

## 当前边界

- 第一版只读，不提供写入工具。
- `@tiggyknowledge/dsh-context` 依赖目标 DSH 已内置通用 prompt context seam。
- `@tiggyknowledge/dsh-connector` 通过 HTTP sidecar 调 TiggyKnowledge，不直接读数据库。
