import { cp, mkdir, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(desktopRoot, '../..')
const projectRoot = resolve(desktopRoot, '.packaged/project')
const deployRoot = resolve(tmpdir(), `tiggyknowledge-deploy-${process.pid}-${Date.now()}`)

await rm(projectRoot, { recursive: true, force: true })
execFileSync('pnpm', ['deploy', '--filter', '@tiggyknowledge/cli', '--prod', deployRoot, '--legacy', '--config.confirmModulesPurge=false'], {
  cwd: workspaceRoot,
  env: { ...process.env, CI: 'true' },
  stdio: 'inherit',
})
await cp(deployRoot, projectRoot, { recursive: true })
await rm(deployRoot, { recursive: true, force: true })
await mkdir(resolve(projectRoot, 'packages/bundle/local'), { recursive: true })
await cp(
  resolve(workspaceRoot, 'packages/bundle/local/cordis.patch.yml'),
  resolve(projectRoot, 'packages/bundle/local/cordis.patch.yml'),
)
await mkdir(resolve(projectRoot, 'apps/web'), { recursive: true })
await cp(resolve(workspaceRoot, 'apps/web/dist'), resolve(projectRoot, 'apps/web/dist'), { recursive: true })
console.log(`desktop: prepared Host resources at ${projectRoot}`)
