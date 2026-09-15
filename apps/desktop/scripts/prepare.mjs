import { cp, mkdir, readdir, rm, symlink, unlink } from 'node:fs/promises'
import { lstatSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(desktopRoot, '../..')
const projectRoot = resolve(desktopRoot, '.packaged/project')
const deployRoot = resolve(tmpdir(), `tiggyknowledge-deploy-${process.pid}-${Date.now()}`)
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

await rm(projectRoot, { recursive: true, force: true })
execFileSync(pnpmCommand, ['deploy', '--filter', '@tiggyknowledge/cli', '--prod', deployRoot, '--legacy', '--config.confirmModulesPurge=false'], {
  cwd: workspaceRoot,
  env: { ...process.env, CI: 'true' },
  // Windows package-manager shims are .cmd files and require a shell to run.
  shell: process.platform === 'win32',
  stdio: 'inherit',
})
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
await cp(deployRoot, projectRoot, { recursive: true, filter: copyFilter })

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

const rewriteInternalLinks = async (sourceDir, destinationDir) => {
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const source = resolve(sourceDir, entry.name)
    const destination = resolve(destinationDir, entry.name)
    if (entry.isSymbolicLink()) {
      let target
      try {
        target = realpathSync(source)
      } catch {
        continue
      }
      if (target !== deployRealRoot && !target.startsWith(deployPrefix)) continue
      const mappedTarget = resolve(projectRoot, target.slice(deployRealRoot.length + 1))
      await unlink(destination)
      await symlink(relative(dirname(destination), mappedTarget), destination)
    } else if (entry.isDirectory()) {
      await rewriteInternalLinks(source, destination)
    }
  }
}

await rewriteInternalLinks(deployRoot, projectRoot)
await rm(deployRoot, { recursive: true, force: true })
await mkdir(resolve(projectRoot, 'packages/bundle/local'), { recursive: true })
await cp(
  resolve(workspaceRoot, 'packages/bundle/local/cordis.patch.yml'),
  resolve(projectRoot, 'packages/bundle/local/cordis.patch.yml'),
)
await mkdir(resolve(projectRoot, 'apps/web'), { recursive: true })
await cp(resolve(workspaceRoot, 'apps/web/dist'), resolve(projectRoot, 'apps/web/dist'), { recursive: true })
console.log(`desktop: prepared Host resources at ${projectRoot}`)
