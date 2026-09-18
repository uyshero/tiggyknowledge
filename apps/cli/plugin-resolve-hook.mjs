import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let productParent
let roots = []

export async function initialize({ port }) {
  port.on('message', message => {
    productParent = message.productParent
    roots = Array.isArray(message.roots) ? message.roots : []
    message.ack?.postMessage('ok')
  })
}

function parentFilePath(url) {
  try {
    return realpathSync(fileURLToPath(url))
  } catch {
    try {
      return fileURLToPath(url)
    } catch {
      return ''
    }
  }
}

export async function resolve(specifier, context, nextResolve) {
  const parent = typeof context.parentURL === 'string' ? parentFilePath(context.parentURL) : ''
  if (
    typeof productParent === 'string'
    && roots.length > 0
    && parent.length > 0
    && (specifier.startsWith('@deepseek-ai/') || specifier.startsWith('@tiggyknowledge/'))
    && roots.some(root => typeof root === 'string' && (parent === root || parent.startsWith(root)))
  ) {
    return nextResolve(specifier, { ...context, parentURL: productParent })
  }
  return nextResolve(specifier, context)
}
