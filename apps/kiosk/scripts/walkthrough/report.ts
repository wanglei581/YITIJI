import { writeFileSync } from 'node:fs'
import type { RouteRow } from './types'

function cell(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return '（无）'
  return text.replace(/\|/g, '\\|')
}

function list(items: string[]): string {
  if (items.length === 0) return '（无）'
  return items.map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ') || '（无）'
}

function shellMarks(row: RouteRow): string {
  const marks: string[] = []
  if (row.qxFrame) marks.push('data-qx-frame')
  if (row.v6Shell) marks.push('v6-runtime-shell')
  if (row.pageFrame) marks.push('data-kiosk-component=page-frame')
  if (row.w4Frame) marks.push('w4-page-frame')
  return marks.length > 0 ? marks.join(' + ') : '无上述标记'
}

function landedOf(row: RouteRow): string {
  return `${row.landedPathname}${row.landedSearch}`
}

function redirected(row: RouteRow): boolean {
  return row.landedPathname !== row.requestPathname
}

/**
 * 顶栏返回三态。选择器来源：
 * - 青序：`QxPageFrame` 的 `.qx-topbar-back`
 * - 旧壳：`packages/ui` `KioskPageHeader` 的 `.ui-kiosk-back-button`（aria-label = backLabel）
 * 落地 pathname 为 `/` 且两种返回键都没有 →「根页面，不适用」。
 * 两种都有时并列写出，不丢信息。
 */
export function backExitLabel(row: Pick<RouteRow, 'landedPathname' | 'topbarBack' | 'legacyBack'>): string {
  const parts: string[] = []
  if (row.topbarBack.length > 0) {
    parts.push(`青序返回槽（${list(row.topbarBack)}）`)
  }
  if (row.legacyBack.length > 0) {
    parts.push(`旧壳返回键（${list(row.legacyBack)}）`)
  }
  if (parts.length > 0) return parts.join(' · ')
  if (row.landedPathname === '/') return '根页面，不适用'
  return '无'
}

/** 真正两者都没有：无青序槽、无旧壳键；CTA 次级也不算有出口。落地 `/` 不算。 */
export function isTrueNoExit(
  row: Pick<RouteRow, 'landedPathname' | 'topbarBack' | 'legacyBack' | 'ctaSecondary'>,
): boolean {
  if (row.landedPathname === '/') return false
  return row.topbarBack.length === 0 && row.legacyBack.length === 0 && row.ctaSecondary.length === 0
}

function notQxShell(row: RouteRow): boolean {
  return row.qxFrame !== true
}

