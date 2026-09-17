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

## Official website

The marketing and documentation site lives in `apps/site` and is independent of
the product Web UI.

```sh
pnpm site:dev
```

Open `http://127.0.0.1:4321`. Production builds set `SITE_BASE=/tiggyknowledge/`
for GitHub Pages.

## Desktop client

The Electron desktop shell reuses the Host and Web UI while keeping Node.js
disabled in the renderer. Start it with:

```sh
pnpm desktop:dev
```

See [desktop client](docs/desktop-client.md) for data location, port, DSH
integration, and packaging details.

To publish a new desktop version, follow the copy-ready commands in
[RELEASE.md](RELEASE.md).

## Planning

- [deepseek harness integration plan](docs/deepseek-harness-integration-plan.md)
- [vNext local/cloud plugin architecture](docs/vnext-local-cloud-plugin-architecture.md)
