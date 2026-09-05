#!/usr/bin/env node
/**
 * 不把 @playwright/test 写进 partner 的 package.json（会改 lockfile，本环境禁止 pnpm）。
 * kiosk 已声明该依赖；这里把同一份二进制链到 partner/node_modules 再跑测试。
 */
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const partnerDir = dirname(dirname(fileURLToPath(import.meta.url)))
const kioskPlaywright = join(partnerDir, '..', 'kiosk', 'node_modules', '@playwright')
const dest = join(partnerDir, 'node_modules', '@playwright')

if (!existsSync(kioskPlaywright)) {
  console.error('找不到 apps/kiosk/node_modules/@playwright。CI 需先安装 kiosk 依赖。')
  process.exit(1)
}

mkdirSync(join(partnerDir, 'node_modules'), { recursive: true })
if (!existsSync(dest)) {
  symlinkSync(kioskPlaywright, dest, 'dir')
}

const cli = join(dest, 'test', 'cli.js')
const result = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  cwd: partnerDir,
  stdio: 'inherit',
  env: process.env,
})
process.exit(result.status ?? 1)
