# 智能体接入

TiggyKnowledge 提供一组面向外部智能体的只读知识库接口。deepseek-harness / DSH 只是参考接入方，不是接口命名空间。

## Base URL

所有路径都相对于 Base URL。本机默认：

```text
http://127.0.0.1:3210
```

完整示例：

```text
http://127.0.0.1:3210/api/tiggyknowledge/search
```

## GET /api/capabilities

先读取能力声明，再决定是否启用知识库工具。该接口不返回知识内容，也不需要访问 Key。

```bash
curl http://127.0.0.1:3210/api/capabilities
```

响应包含协议版本、认证方式、只读操作列表和当前搜索模式。例如：

```json
{
  "product": "tiggyknowledge",
  "version": "0.0.1",
  "capabilities": {
    "protocolVersion": 1,
    "basePath": "/api/tiggyknowledge",
    "authentication": "bearer",
    "operations": [
      { "id": "search", "method": "POST", "path": "/api/tiggyknowledge/search", "readOnly": true }
    ],
    "searchModes": ["keyword"],
    "referenceSchemes": ["tk://local"],
    "write": false
  },
  "hostPlugins": []
}
```

## 认证

公开只读接口统一使用 Bearer Token：

```http
Authorization: Bearer <access-key>
```

访问 Key 在「设置 → 智能体集成」中生成。明文只显示一次，之后只保留预览值和哈希。

Key 受默认知识库范围约束：

- 选择「全部知识库」时，可以访问全部知识库。
- 选择具体知识库时，只能列出、搜索、读取这些库中的文档。
- 搜索会与允许范围取交集；越界知识库返回空结果。
- `read` / `okf` 越界时返回 200 空内容，不暴露标题、原文件名等元信息。

## 接口总览

公开只读接口只使用 `/api/tiggyknowledge/*`。

| 能力 | 方法 | 路径 |
| --- | --- | --- |
| 状态检查 | GET | `/api/tiggyknowledge/status` |
| 知识库列表 | GET | `/api/tiggyknowledge/libraries` |
| 知识库搜索 | POST | `/api/tiggyknowledge/search` |
| 文档读取 | GET | `/api/tiggyknowledge/documents/:id/read` |
| OKF 映射 | GET | `/api/tiggyknowledge/documents/:id/okf` |

## GET /api/tiggyknowledge/status

确认服务是否在线，以及当前知识库能力是否可用。

```bash
curl -H "Authorization: Bearer <access-key>" \
  http://127.0.0.1:3210/api/tiggyknowledge/status
```

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

让智能体展示或选择知识库。

```bash
curl -H "Authorization: Bearer <access-key>" \
  http://127.0.0.1:3210/api/tiggyknowledge/libraries
```

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

按关键词搜索。第一版是关键词检索；向量检索可以作为后续插件扩展。

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

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | `string` | 是 | 搜索词。 |
| `knowledgeBaseIds` | `string[]` | 否 | 指定知识库 ID。省略或 `[]` 表示全部知识库。 |
| `topK` | `number` | 否 | 返回数量，建议 1–20，服务端最大 50。 |
| `favoriteOnly` | `boolean` | 否 | `true` 时只搜索收藏文档。 |

响应包含 `reference.uri`（本地格式为 `tk://local/<knowledgeBaseId>/<documentId>`）、标题、摘要和分数。

## GET /api/tiggyknowledge/documents/:id/read

读取文档正文，适合作为回答上下文。

```bash
curl -H "Authorization: Bearer <access-key>" \
  "http://127.0.0.1:3210/api/tiggyknowledge/documents/doc_01/read?offset=0&maxCharacters=20000"
```

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `offset` | `number` | 否 | 起始字符，默认 0；续读使用上次的 `nextOffset`。 |
| `maxCharacters` | `number` | 否 | 最多返回字符数，默认 20000，范围 1–100000。 |

若 `hasMore` 为 `true`，继续传入 `nextOffset` 直到结束。文档不在 Key 允许范围内时返回空内容，`available` 为 `false`。

## GET /api/tiggyknowledge/documents/:id/okf

读取文档的 OKF 映射，适合引用、来源标注和知识拼接。

```bash
curl -H "Authorization: Bearer <access-key>" \
  "http://127.0.0.1:3210/api/tiggyknowledge/documents/doc_01/okf?maxCharacters=20000"
```

`maxCharacters` 限制 concept body 长度，默认 20000。允许访问时响应包含与搜索、读取相同的 `reference` 对象。越界时返回空映射，且不带来源信息。

## 推荐工具映射

建议把接口映射成这 5 个工具：

- `knowledge_status`
- `knowledge_list_libraries`
- `knowledge_search`
- `knowledge_read`
- `knowledge_okf`

推荐流程：

1. 用户未启用知识库时，不注入任何知识库上下文。
2. 启用后先调用 `knowledge_status`，确认服务在线。
3. 选择全部知识库时，搜索传 `knowledgeBaseIds: []` 或省略该字段。
4. 选择具体知识库时，传入对应 ID。
5. 搜索只拿线索；需要依据时再用 `knowledge_read` 或 `knowledge_okf` 读正文。
6. `hasMore: true` 时按 `nextOffset` 续读。
7. 标注来源时保留 `reference.uri`，不要绑定当前 HTTP 端口。

## 错误码

| HTTP | code | 说明 |
| --- | --- | --- |
| 401 | `missing_tiggyknowledge_access_key` | 缺少访问 Key。 |
| 403 | `invalid_tiggyknowledge_access_key` | 访问 Key 无效。 |
| 400 | `invalid_tiggyknowledge_query` | 搜索参数不合法。 |
| 400 | `invalid_limit` | `maxCharacters` 不合法。 |
| 400 | `invalid_offset` | `offset` 不是大于或等于 0 的安全整数。 |
| 404 | `document_not_found` | 文档不存在。 |
