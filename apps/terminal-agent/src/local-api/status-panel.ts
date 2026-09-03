import type { ServerResponse } from 'node:http'
import type { LocalAgentPanelStatus } from './types'

const PANEL_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Content-Type': 'text/html; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const

const printerLabels: Record<LocalAgentPanelStatus['printerStatus'], string> = {
  ready: '打印机就绪',
  offline: '打印机离线',
  error: '打印机异常',
  low_paper: '打印纸不足',
  unknown: '打印机状态待确认',
}

const scanLabels: Record<LocalAgentPanelStatus['scanInputReason'], string> = {
  ready: '扫描目录就绪',
  not_configured: '扫描目录未配置',
  reparse_point_unverifiable: '扫描目录安全性无法确认',
  reparse_point: '扫描目录包含重解析点',
  not_directory: '扫描目录配置无效',
  unavailable: '扫描目录不可用',
  not_readable: '扫描目录不可读取',
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character]!
  )
}

function statusClass(ready: boolean): string {
  return ready ? 'ok' : 'warn'
}

function displayTimestamp(value: string | null): string {
  if (!value) return '尚未成功连接'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? '时间待确认'
    : parsed.toLocaleString('zh-CN', { hour12: false })
}

export function renderLocalAgentStatusPanel(status: LocalAgentPanelStatus): string {
  const cloudLabel = status.cloudConnected ? '云端连接正常' : '云端暂未连接'
  const databaseLabel = status.localTaskDatabaseAvailable ? '本地任务库就绪' : '本地任务库异常'
  const credentialLabel =
    status.credentialStatus === 'ready' ? '终端凭据有效' : '终端凭据需重新绑定'
  const scanReady = status.scanInputStatus === 'ready'

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="15">
  <title>AI Job Print Terminal</title>
  <style>
    :root{color-scheme:light;font-family:"Segoe UI","Microsoft YaHei",sans-serif;background:#f4f7fb;color:#172033}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;padding:32px 20px;background:linear-gradient(145deg,#eef4ff,#f8fafc)}
    main{max-width:780px;margin:0 auto}.hero,.card{background:#fff;border:1px solid #dce5f2;border-radius:18px;box-shadow:0 12px 36px rgba(43,63,98,.08)}
    .hero{padding:28px 30px;margin-bottom:18px}.eyebrow{color:#3567c9;font-weight:700;letter-spacing:.08em;font-size:13px}h1{margin:8px 0 6px;font-size:30px}.sub{margin:0;color:#63708a}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.card{padding:20px}.label{font-size:13px;color:#71809a}.value{margin-top:8px;font-size:18px;font-weight:700}.ok{color:#147a45}.warn{color:#a45a07}
    footer{padding:18px 4px;color:#75819a;font-size:13px;line-height:1.65}@media(max-width:620px){body{padding:18px 12px}.hero{padding:22px}.grid{grid-template-columns:1fr}h1{font-size:25px}}
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="eyebrow">只读本机状态</div>
      <h1>AI Job Print Terminal</h1>
      <p class="sub">后台服务运行中 · 页面每 15 秒自动刷新</p>
    </section>
    <section class="grid" aria-label="终端状态">
      <article class="card"><div class="label">终端编号</div><div class="value">${escapeHtml(status.terminalCode)}</div></article>
      <article class="card"><div class="label">Agent 版本</div><div class="value">${escapeHtml(status.runtimeVersion)}</div></article>
      <article class="card"><div class="label">云端连接</div><div class="value ${statusClass(status.cloudConnected)}">${cloudLabel}</div></article>
      <article class="card"><div class="label">最近成功心跳</div><div class="value">${escapeHtml(displayTimestamp(status.lastHeartbeatAt))}</div></article>
      <article class="card"><div class="label">打印设备</div><div class="value ${statusClass(status.printerStatus === 'ready')}">${printerLabels[status.printerStatus]}</div></article>
      <article class="card"><div class="label">任务存储</div><div class="value ${statusClass(status.localTaskDatabaseAvailable)}">${databaseLabel}</div></article>
      <article class="card"><div class="label">扫描输入（启动检查）</div><div class="value ${statusClass(scanReady)}">${scanLabels[status.scanInputReason]}</div></article>
      <article class="card"><div class="label">终端凭据</div><div class="value ${statusClass(status.credentialStatus === 'ready')}">${credentialLabel}</div></article>
    </section>
    <footer>本页面只显示经过净化的运行状态，不提供打印、扫描、绑定或服务控制操作。业务功能请继续使用一体机前台和管理员后台。</footer>
  </main>
</body>
</html>`
}

export function sendLocalAgentStatusPanel(
  res: ServerResponse,
  status: LocalAgentPanelStatus
): void {
  res.writeHead(200, PANEL_HEADERS)
  res.end(renderLocalAgentStatusPanel(status))
}
