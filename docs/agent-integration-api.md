# TiggyKnowledge 智能体集成标准接口

TiggyKnowledge 提供一组面向外部智能体的只读知识库接口。deepseek-harness / DSH 只是一个参考接入方，不是接口命名空间。

## Base URL

所有接口路径都相对于 Base URL。

本机默认示例：

```text
http://127.0.0.1:3210
```

企业或远程部署示例：

```text
https://knowledge.example.com
```

完整 URL 示例：

```text
http://127.0.0.1:3210/api/tiggyknowledge/search
```

## 认证

公开只读接口统一使用 Bearer Token：

```http
Authorization: Bearer <access-key>
```

访问 Key 在「设置 → 智能体集成」中生成。明文只显示一次，后续只保留预览值与哈希。

访问 Key 会受「设置 → 智能体集成」里的默认知识库范围约束：

- 选择“全部知识库”时，该 Key 可以访问全部知识库。
- 选择具体知识库时，该 Key 只能列出、搜索、读取这些知识库内的文档。
- 搜索接口会自动和允许范围取交集；请求越界知识库时返回空结果。
- `read` / `okf` 请求越界文档时返回 200 空内容，不暴露标题、原文件名等文档元信息。

## 接口总览

公开只读接口只使用 `/api/tiggyknowledge/*` 命名空间，不再保留 `/api/dsh/*` 或 `/api/agent/*` 兼容路径。

| 能力 | 方法 | 路径 |
|---|---:|---|
| 状态检查 | GET | `/api/tiggyknowledge/status` |
| 知识库列表 | GET | `/api/tiggyknowledge/libraries` |
| 知识库搜索 | POST | `/api/tiggyknowledge/search` |
| 文档读取 | GET | `/api/tiggyknowledge/documents/:id/read` |
| OKF 映射 | GET | `/api/tiggyknowledge/documents/:id/okf` |

管理接口主要给本机设置面板或管理型客户端使用：

| 能力 | 方法 | 路径 |
|---|---:|---|
| 保存智能体集成配置 | PUT | `/api/settings/agent-integration` |
| 生成或轮换访问 Key | POST | `/api/settings/agent-integration/access-key` |

## GET /api/tiggyknowledge/status

用于确认 TiggyKnowledge 是否在线，以及当前知识库能力是否可用。

```bash
curl -H "Authorization: Bearer <access-key>" \
  http://127.0.0.1:3210/api/tiggyknowledge/status
```

响应示例：

```json
{
  "product": "tiggyknowledge",
  "version": "0.0.1",
  "dataDirectory": "/Users/you/Library/Application Support/tiggyknowledge",
  "libraries": 2,
  "documents": 128,
  "capabilities": {
    "search": true,
    "read": true,
    "okf": true,
    "write": false
  }
}
```

## GET /api/tiggyknowledge/libraries

用于让智能体展示或选择具体知识库。

```bash
curl -H "Authorization: Bearer <access-key>" \
  http://127.0.0.1:3210/api/tiggyknowledge/libraries
```

响应示例：

```json
{
  "items": [
    {
      "id": "kb_01",
      "name": "默认知识库",
      "description": "本机知识库",
      "documentCount": 42,
      "createdAt": "2026-08-24T10:00:00.000Z",
      "updatedAt": "2026-08-24T10:30:00.000Z"
    }
  ]
}
```

## POST /api/tiggyknowledge/search

用于按关键词搜索知识库。第一版是关键词检索；向量检索后续可以作为插件能力扩展。

```bash
curl -X POST http://127.0.0.1:3210/api/tiggyknowledge/search \
  -H "Authorization: Bearer <access-key>" \
  -H "Content-Type: application/json" \
  -d '{"query":"向量化","knowledgeBaseIds":[],"topK":5,"favoriteOnly":false}'
```

请求体：

```json
{
  "query": "向量化",
  "knowledgeBaseIds": ["kb_01", "kb_02"],
  "topK": 5,
  "favoriteOnly": false
}
```

参数说明：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `query` | `string` | 是 | 搜索词。 |
| `knowledgeBaseIds` | `string[]` | 否 | 指定知识库 ID。省略或 `[]` 表示全部知识库。 |
| `topK` | `number` | 否 | 返回数量，建议 1-20，服务端最大 50。 |
| `favoriteOnly` | `boolean` | 否 | `true` 时只搜索收藏文档。 |

