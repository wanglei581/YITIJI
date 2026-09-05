#!/usr/bin/env node
/**
 * Admin Playwright 入口。本环境禁止 pnpm，且 admin 包未声明 @playwright/test，
 * 因此把 kiosk 已安装的 Playwright 1.55.1 链到本包 node_modules 后再 exec。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const playwrightPkg = resolve(adminRoot, '../kiosk/node_modules/@playwright/test')
const playwrightBin = resolve(adminRoot, '../kiosk/node_modules/.bin/playwright')

if (!existsSync(playwrightPkg) || !existsSync(playwrightBin)) {
  console.error('找不到 apps/kiosk 下的 @playwright/test。Admin E2E 复用 kiosk 已安装的 Playwright，请勿 pnpm install。')
  process.exit(1)
}

const destDir = join(adminRoot, 'node_modules/@playwright')
const dest = join(destDir, 'test')
mkdirSync(destDir, { recursive: true })
rmSync(dest, { recursive: true, force: true })
symlinkSync(playwrightPkg, dest)

const binDir = join(adminRoot, 'node_modules/.bin')
mkdirSync(binDir, { recursive: true })
const localBin = join(binDir, 'playwright')
rmSync(localBin, { force: true })
symlinkSync(playwrightBin, localBin)

const child = spawn(localBin, ['test', ...process.argv.slice(2)], {
  cwd: adminRoot,
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 1)
})
