# @tiggyknowledge/dsh-connector

DeepSeek Harness reference connector for tiggyknowledge. It registers read-only knowledge tools that call a running tiggyknowledge sidecar over the standard `/api/tiggyknowledge/*` HTTP API.

First version tools:

- `knowledge_status`
- `knowledge_list_libraries`
- `knowledge_search`
- `knowledge_read`
- `knowledge_okf`

Example Cordis patch:

```yaml
- insert:
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

Generate the token in tiggyknowledge: Settings → Agent Integration → Generate Access Key.
Store the generated token in DSH credentials under `TIGGYKNOWLEDGE_TOKEN`.

The connector resolves the token on every tool call. When DSH mounts its credentials service, the value can be managed from DSH's credential-aware settings surfaces and is stored outside ordinary plugin settings. If a local profile has no credentials service yet, exporting `TIGGYKNOWLEDGE_TOKEN` before launching DSH remains a fallback.

When DSH mounts its settings service, the connector also registers a `tiggyknowledge` settings namespace. This exposes `endpoint` and enabled read-only tools to DSH settings/configuration clients; the legacy literal `token` field is marked as a secret and should be left empty. The connector treats `endpoint` as the Base URL and appends the standard `/api/tiggyknowledge/*` paths. Knowledge-base scope is selected per prompt: omit `knowledgeBaseIds` to search all knowledge bases, or pass explicit ids from the composer picker.

For local development, use `deepseek-harness.local.patch.yml` from the `deepseek-harness` repo:

```sh
pnpm dsh --profile headless \
  --patch "../tiggyknowledge/packages/dsh/connector/deepseek-harness.local.patch.yml" \
  "先调用 knowledge_status 看看本地知识库"
```
