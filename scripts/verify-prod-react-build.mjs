#!/usr/bin/env node
// 三端生产构建产物里不许出现 React 开发版标记 jsxDEV。
// 10/4 W-118：在 export NODE_ENV=development 的 shell 里跑 vite build，Vite 照样说 building for production，
// 但 React 取的是开发版，StrictMode 会把挂载副作用执行两遍，造出「同一份文件建两条任务」的假象。
// 用法：先构建 kiosk、admin、partner，再运行本脚本；可传目录覆盖默认值（测试用）。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dists = process.argv.slice(2).length > 0
  ? process.argv.slice(2).map((dir) => resolve(dir))
  : ['apps/kiosk/dist', 'apps/admin/dist', 'apps/partner/dist'].map((dir) => join(root, dir))

function jsFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...jsFiles(full))
    else if (name.endsWith('.js')) out.push(full)
  }
  return out
}

let failed = false
for (const dist of dists) {
  if (!existsSync(dist)) {
    console.error(`FAIL ${dist} 不存在：先构建再检查`)
    failed = true
    continue
  }
  const files = jsFiles(dist)
  if (files.length === 0) {
    console.error(`FAIL ${dist} 里没有 JS 产物`)
    failed = true
    continue
  }
  const dev = files.filter((file) => readFileSync(file, 'utf8').includes('jsxDEV'))
  if (dev.length > 0) {
    console.error(`FAIL ${dist}：${dev.length} 个文件含 jsxDEV（React 开发版），构建时 shell 里是不是带着 NODE_ENV=development？`)
    failed = true
  } else {
    console.log(`PASS ${dist}：${files.length} 个 JS 文件，jsxDEV 0 处`)
  }
}
process.exit(failed ? 1 : 0)
