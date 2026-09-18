import { realpathSync } from 'node:fs'
import { register } from 'node:module'
import { sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MessageChannel, type MessagePort } from 'node:worker_threads'

let port: MessagePort | undefined

function ensurePluginResolveHook(): MessagePort {
  if (port !== undefined) return port
  const channel = new MessageChannel()
  port = channel.port1
  register(new URL('../plugin-resolve-hook.mjs', import.meta.url), import.meta.url, {
    data: { port: channel.port2 },
    transferList: [channel.port2],
  })
  return port
}

export async function setExternalPluginResolveContext(cliPackageJson: string, pluginDirectories: string[]): Promise<void> {
  const hookPort = ensurePluginResolveHook()
  const roots = pluginDirectories.map(directory => {
    const resolved = realpathSync(directory)
    return resolved.endsWith(sep) ? resolved : `${resolved}${sep}`
  })
  const ack = new MessageChannel()
  const done = new Promise<void>(resolve => {
    ack.port1.once('message', () => resolve())
  })
  hookPort.postMessage({
    productParent: pathToFileURL(cliPackageJson).href,
    roots,
    ack: ack.port2,
  }, [ack.port2])
  await done
}