/** `/print-scan/convert` 与 `/print/scan-convert` 不能都变成 print-scan-convert。`/` → `_`，`:` 丢掉。 */
export function routeSlug(pattern: string): string {
  if (pattern === '/') return 'root'
  return pattern.replace(/^\//, '').replace(/:/g, '').replace(/\//g, '_')
}

export type ReportMeta = {
  generatedAt: string
  sha: string
  branch: string
  origin: string
  viewport: string
  fixture: string
  routeSource: string
  routeCount: number
  screenshotDir: string
}

export function renderReport(meta: ReportMeta, rows: RouteRow[]): string {
  const redirects = rows.filter(redirected)
  const noExits = rows.filter(isTrueNoExit)
  const oldShells = rows.filter(notQxShell)

  const lines: string[] = [
    '# 一体机走查清单（冷开取证）',
    '',
    '本文件是实测记录，不是验收结论。表里的值是冷开该 URL 之后页面上读到的 DOM，不做对错判断。',
    '',
    '| 项 | 值 |',
    '|---|---|',
    `| 生成时间 | ${cell(meta.generatedAt)} |`,
    `| git SHA | ${cell(meta.sha)} |`,
    `| 分支 | ${cell(meta.branch)} |`,
    `| 预览 origin | ${cell(meta.origin)} |`,
    `| 视口 | ${cell(meta.viewport)} |`,
    `| 夹具 | ${cell(meta.fixture)} |`,
    `| 路由来源 | ${cell(meta.routeSource)} |`,
    `| 条数 | ${meta.routeCount} |`,
    `| 截图目录 | ${cell(meta.screenshotDir)} |`,
    '',
    '跑法（`apps/kiosk`）：`pnpm walkthrough:inventory`',
    '',
    '每条路由独立 BrowserContext。截图文件名是路由模式的 slug（`/` → `root.png`，`/` 换成 `_`，`:` 丢掉；所以 `/print-scan/convert` 是 `print-scan_convert.png`，`/print/scan-convert` 是 `print_scan-convert.png`）。',
    '',
    '## 全表',
    '',
    '「顶栏返回」三态：`青序返回槽`（`.qx-topbar-back`） / `旧壳返回键`（`KioskPageHeader` 的 `.ui-kiosk-back-button`，括号里是 backLabel） / `无`。落地 `/` 且两种都没有则标 `根页面，不适用`。',
    '',
    '| # | 模式 | 请求 pathname | 落地 pathname | 主标题 | 主行动按钮 | 顶栏返回 | CTA 次级出口 | `button[disabled]` | 壳 | 采集异常 |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ]

  rows.forEach((row, index) => {
    lines.push(
      [
        '',
        String(index + 1),
        cell(row.pattern),
        cell(row.requestPathname),
        cell(landedOf(row)),
        cell(row.title),
        list(row.mainActions),
        cell(backExitLabel(row)),
        list(row.ctaSecondary),
        list(row.disabledButtons),
        cell(shellMarks(row)),
        cell(row.captureError ?? ''),
        '',
      ].join('|'),
    )
  })

  lines.push(
    '',
    '## 落地 pathname ≠ 请求 pathname',
    '',
    `共 ${redirects.length} 条。比较的是 pathname（落地栏附带 search，便于看 \`?stage=\` / \`?step=\`）。`,
    '',
    '| 模式 | 请求 pathname | 落地 pathname | 壳 |',
    '|---|---|---|---|',
  )
  if (redirects.length === 0) {
    lines.push('| （无） | — | — | — |')
  } else {
    for (const row of redirects) {
      lines.push(
        `| ${cell(row.pattern)} | ${cell(row.requestPathname)} | ${cell(landedOf(row))} | ${cell(shellMarks(row))} |`,
      )
    }
  }

  lines.push(
    '',
    '## 没有任何出口的',
    '',
    '判据（只描述怎么数，不是结论）：落地 pathname 不是 `/`，看不到 `.qx-topbar-back`，也看不到 `KioskPageHeader` 的 `.ui-kiosk-back-button`，且 `.qx-ctabar` 里没有 `data-variant` 不是 `primary` 的按钮。底部主导航不计入。首页 `/` 是根页面，标「根页面，不适用」，不算无出口。',
    '',
    '这张表现在的判别力取决于上面两个选择器认全了没有——如果将来又出现第三种壳，它会重新产生假阳性。',
    '',
    `共 ${noExits.length} 条。`,
    '',
    '| 模式 | 请求 pathname | 落地 pathname | 顶栏返回 | CTA 次级出口 | 壳 |',
    '|---|---|---|---|---|---|',
  )
  if (noExits.length === 0) {
    lines.push('| （无） | — | — | — | — | — |')
  } else {
    for (const row of noExits) {
      lines.push(
        `| ${cell(row.pattern)} | ${cell(row.requestPathname)} | ${cell(landedOf(row))} | ${cell(backExitLabel(row))} | ${list(row.ctaSecondary)} | ${cell(shellMarks(row))} |`,
      )
    }
  }

  lines.push(
    '',
    '## 壳不是新壳的',
    '',
    '判据（只描述怎么数，不是结论）：落地页没有 `[data-qx-frame="true"]`。其它标记原样记下（`v6-runtime-shell` / `data-kiosk-component=page-frame` / `w4-page-frame`）。',
    '',
    `共 ${oldShells.length} 条。`,
    '',
    '| 模式 | 请求 pathname | 落地 pathname | 实测壳标记 | 主标题 |',
    '|---|---|---|---|---|',
  )
  if (oldShells.length === 0) {
    lines.push('| （无） | — | — | — | — |')
  } else {
    for (const row of oldShells) {
      lines.push(
        `| ${cell(row.pattern)} | ${cell(row.requestPathname)} | ${cell(landedOf(row))} | ${cell(shellMarks(row))} | ${cell(row.title)} |`,
      )
    }
  }

  lines.push('')
  return lines.join('\n')
}

export function writeReportFile(path: string, markdown: string): void {
  writeFileSync(path, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8')
}
