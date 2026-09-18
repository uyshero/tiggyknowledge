const REACT_EXPORTS = [
  'Children',
  'Component',
  'Fragment',
  'Profiler',
  'PureComponent',
  'StrictMode',
  'Suspense',
  'act',
  'cloneElement',
  'createContext',
  'createElement',
  'createFactory',
  'createRef',
  'forwardRef',
  'isValidElement',
  'lazy',
  'memo',
  'startTransition',
  'unstable_act',
  'useCallback',
  'useContext',
  'useDebugValue',
  'useDeferredValue',
  'useEffect',
  'useId',
  'useImperativeHandle',
  'useInsertionEffect',
  'useLayoutEffect',
  'useMemo',
  'useReducer',
  'useRef',
  'useState',
  'useSyncExternalStore',
  'useTransition',
  'version',
] as const

const JSX_RUNTIME_EXPORTS = ['Fragment', 'jsx', 'jsxs', 'jsxDEV'] as const

const CORDIS_EXPORTS = [
  'Context',
  'Service',
  'Fiber',
  'FiberState',
  'Inject',
  'Logger',
  'LoggerService',
  'symbols',
] as const

const CLIENT_RUNTIME_EXPORTS = ['ClientAppService'] as const
const CLIENT_CONNECTION_EXPORTS = ['ConnectionService'] as const

export const SHARED_MODULES: Record<string, { key: string, exports: readonly string[] }> = {
  'react.js': { key: 'react', exports: REACT_EXPORTS },
  'react-jsx-runtime.js': { key: 'react/jsx-runtime', exports: JSX_RUNTIME_EXPORTS },
  'react-jsx-dev-runtime.js': { key: 'react/jsx-dev-runtime', exports: JSX_RUNTIME_EXPORTS },
  'cordis.js': { key: '@deepseek-ai/cordis', exports: CORDIS_EXPORTS },
  'client-runtime.js': { key: '@tiggyknowledge/client-runtime', exports: CLIENT_RUNTIME_EXPORTS },
  'client-connection.js': { key: '@tiggyknowledge/client-connection', exports: CLIENT_CONNECTION_EXPORTS },
}

export function sharedModuleSource(filename: string): string | undefined {
  const module = SHARED_MODULES[filename]
  if (module === undefined) return undefined
  const key = JSON.stringify(module.key)
  const named = module.exports.map(name => `export const ${name} = ns[${JSON.stringify(name)}];`).join('\n')
  return `const ns = globalThis.__TIGGY_PLUGIN_EXTERNALS__?.[${key}];
if (ns == null) throw new Error(${JSON.stringify(`plugin client externals missing: ${module.key}`)});
${named}
export default ns.default ?? ns;
`
}
