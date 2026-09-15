import { cp, mkdir, rm } from 'node:fs/promises'
import { lstatSync, realpathSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import { dirname, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(desktopRoot, '../..')
const projectRoot = resolve(desktopRoot, '.packaged/project')
const deployRoot = resolve(tmpdir(), `tiggyknowledge-deploy-${process.pid}-${Date.now()}`)
const deployArgs = ['deploy', '--filter', '@tiggyknowledge/cli', '--prod', deployRoot, '--legacy', '--config.confirmModulesPurge=false']
const deployOptions = {
  cwd: workspaceRoot,
  env: { ...process.env, CI: 'true' },
  stdio: 'inherit',
}

await rm(projectRoot, { recursive: true, force: true })
if (process.platform === 'win32') {
  // .cmd shims require cmd.exe. Keep the command static and pass the generated
  // destination through the environment to avoid shell argument interpolation.
  execSync('pnpm.cmd deploy --filter @tiggyknowledge/cli --prod "%TIGGYKNOWLEDGE_DEPLOY_ROOT%" --legacy --config.confirmModulesPurge=false', {
    ...deployOptions,
    env: { ...deployOptions.env, TIGGYKNOWLEDGE_DEPLOY_ROOT: deployRoot },
  })
} else {
  execFileSync('pnpm', deployArgs, deployOptions)
}
const deployRealRoot = realpathSync(deployRoot)
const deployPrefix = deployRealRoot + sep
const copyFilter = (source) => {
  try {
    if (!lstatSync(source).isSymbolicLink()) return true
    const target = realpathSync(source)
    return target === deployRealRoot || target.startsWith(deployPrefix)
  } catch {
    return false
  }
}
// pnpm deploy uses symlinks for workspace packages. Dereference them while
// copying so Windows does not require Developer Mode or administrator rights.
await cp(deployRoot, projectRoot, { recursive: true, dereference: true, filter: copyFilter })

// pnpm deploy leaves workspace-only transitive packages as external links.
// Copy the shared runtime package into the deploy tree so ESM resolution stays
// self-contained after the temporary deploy directory is removed.
for (const [source, destination] of [
  ['vendor/cosmokit', 'node_modules/@deepseek-ai/cosmokit'],
  ['vendor/schemastery', 'node_modules/@deepseek-ai/schemastery'],
]) {
  await cp(resolve(workspaceRoot, source), resolve(projectRoot, destination), {
    recursive: true,
    dereference: true,
  })
}

await rm(deployRoot, { recursive: true, force: true })
await mkdir(resolve(projectRoot, 'packages/bundle/local'), { recursive: true })
await cp(
  resolve(workspaceRoot, 'packages/bundle/local/cordis.patch.yml'),
  resolve(projectRoot, 'packages/bundle/local/cordis.patch.yml'),
)
await mkdir(resolve(projectRoot, 'apps/web'), { recursive: true })
await cp(resolve(workspaceRoot, 'apps/web/dist'), resolve(projectRoot, 'apps/web/dist'), { recursive: true })
console.log(`desktop: prepared Host resources at ${projectRoot}`)
