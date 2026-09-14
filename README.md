# tiggyknowledge

Local-first OKF knowledge base built on vendored Cordis. The first milestone
validates one configuration-driven Host plugin tree and one independent
browser Cordis tree.

## Development

Requirements: Node.js `^22.19.0 || >=24.0.0` and pnpm 11.7.

```sh
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3210`. Runtime data is written under `app-data/`.

The shipped Host composition is `packages/bundle/local/cordis.patch.yml`.
Additional structural overrides can be supplied with `--patch <path>`.

## Planning

- [deepseek harness integration plan](docs/deepseek-harness-integration-plan.md)
- [vNext local/cloud plugin architecture](docs/vnext-local-cloud-plugin-architecture.md)