响应示例：

```json
{
  "query": "向量化",
  "mode": "keyword",
  "total": 1,
  "results": [
    {
      "chunkId": "doc_01:0",
      "knowledgeBaseId": "kb_01",
      "documentId": "doc_01",
      "title": "向量化方案",
      "originalName": "vector-plan.md",
      "sourceType": "markdown",
      "location": "正文",
      "snippet": "第一版向量化应做成可扩展插件能力...",
      "score": 12,
      "tags": [],
      "isFavorite": false
    }
  ]
}
```

## GET /api/tiggyknowledge/documents/:id/read

用于读取文档正文，适合作为智能体回答时的上下文来源。

```bash
curl -H "Authorization: Bearer <access-key>" \
  "http://127.0.0.1:3210/api/tiggyknowledge/documents/doc_01/read?offset=0&maxCharacters=20000"
```

查询参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `offset` | `number` | 否 | 从第几个字符开始读取，默认 0；续读时使用上一次响应的 `nextOffset`。 |
| `maxCharacters` | `number` | 否 | 最多返回字符数，默认 20000，范围 1-100000。 |

响应示例：

```json
{
  "documentId": "doc_01",
  "knowledgeBaseId": "kb_01",
  "title": "向量化方案",
  "originalName": "vector-plan.md",
  "sourceType": "markdown",
  "content": "文档正文...",
  "offset": 0,
  "returnedCharacters": 20000,
  "totalCharacters": 830000,
  "hasMore": true,
  "nextOffset": 20000,
  "sourceTruncated": false,
  "truncated": true,
  "pageCount": 12
}
```

如果文档不在当前访问 Key 允许的知识库范围内，返回空内容：

```json
{
  "available": false,
  "documentId": "doc_01",
  "knowledgeBaseId": "",
  "title": "",
  "originalName": "",
  "sourceType": "text",
  "content": "",
  "offset": 0,
  "returnedCharacters": 0,
  "totalCharacters": 0,
  "hasMore": false,
  "sourceTruncated": false,
  "truncated": false
}
```

## GET /api/tiggyknowledge/documents/:id/okf

用于读取文档的 OKF 映射，适合做引用、来源标注、知识拼接。

```bash
curl -H "Authorization: Bearer <access-key>" \
  "http://127.0.0.1:3210/api/tiggyknowledge/documents/doc_01/okf?maxCharacters=20000"
```

查询参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `maxCharacters` | `number` | 否 | 最多返回 OKF concept body 字符数，默认 20000，范围 1-100000。 |

响应结构由当前 OKF mapping 插件提供，至少包含文档对应的 concept 信息和可引用正文。

如果文档不在当前访问 Key 允许的知识库范围内，返回一个空 OKF 映射，其中 `concept.body` 为空，且不包含来源信息。

## 智能体接入建议

建议外部智能体映射成这 5 个工具：

- `knowledge_status`
- `knowledge_list_libraries`
- `knowledge_search`
- `knowledge_read`
- `knowledge_okf`

推荐流程：

1. 用户未启用知识库时，不注入任何知识库上下文。
2. 启用后先调用 `knowledge_status`，确认服务在线。
3. 用户选择“全部知识库”时，搜索请求传 `knowledgeBaseIds: []` 或省略该字段。
4. 用户选择具体知识库时，搜索请求传对应 `knowledgeBaseIds`。
5. 搜索只拿线索；需要回答依据时，再用 `knowledge_read` 或 `knowledge_okf` 读取正文。
6. `knowledge_read` 返回 `hasMore: true` 时，继续传入响应中的 `nextOffset`，直到 `hasMore: false`。

## 错误码

| HTTP | code | 说明 |
|---:|---|---|
| 401 | `missing_tiggyknowledge_access_key` | 缺少访问 Key。 |
| 403 | `invalid_tiggyknowledge_access_key` | 访问 Key 无效。 |
| 400 | `invalid_tiggyknowledge_query` | 搜索参数不合法。 |
| 400 | `invalid_limit` | `maxCharacters` 不合法。 |
| 400 | `invalid_offset` | `offset` 不是大于或等于 0 的安全整数。 |
| 404 | `document_not_found` | 文档不存在。 |

## 后续扩展

- 导出 OpenAPI / JSON Schema。
- 为更多智能体提供参考 connector。
- 增加写入类接口，例如创建笔记、打标签、导入文件。
