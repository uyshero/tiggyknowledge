# Desktop Client

The desktop client is an Electron shell around the existing TiggyKnowledge Host
and Web UI. The renderer stays browser-like (`nodeIntegration: false`,
`contextIsolation: true`, and `sandbox: true`), while the Electron main process
starts and stops the local Host service.

## Development

Build the Host and Web UI, compile the Electron main process, and launch the
desktop shell from the repository root:

```sh
pnpm desktop:dev
```

The default Host port is `3210`. Set `TIGGYKNOWLEDGE_DESKTOP_PORT` to use a
different stable port. Keep the port stable when using the DSH connector, whose
default endpoint is `http://127.0.0.1:3210`.

## Data location

Desktop runtime data is stored in Electron's per-user `userData` directory,
not beside the installed application. The Host API and DSH connector continue
to use the same `/api/tiggyknowledge/*` HTTP contract.

## Packaging status

`pnpm desktop:dist` prepares a standalone Host resource tree and invokes
Electron Builder for macOS, Windows, and Linux targets. Code signing and
automatic update publishing still need to be configured before distributing
installers.
