# @tiggyknowledge/dsh-context

DSH Web composer plugin for TiggyKnowledge. It adds a neutral “知识库” chip to the message composer:

- enable / disable knowledge context per session;
- choose all knowledge bases, selected knowledge bases, or one document;
- send a `knowledgeContext` prompt option through DSH's generic `conversationPromptContext` extension point.

This package is a deployable runtime bundle. A target DSH instance does not need the TiggyKnowledge source tree to use it. Its DSH runtime dependencies are declared in the package `dsh.client.inject` field instead of npm dependencies; they are provided by the target DSH module loader.

## Requirements

The target DSH build must provide:

- `@deepseek-ai/dsh-client-ui-conversation` with `conversationPromptContext`;
- Host `session.prompt` support for optional `knowledgeContext`;
- Host proxy methods exposed to the browser:
  - `tiggyknowledge.libraries`
  - `tiggyknowledge.searchDocuments`

In practice, use the matching DSH build that includes the TiggyKnowledge integration seam.

## Install into a DSH profile

Install this package and the Host connector package into the same DSH profile:

```sh
pnpm dsh plugin --profile web add ./tiggyknowledge-dsh-context-0.0.1.tgz
pnpm dsh plugin --profile web add ./tiggyknowledge-dsh-connector-0.0.1.tgz
```

Then add the plugins to the profile's Cordis patch:

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

Generate an access key in TiggyKnowledge: Settings → Agent Integration → Generate Access Key.
Store it in DSH credentials as `TIGGYKNOWLEDGE_TOKEN`.

## Runtime behavior

When disabled, the plugin injects no prompt context.

When enabled:

- all knowledge bases: sends `{ scope: "all", provider: "tiggyknowledge" }`;
- selected knowledge bases: sends `{ scope: "libraries", knowledgeBaseIds, provider: "tiggyknowledge" }`;
- selected document: sends `{ scope: "document", documentId, title, provider: "tiggyknowledge" }`.

The model-visible retrieval happens through the `knowledge_*` tools provided by `@tiggyknowledge/dsh-connector`.
