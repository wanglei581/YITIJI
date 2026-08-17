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

// ── 3. 文件名中段截断：扩展名与尾部区分信息不得丢 ──────────────────────────────
// 2026-08-18 打印域走查：上传页 5 处文件名全用 Tailwind `truncate`（只截尾部），
// 「我的简历_张三_2026版_最终定稿.pdf」显示成「我的简历_张三_2026版_最终...」——
// 扩展名和最能区分文件的尾部一起没了。打印场景用户常在几份相似文件里挑一个，
// 尾部恰恰是唯一区分位，截尾直接影响他选对没有。
// 同样按**行为**验（真的调用被测纯函数跑数），不是比对源码字符串。
const nameSrc = read('src/lib/fileName.ts')
const nameConsts = [
  ...[...nameSrc.matchAll(/^const (\w+) = (.+)$/gm)].map(([, n, v]) => `const ${n} = ${v}`),
  ...[...nameSrc.matchAll(/^export const (\w+) = (.+)$/gm)].map(([, n, v]) => `const ${n} = ${v}`),
].join('\n')
const truncMatch = nameSrc.match(/export function truncateFileNameMiddle\(([\s\S]*?)\n\}/)
if (!truncMatch) {
  fail('未找到 truncateFileNameMiddle 纯函数（中段截断必须留在可单测的纯模块里）')
} else {
  const truncBody = `function truncateFileNameMiddle(${truncMatch[1]}\n}`
    .replace(/fileName:\s*string/, 'fileName')
    .replace(/\}:\s*TruncateFileNameOptions\s*=\s*\{\}/, '} = {}')
    .replace(/\):\s*string\s*\{/, ') {')
  let truncate
  try {
    // eslint-disable-next-line no-new-func
    truncate = new Function(`${nameConsts}\n${truncBody}\nreturn truncateFileNameMiddle`)()
  } catch (error) {
    fail(`中段截断纯函数无法求值：${String(error).slice(0, 160)}`)
  }

  if (truncate) {
    const CARD = 36
    const COMPACT = 24
    // 关键不变量：只要原名有扩展名，截断结果必须仍以该扩展名结尾。
    const longNames = [
      '我的简历_张三_2026版_最终定稿_打印用_请勿外传.pdf',
      'Zhang_San_Resume_Software_Engineer_2026_final_v3.docx',
      '归档.2026.第一季度.岗位材料.汇总.最终.xlsx',
      '身份证正反面扫描件_高清_2026年8月18日补办版.jpeg',
      'a'.repeat(120) + '.png',
      '毕业证书扫描件_中文名字很长很长很长很长很长很长.PDF',
    ]
    for (const name of longNames) {
      for (const budget of [COMPACT, CARD]) {
        const out = truncate(name, { maxLength: budget })
        const ext = name.slice(name.lastIndexOf('.'))
        const overBudget = Array.from(name).length > budget
        check(out.endsWith(ext), `中段截断保住扩展名 ${ext}（budget=${budget}）：${out}`)
        check(
          Array.from(out).length <= budget,
          `中段截断不超预算 ${budget}（实际 ${Array.from(out).length}）：${out}`,
        )
        // 超预算才该出现省略号；没超必须原样返回（不做无谓截断）
        check(
          out.includes('…') === overBudget,
          `${overBudget ? '超预算时做中段截断' : '未超预算时不截断'}（budget=${budget}）：${out}`,
        )
        check(out.startsWith(Array.from(name)[0]), `中段截断保留头部起始字符：${out}`)
      }
    }
    // 未超预算时必须原样返回，不得无谓截断
    for (const short of ['短.pdf', '简历.pdf', 'resume_v2.docx', '我的文件_2026.png']) {
      check(truncate(short, { maxLength: CARD }) === short, `未超预算原样返回：${short}`)
    }
    // 码点安全：中文不得被切出半个字（长度按码点算，且结果可往返）
    const cjk = '打印材料汇总' .repeat(12) + '.pdf'
    const cjkOut = truncate(cjk, { maxLength: CARD })
    check(Array.from(cjkOut).join('') === cjkOut, '中文文件名按码点切分，不产生坏字')
    check(cjkOut.endsWith('.pdf'), '中文超长名同样保住扩展名')
    // 无扩展名时也不得崩，且仍做中段截断
    const noExt = truncate('no-extension-but-a-really-long-file-name-here', { maxLength: CARD })
    check(noExt.includes('…') && noExt.length <= CARD + 1, '无扩展名文件仍能中段截断')
    // 尾部必须真的携带原名尾部信息（区分同前缀文件的关键）
    const a = truncate('求职材料_张三_版本一_2026.pdf', { maxLength: COMPACT })
    const b = truncate('求职材料_张三_版本二_2026.pdf', { maxLength: COMPACT })
    check(a !== b || !a.includes('…'), '同前缀不同尾部的文件截断后仍可区分')
  }
}

// 上传页 5 处文件名必须全部走 helper，不得留裸 `truncate`（只截尾部）
const uploadPage = read('src/pages/print/PrintUploadPage.tsx')
const helperCalls = (uploadPage.match(/truncateFileNameMiddle\(/g) ?? []).length
check(helperCalls === 5, `上传页 5 处文件名全部走中段截断 helper（实际 ${helperCalls} 处）`)
check(
  !/truncate[^"]*"\s*>\s*\{\s*(?:file\.name|f\.filename|item\.fileName)/.test(uploadPage),
  '上传页不再把文件名直接交给裸 `truncate`（尾部截断会吃掉扩展名）',
)
for (const expr of ['file.name', 'f.filename', 'item.fileName']) {
  check(
    new RegExp(`truncateFileNameMiddle\\(\\s*${expr.replace('.', '\\.')}`).test(uploadPage) ||
      new RegExp(`truncateFileNameMiddle\\(${expr.replace('.', '\\.')}`).test(uploadPage),
    `上传页 ${expr} 经中段截断呈现`,
  )
}

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项失败\n`)
process.exit(failures === 0 ? 0 : 1)
