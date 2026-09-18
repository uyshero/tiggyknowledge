import * as React from 'react'
import * as JSXRuntime from 'react/jsx-runtime'
import * as JSXDevRuntime from 'react/jsx-dev-runtime'
import * as Cordis from '@deepseek-ai/cordis'
import * as ClientRuntime from '@tiggyknowledge/client-runtime'
import * as ClientConnection from '@tiggyknowledge/client-connection'

declare global {
  var __TIGGY_PLUGIN_EXTERNALS__: Record<string, unknown>
}

export function installPluginExternals(): void {
  globalThis.__TIGGY_PLUGIN_EXTERNALS__ = {
    'react': React,
    'react/jsx-runtime': JSXRuntime,
    'react/jsx-dev-runtime': JSXDevRuntime,
    '@deepseek-ai/cordis': Cordis,
    '@tiggyknowledge/client-runtime': ClientRuntime,
    '@tiggyknowledge/client-connection': ClientConnection,
  }
}
