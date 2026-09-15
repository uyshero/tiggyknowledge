import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifests = [
  'package.json',
  'apps/cli/package.json',
  'apps/desktop/package.json',
]
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

async function readManifest(filename) {
  const path = resolve(root, filename)
  return { filename, path, value: JSON.parse(await readFile(path, 'utf8')) }
}

async function check(expectedVersion) {
  const values = await Promise.all(manifests.map(readManifest))
  const version = expectedVersion ?? values[0].value.version
  if (typeof version !== 'string' || !versionPattern.test(version)) {
    throw new Error(`invalid version: ${String(version)}`)
  }
  const mismatches = values.filter(item => item.value.version !== version)
  if (mismatches.length > 0) {
    throw new Error(`version mismatch: expected ${version}; ${mismatches.map(item => `${item.filename}=${String(item.value.version)}`).join(', ')}`)
  }
  process.stdout.write(`tiggyknowledge: version ${version}\n`)
}

async function setVersion(version) {
  if (typeof version !== 'string' || !versionPattern.test(version)) {
    throw new Error('usage: pnpm version:set <major.minor.patch>')
  }
  const values = await Promise.all(manifests.map(readManifest))
  await Promise.all(values.map(async item => {
    item.value.version = version
    await writeFile(item.path, `${JSON.stringify(item.value, null, 2)}\n`)
  }))
  await check(version)
}

const [command, version] = process.argv.slice(2)
if (command === 'check') {
  await check(version?.replace(/^v/, ''))
} else if (command === 'set') {
  await setVersion(version)
} else {
  throw new Error('usage: node scripts/version.mjs <check|set> [version]')
}
