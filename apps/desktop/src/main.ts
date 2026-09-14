import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/webserver'

type CliModule = typeof import('@tiggyknowledge/cli')

let host: Context | undefined
let window: BrowserWindow | undefined
let stopping = false

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

function projectRoot(): string {
  if (app.isPackaged) return resolve(process.resourcesPath, 'project')
  return resolve(import.meta.dirname, '../../..')
}

function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

async function loadCli(): Promise<CliModule> {
  if (!app.isPackaged) return await import('@tiggyknowledge/cli')
  return await import(pathToFileURL(resolve(projectRoot(), 'lib/index.js')).href)
}

async function createWindow(): Promise<void> {
  if (host === undefined) throw new Error('desktop: host is not running')

  if (window !== undefined) {
    if (window.isMinimized()) window.restore()
    window.focus()
    return
  }

  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'TiggyKnowledge',
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const localOrigin = new URL(host.webServer.url).origin
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isSameOrigin(url, localOrigin)) event.preventDefault()
  })
  window.on('closed', () => {
    window = undefined
  })
  await window.loadURL(host.webServer.url)
  window.once('ready-to-show', () => window?.show())
}

function installApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'TiggyKnowledge',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '文件',
      submenu: [
        { label: '新建窗口', accelerator: 'CmdOrCtrl+N', click: () => void createWindow().catch(handleStartupError) },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function stopHost(): Promise<void> {
  if (host === undefined) return
  const current = host
  host = undefined
  await current.fiber.dispose()
}

async function start(): Promise<void> {
  if (!hasSingleInstanceLock) return
  await app.whenReady()
  app.setName('TiggyKnowledge')
  installApplicationMenu()

  app.on('second-instance', () => {
    void createWindow().catch(handleStartupError)
  })

  const root = projectRoot()
  const dataRoot = app.getPath('userData')
  const configuredPort = Number(process.env.TIGGYKNOWLEDGE_DESKTOP_PORT ?? 3210)
  if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) {
    throw new Error(`desktop: invalid TIGGYKNOWLEDGE_DESKTOP_PORT: ${String(configuredPort)}`)
  }

  const { boot } = await loadCli()
  host = await boot([], {
    projectRoot: root,
    dataRoot,
    distRoot: resolve(root, 'apps/web/dist'),
    port: configuredPort,
  })
  try {
    await createWindow()
  } catch (error) {
    await stopHost()
    throw error
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  void createWindow().catch(handleStartupError)
})

app.on('before-quit', event => {
  if (stopping || host === undefined) return
  event.preventDefault()
  stopping = true
  void stopHost().finally(() => app.exit(0))
})

function handleStartupError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  dialog.showErrorBox('TiggyKnowledge 启动失败', message)
  app.quit()
}

void start().catch(handleStartupError)
