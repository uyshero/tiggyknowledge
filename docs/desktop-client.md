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
Electron Builder for the current platform. Code signing and automatic update
publishing still need to be configured before distributing installers.

To build the Windows installer explicitly from the repository root, run:

```sh
pnpm desktop:win
```

The NSIS installer is emitted under `apps/desktop/dist/`, typically as
`TiggyKnowledge Setup 0.0.1.exe`. Run this command on Windows for the most
reliable result. macOS can cross-build the Windows target only when the
required Electron Builder Wine tooling is installed; otherwise use a Windows
build machine or CI runner. The first Windows build may be unsigned, so
Windows SmartScreen can show an “unknown publisher” warning until a code-signing
certificate is configured.

The macOS DMG is emitted under `apps/desktop/dist/`, for example
`TiggyKnowledge-0.0.1-mac-universal.dmg`.
The local build has been verified by launching the packaged app and checking
`GET /api/health`; it is currently unsigned and will show the usual macOS
unidentified-developer warning until a Developer ID certificate is configured.

## Releases and update checks

The packaged desktop client checks the latest public GitHub Release shortly
after startup. It only prompts when the release tag contains a newer stable
semantic version. Users can also run **Help → Check for Updates**. This first
stage opens the trusted GitHub Release page and does not install software in
the background.

Keep the root, CLI, and desktop versions synchronized with:

```sh
pnpm version:set 0.1.0
pnpm version:check
```

For the complete copy-ready release sequence, including checks, commit, tag,
push, and post-release verification, see [RELEASE.md](../RELEASE.md).

Commit the version change and push a matching tag to trigger the desktop
release workflow:

```sh
git tag -a v0.1.0 -m "v0.1.0"
git push origin main --follow-tags
```

The workflow validates the version, runs tests, builds Windows and macOS
artifacts, creates `SHA256SUMS.txt`, and uploads everything to the matching
GitHub Release. Builds remain unsigned until platform signing credentials are
configured.
