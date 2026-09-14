# Vendored Cordis Snapshot

This directory is a source snapshot copied from DeepSeek Harness commit
`47f943859bef60e4160492346772ded9b24f765a`. tiggyknowledge builds and ships
these packages itself and does not require a DeepSeek Harness checkout at
runtime.

| Directory | Package | Version |
|---|---|---|
| `cosmokit` | `@deepseek-ai/cosmokit` | 1.8.2 |
| `schemastery` | `@deepseek-ai/schemastery` | 3.18.1 |
| `cordis` | `@deepseek-ai/cordis` | 4.0.1 |
| `loader` | `@deepseek-ai/cordis-plugin-loader` | 1.0.2 |
| `include` | `@deepseek-ai/cordis-plugin-include` | 1.0.6 |
| `group` | `@deepseek-ai/cordis-plugin-group` | 1.0.1 |
| `timer` | `@deepseek-ai/cordis-plugin-timer` | 1.1.3 |
| `hmr` | `@deepseek-ai/cordis-plugin-hmr` | 1.0.16 |
| `logger-console` | `@deepseek-ai/cordis-plugin-logger-console` | 1.0.1 |

Every package retains its upstream MIT license. Update this snapshot as one
reviewed change: copy all nine package directories from the selected DSH
baseline, update the commit and versions above, then run `pnpm check`.
