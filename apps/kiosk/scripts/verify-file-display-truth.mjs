import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================
// verify:file-display-truth — Kiosk「文件被怎么呈现」真值守卫（批次 REAL-FILE-PRINT）
//
// 由 2026-08-17 真实文件走查产出。造真实 PDF / 图片走 上传→体检→预览，发现两处
// **算错 / 编数字**（不是样式问题，换 V6 皮也还在）：
//
//   1. 用量预估：页数未识别时用 `file.pages ?? 1` 兜底 →「文件页数：待识别」和
//      「总打印面 1 面 / 预计用纸 1 张」出现在同一张卡片上（30 页 PDF 实测）。
//   2. formatBytes：KB 档用 toFixed(0)，1 048 500 B 显示成「1024 KB」而非「1.0 MB」。
//
// 守卫按**行为**验（真的调用被测函数跑数），不是比对源码字符串；
// 上限数字与服务端策略的一致性由 services/api 的 verify:file-display-truth 负责。
// ============================================================

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

let failures = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m) => {
  failures += 1
  console.error(`  FAIL ${m}`)
}
const check = (ok, m) => (ok ? pass(m) : fail(m))

console.log('\n=== Kiosk 文件呈现真值守卫 ===')

// ── 1. 用量预估：页数未识别时不得编数字 ────────────────────────────────────────
// 直接从 TS 源里取出纯函数体求值（kiosk 无 TS 运行时，故做最小类型剥离后 eval）。
const usageSrc = read('src/pages/print/printUsageEstimate.ts')
const fnMatch = usageSrc.match(/export function computePrintUsageEstimate\(([\s\S]*?)\n}\n/)
if (!fnMatch) {
  fail('未找到 computePrintUsageEstimate 纯函数（用量预估必须留在可单测的纯模块里）')
} else {
  const body = `function computePrintUsageEstimate(${fnMatch[1]}\n}`
    .replace(/:\s*PrintUsageEstimate(Input)?\b/g, '')
    .replace(/const unknown\s*=/, 'const unknown =')
  let compute
  try {
    // eslint-disable-next-line no-new-func
    compute = new Function(`${body}; return computePrintUsageEstimate`)()
  } catch (error) {
    fail(`纯函数无法求值：${String(error).slice(0, 120)}`)
  }

  if (compute) {
    const unknown = compute({ pages: null, copies: 1, pagesPerSheet: 1, duplex: 'simplex' })
    check(
      unknown.totalFaces === null && unknown.sheetsUsed === null,
      '页数未识别 → 总打印面/预计用纸均为 null（不兜底成 1 页）',
    )
    const unknownMany = compute({ pages: null, copies: 7, pagesPerSheet: 1, duplex: 'simplex' })
    check(
      unknownMany.totalFaces === null && unknownMany.sheetsUsed === null,
      '页数未识别 + 多份 → 仍不估算',
    )

    const three = compute({ pages: 3, copies: 2, pagesPerSheet: 1, duplex: 'simplex' })
    check(three.totalFaces === 6 && three.sheetsUsed === 6, '3 页 × 2 份 单面 → 6 面 / 6 张')
    const duplexed = compute({ pages: 3, copies: 2, pagesPerSheet: 1, duplex: 'duplex_long_edge' })
    check(
      duplexed.totalFaces === 6 && duplexed.sheetsUsed === 3 && duplexed.paperSaved === 3,
      '3 页 × 2 份 双面 → 6 面 / 3 张 / 省 3 张',
    )
    const odd = compute({ pages: 5, copies: 1, pagesPerSheet: 1, duplex: 'duplex_long_edge' })
    check(odd.totalFaces === 5 && odd.sheetsUsed === 3, '奇数页双面向上取整：5 面 → 3 张')
    const twoUp = compute({ pages: 5, copies: 1, pagesPerSheet: 2, duplex: 'simplex' })
    check(twoUp.totalFaces === 3, '每张 2 页：5 页 → 3 面')
    const p120 = compute({ pages: 120, copies: 3, pagesPerSheet: 1, duplex: 'simplex' })
    check(p120.totalFaces === 360 && p120.sheetsUsed === 360, '120 页 × 3 份 → 360 面 / 360 张')
    for (const bad of [
      { pages: 0, copies: 1, pagesPerSheet: 1, duplex: 'simplex' },
      { pages: 3, copies: 0, pagesPerSheet: 1, duplex: 'simplex' },
      { pages: 3, copies: 1, pagesPerSheet: 0, duplex: 'simplex' },
    ]) {
      const r = compute(bad)
      check(r.totalFaces === null, `非法入参 ${JSON.stringify(bad)} → 不估算`)
    }
  }
}

// 预览页必须把 null 呈现为「待识别」，而不是渲染出 "null 面"
const preview = read('src/pages/print/PrintPreviewPage.tsx')
check(
  !/const effectivePages\s*=\s*file\.pages\s*\?\?\s*1/.test(preview),
  '预览页不再用 `file.pages ?? 1` 兜底页数',
)
check(
  /totalFaces === null \? '待识别/.test(preview) && /sheetsUsed === null \? '待识别/.test(preview),
  '预览页在页数未识别时把总打印面/预计用纸显示为「待识别」',
)
check(
  /computePrintUsageEstimate/.test(preview),
  '预览页用量预估走 printUsageEstimate 纯模块（保证可被本守卫验行为）',
)

// ── 2. formatBytes：单位换算边界 ───────────────────────────────────────────────
const uploadSrc = read('src/pages/print/PrintUploadPage.tsx')
const fmtMatch = uploadSrc.match(/function formatBytes\(bytes: number\): string \{([\s\S]*?)\n\}/)
if (!fmtMatch) {
  fail('未找到 formatBytes')
} else {
  // eslint-disable-next-line no-new-func
  const formatBytes = new Function(`function formatBytes(bytes){${fmtMatch[1]}}; return formatBytes`)()
  const cases = [
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [5052, '5 KB'],
    [136_500, '133 KB'],
    // 关键边界：四舍五入后会变成 1024 KB 的区间必须进位到 MB
    [1_048_500, '1.0 MB'],
    [1_048_064, '1.0 MB'],
    [1_048_576, '1.0 MB'],
    [14_315_434, '13.7 MB'],
  ]
  for (const [input, want] of cases) {
    const got = formatBytes(input)
    check(got === want, `formatBytes(${input}) → "${got}"（期望 "${want}"）`)
  }
  check(!/\b1024 KB\b/.test(formatBytes(1_048_500)), '不再出现「1024 KB」这种未进位显示')
  // 单调性：不得出现「更大的文件显示更小」
  let monotonic = true
  let prev = -1
  for (let b = 1000; b < 1_200_000; b += 977) {
    const parsed = (() => {
      const s = formatBytes(b)
      const n = parseFloat(s)
      return s.endsWith('MB') ? n * 1024 * 1024 : s.endsWith('KB') ? n * 1024 : n
    })()
    if (parsed < prev - 1024) {
      monotonic = false
      break
    }
    prev = parsed
  }
  check(monotonic, 'formatBytes 单调不倒退（更大的文件不会显示成更小）')
}

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项失败\n`)
process.exit(failures === 0 ? 0 : 1)
