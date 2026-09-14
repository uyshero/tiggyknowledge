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

The desktop client enforces a single running instance. Launching it again brings
the existing window to the foreground. On macOS, closing the window keeps the
application available from the dock; selecting it again recreates the window
without restarting the Host. The native menu provides new-window, reload,
zoom, full-screen, and developer-tools commands.

## Data location

Desktop runtime data is stored in Electron's per-user `userData` directory,
not beside the installed application. The Host API and DSH connector continue
to use the same `/api/tiggyknowledge/*` HTTP contract.

## Packaging status

`pnpm desktop:dist` prepares a standalone Host resource tree and invokes
Electron Builder for macOS, Windows, and Linux targets. Code signing and
automatic update publishing still need to be configured before distributing
installers.

The macOS DMG is emitted at `apps/desktop/dist/TiggyKnowledge-0.0.1.dmg`.
The local build has been verified by launching the packaged app and checking
`GET /api/health`; it is currently unsigned and will show the usual macOS
unidentified-developer warning until a Developer ID certificate is configured.
