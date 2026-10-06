#!/usr/bin/env node
// 一体机网页字体（思源宋体 / 思源黑体子集）门禁。
//
// 为什么要有：一体机是 Windows，系统里没有思源字体，字体栈会退到宋体 SimSun 和微软雅黑，
// 和青序流光稿的宋体标题、黑体正文不是一回事。子集只收了 GB2312 + 当时源码里出现的字，
// 以后新文案里出现子集外的字，那一个字会退回系统字体，标题里一个字粗细不一样，肉眼很难发现。
//
// 检查：
// 1. 一体机与共享包源码里出现的汉字和中文标点，全部在 chars.txt 里（漏了就重跑生成脚本）。
// 2. 字体声明里每个 url 指向真实文件，目录里每个 woff2 都被引用；文件是 WOFF2、单个不超过 1MB。
// 3. 字族名不用 OFL 保留名「Source」（子集是修改版，OFL 1.1 第 3 条），两份许可证都在。
// 4. 入口样式引入了字体声明；青序壳的宋体 / 黑体令牌把 Qingxu Serif / Qingxu Sans 排进字体栈。
// 5. 若已有正式构建产物（CI 在构建之后跑），产物里也有这些字体文件。
//
// 重新生成：python3 apps/kiosk/scripts/fonts/build_source_han_subset.py <放 Adobe CN 子集 OTF 的目录>
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FONT_DIR = 'apps/kiosk/public/fonts/source-han'
const CSS = 'apps/kiosk/src/styles/fonts/source-han.css'
const ENTRY = 'apps/kiosk/src/index.css'
const TOKENS = 'apps/kiosk/src/styles/qingxu/tokens.css'
const DIST_FONT_DIR = 'apps/kiosk/dist/fonts/source-han'
const SCAN_ROOTS = ['apps/kiosk/src', 'apps/kiosk/index.html', 'packages/shared/src']
const SCAN_EXT = /\.(ts|tsx|css|html|json|mjs)$/
const LIMIT = 1024 * 1024

const failures = []
const fail = (message) => failures.push(message)
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// 汉字（含扩展 A）、中文标点、全角符号。拉丁字母与 emoji 不在子集承诺之内。
const needsSubset = (code) =>
  (code >= 0x3000 && code <= 0x303f) || (code >= 0x3400 && code <= 0x9fff) || (code >= 0xff01 && code <= 0xff5e)

const chars = new Set(read(`${FONT_DIR}/chars.txt`))
if (chars.size < 6763) fail(`chars.txt 只有 ${chars.size} 个字符，少于 GB2312 的 6763 个汉字，生成脚本可能没跑完`)

const files = execFileSync('git', ['ls-files', ...SCAN_ROOTS], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((file) => SCAN_EXT.test(file))
if (files.length < 100) fail(`只扫到 ${files.length} 个源码文件，遍历坏了`)
const missing = new Map()
for (const file of files) {
  const text = read(file)
  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (needsSubset(code) && !chars.has(ch) && !missing.has(ch)) missing.set(ch, file)
  }
}
if (missing.size > 0) {
  const sample = [...missing].slice(0, 20).map(([ch, file]) => `「${ch}」(${file})`).join('、')
  fail(`${missing.size} 个字不在字体子集里：${sample}。请重跑 build_source_han_subset.py`)
}

const css = read(CSS)
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1])
if (faces.length !== 18) fail(`字体声明应有 18 条（6 个字重 × 3 段），实际 ${faces.length}`)
const referenced = new Set()
for (const face of faces) {
  const family = face.match(/font-family:\s*'([^']+)'/)?.[1] ?? ''
  if (!/^Qingxu (Serif|Sans)$/.test(family)) fail(`字族名「${family}」不是 Qingxu Serif / Qingxu Sans`)
  if (/source/i.test(family)) fail(`字族名「${family}」用了 OFL 保留名 Source`)
  if (!/unicode-range:/.test(face)) fail(`字族「${family}」有一条声明没有 unicode-range，会把同字重的其他段盖掉`)
  const url = face.match(/url\('\/fonts\/source-han\/([^']+)'\)/)?.[1]
  if (!url) {
    fail(`字族「${family}」有一条声明的 url 不在 /fonts/source-han/ 下`)
    continue
  }
  referenced.add(url)
}
const woffs = fs.readdirSync(path.join(root, FONT_DIR)).filter((name) => name.endsWith('.woff2'))
for (const name of referenced) if (!woffs.includes(name)) fail(`字体声明引用的 ${name} 不存在（线上会被单页兜底成 index.html）`)
for (const name of woffs) {
  if (!referenced.has(name)) fail(`${name} 没有被字体声明引用`)
  const bytes = fs.readFileSync(path.join(root, FONT_DIR, name))
  if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') fail(`${name} 不是 WOFF2 文件`)
  if (bytes.length > LIMIT) fail(`${name} ${(bytes.length / 1024).toFixed(0)} KB，超过单文件 1MB`)
}

for (const license of ['LICENSE-SourceHanSerif.txt', 'LICENSE-SourceHanSans.txt']) {
  const file = path.join(root, FONT_DIR, license)
  if (!fs.existsSync(file) || !fs.readFileSync(file, 'utf8').includes('SIL OPEN FONT LICENSE')) {
    fail(`缺少 OFL 许可证 ${license}`)
  }
}

if (!/@import\s+"\.\/styles\/fonts\/source-han\.css";/.test(read(ENTRY))) fail('入口样式没有引入 styles/fonts/source-han.css')
const tokens = read(TOKENS)
if (!/--qx-serif:\s*'Qingxu Serif'/.test(tokens)) fail('--qx-serif 第一位不是 Qingxu Serif')
if (!/--qx-sans:[^;]*'Qingxu Sans'[^;]*'Microsoft YaHei'/.test(tokens)) fail('--qx-sans 没有把 Qingxu Sans 排在微软雅黑之前')

const distDir = path.join(root, DIST_FONT_DIR)
if (fs.existsSync(path.join(root, 'apps/kiosk/dist'))) {
  for (const name of woffs) if (!fs.existsSync(path.join(distDir, name))) fail(`构建产物里缺 fonts/source-han/${name}`)
}

if (failures.length > 0) {
  console.error('verify:kiosk-font-subset 失败：')
  for (const message of failures) console.error(`  ✗ ${message}`)
  process.exit(1)
}
console.log(`verify:kiosk-font-subset 通过：${files.length} 个源码文件的用字都在子集（${chars.size} 字）里，${faces.length} 条字体声明、${woffs.length} 个文件对得上`)
