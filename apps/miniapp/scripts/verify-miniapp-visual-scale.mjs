#!/usr/bin/env node
/**
 * 视觉刻度棘轮门禁。
 *
 * 存在的理由：全部页面 wxss 里 20–34rpx 之间曾用了 14 个不同字号，
 * 21 / 23 / 25 / 27 都在大量出现——每页各自挑一个差不多的数。单看没人察觉，
 * 累积起来就是「哪儿都对不齐」。圆角同理：12rpx 区间塞了 8 个值，
 * 而 app.wxss 里 --r-xs..--r-xl 早就定义好了却没人用。
 *
 * 这个门禁**不做批量迁移**。存量页面的字号是在没有视觉验证的情况下写下的，
 * 盲目改一遍是拿观感赌。它只做一件事：**盯着偏离值不再增长**。
 *
 * 基线是当前实测值，写死在下面。新增或改动页面时若偏离数上升，门禁转红，
 * 逼你用 app.wxss 的 --fs-* / --r-* 令牌而不是再挑一个新数。
 * 修好存量页面后可以调低基线——**只允许调低，不允许调高**。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** app.wxss --fs-* 的 rpx 取值 */
const FS_SCALE = new Set([20, 22, 26, 30, 34, 40, 52])
/** app.wxss --r-* 的 px 取值换算成 rpx，加上 999(=--r-full) */
const RADIUS_SCALE = new Set([12, 18, 24, 32, 40, 48, 999])

// 实测基线（2026-09-02）。只允许降，不允许升。
const BASELINE = { fontSize: 439, radius: 181 }

const pageDirs = readdirSync(join(ROOT, 'pages'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)

let fsOff = 0
let rOff = 0
const worst = []

for (const dir of pageDirs) {
  let css
  try {
    css = readFileSync(join(ROOT, 'pages', dir, `${dir}.wxss`), 'utf8')
  } catch {
    continue
  }
  const fs = [...css.matchAll(/font-size:\s*([0-9.]+)rpx/g)]
    .map((m) => Number(m[1]))
    .filter((v) => !FS_SCALE.has(v))
  const r = [...css.matchAll(/border-radius:\s*([0-9.]+)rpx/g)]
    .map((m) => Number(m[1]))
    .filter((v) => !RADIUS_SCALE.has(v))
  fsOff += fs.length
  rOff += r.length
  if (fs.length + r.length > 0) worst.push({ dir, fs: fs.length, r: r.length })
}

worst.sort((a, b) => b.fs + b.r - (a.fs + a.r))

console.log(`偏离字阶 ${fsOff} 处（基线 ${BASELINE.fontSize}）· 偏离圆角阶 ${rOff} 处（基线 ${BASELINE.radius}）`)
console.log(`偏离最多的 5 页：${worst.slice(0, 5).map((w) => `${w.dir}(${w.fs}+${w.r})`).join(' ')}`)

const problems = []
if (fsOff > BASELINE.fontSize) {
  problems.push(`字号偏离 ${fsOff} > 基线 ${BASELINE.fontSize}：新增了 ${fsOff - BASELINE.fontSize} 处不在字阶上的取值，请改用 var(--fs-*)`)
}
if (rOff > BASELINE.radius) {
  problems.push(`圆角偏离 ${rOff} > 基线 ${BASELINE.radius}：新增了 ${rOff - BASELINE.radius} 处不在圆角阶上的取值，请改用 var(--r-*)`)
}
// 基线也不许虚高：修好了就该往下调，否则棘轮会松掉
if (fsOff < BASELINE.fontSize - 20 || rOff < BASELINE.radius - 20) {
  problems.push(`实测已明显低于基线（字号 ${fsOff}/${BASELINE.fontSize}，圆角 ${rOff}/${BASELINE.radius}）：请把 BASELINE 调到当前值，否则棘轮失效`)
}

if (problems.length) {
  console.error('\n✗ 视觉刻度棘轮失败：')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log('\n✓ 视觉刻度未新增偏离')
