/**
 * 装机自检、身份、令牌到期与激活错误码的纯展示。
 * 原因码中文取 agent-reason-codes「后台显示」；接口错误码取契约 §8「后台显示」。
 * 两者同名时句子不同，不要混用。
 */
import type { TerminalIdentityStatus, TerminalProvisionReport } from '../../services/api/terminalActivation'

const CHECK_KEY_LABELS: Record<string, string> = {
  api_reachable: '能连上服务器',
  bind_exchanged: '激活码兑换',
  service_running: '终端程序服务',
  local_port_loopback_only: '本机接口只听本机',
  printer_ready: '打印机',
  agent_version_match: '版本一致',
  first_heartbeat_ack: '首次心跳',
  boot_print_guard: '开机打印防护',
  edge_kiosk_policy: '一体机浏览器策略',
  hardware_identity: '硬件身份',
}

/** 自检原因码。句子与原因码表「后台显示」列一致，不按接口错误码改写。 */
const REASON_LABELS: Record<string, string> = {
  NET_TIMEOUT_AFTER_WAIT: '等了 90 秒以上仍连不上服务器',
  DNS_FAILED: '服务器域名解析失败',
  TLS_FAILED: '和服务器的加密连接没建起来',
  ACTIVATION_FILE_NOT_FOUND: 'U 盘和安装包目录里都没找到激活文件',
  ACTIVATION_SIGNATURE_INVALID: '激活文件签名不对，可能被改过或不是本系统生成的',
  ACTIVATION_HOST_NOT_ALLOWED: '激活文件里的服务器地址不在允许范围内',
  ACTIVATION_EXPIRED: '激活文件已过期',
  BIND_CODE_USED: '激活码已被别的机器用过',
  BIND_CODE_INVALID: '激活码无效或已被作废',
  TERMINAL_STATE_NOT_ALLOWED: '终端不在「待安装」或「维护中」，或还有进行中的任务',
  SERVICE_NOT_RUNNING: '终端程序服务没有运行',
  SERVICE_NOT_AUTOMATIC: '服务不是「自动启动」',
  LOCAL_PORT_NOT_LISTENING: '本机接口 9527 没在监听',
  LOCAL_PORT_EXPOSED: '本机接口对外网卡开放了（安全问题）',
  PRINTER_PENDING_CONNECT: '还没接打印机（待接打印机）',
  PRINTER_MULTIPLE_MATCH: '匹配到多台打印机，需要人选',
  PRINTER_PATTERN_NOT_SET: '服务器没配打印机型号规则，需要人选',
  PRINTER_NOT_READY: '打印机在，但不是就绪状态（缺纸、卡纸、离线等）',
  AGENT_VERSION_MISMATCH: '运行中的终端程序版本与安装包不一致',
  HEARTBEAT_NOT_ACKED: '服务器没收到这台机器的首次心跳',
  HEARTBEAT_UNAUTHORIZED: '服务器拒绝了这台机器的身份（令牌无效）',
  TERMINAL_IDENTITY_CONFLICT: '这个终端身份同时出现在另一台机器上（疑似克隆）',
  GUARD_TASK_MISSING: '开机打印防护的计划任务不存在',
  SPOOLER_NOT_MANUAL: '打印服务不是「手动」启动，防护不生效',
  GUARD_LAST_RUN_FAILED: '上次开机时防护没跑成功（可能有删不掉的残留作业）',
  EDGE_POLICY_MISSING: '一体机浏览器策略没写入',
  EDGE_POLICY_MISMATCH: '浏览器策略里的网址与本机配置不一致',
  CHECK_ERROR: '这一项检查本身出错，没有得到结论',
  HARDWARE_ID_PARTIAL: '硬件身份只取到 2–3 项（不影响使用，标黄）',
  HARDWARE_ID_INSUFFICIENT: '硬件身份只取到 0–1 项，防克隆判定对这台不生效（标红）',
}

/** 契约 §8 全部码。userErrorMessage.ts 必须逐字复制，那边不能 import 本文件。 */
export const ACTIVATION_CODE_MESSAGES: Readonly<Record<string, string>> = {
  ACTIVATION_SIGNING_UNAVAILABLE: '服务器还没配置激活文件签名密钥，暂时不能生成',
  ACTIVATION_CONFIG_UNAVAILABLE: '服务器还没配置终端连接地址，暂时不能生成',
  TERMINAL_NOT_FOUND: '终端不存在',
  TERMINAL_MAINTENANCE_REQUIRED: '终端须先设为「待安装」或「维护中」',
  TERMINAL_IN_FLIGHT_TASKS: '这台终端还有进行中的任务，等任务结束再生成',
  TERMINAL_RETIRED: '终端已退役，不能激活',
  BIND_CODE_USED: '激活码已被别的机器用过（若不是自己用的，按冒领处理并看审计）',
  BIND_CODE_INVALID: '激活码无效，请重新生成',
  BIND_CODE_EXPIRED: '激活码已过期，请重新生成',
  BIND_CODE_REVOKED: '激活码已被作废（重新生成过），请用最新的激活文件',
  MAC_ALREADY_BOUND: '这台机器的网卡已绑定到另一台终端',
  TERMINAL_IDENTITY_CONFLICT: '这个终端身份同时出现在另一台机器上，已暂停领打印任务；请在告警里放行、确认换件或吊销',
  TERMINAL_IDENTITY_NOTHING_PENDING: '这台终端当前没有待处置的身份冲突',
  PROVISION_REPORT_INVALID: '自检回报格式不对（未知检查项或重复）',
  AUTH_TOKEN_INVALID: '终端令牌无效，需要重新激活',
}

const DAY_MS = 86_400_000
const EXPIRY_WARNING_MS = 60 * DAY_MS

export type ExpiryTone = 'none' | 'warning' | 'error'
export type IdentityTone = 'ok' | 'danger' | 'warning' | 'muted'
export type CheckTone = 'warning' | 'error'

export function checkKeyLabel(key: string): string {
  return CHECK_KEY_LABELS[key] ?? `未归类检查项（${key}）`
}

export function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? `未归类（${code}）`
}

export function checkTone(code: string): CheckTone {
  return code === 'HARDWARE_ID_PARTIAL' ? 'warning' : 'error'
}

export function failedCheckLine(check: { key: string; code: string }): string {
  return `${checkKeyLabel(check.key)}：${reasonLabel(check.code)}`
}

export function provisionSummaryLabel(report: TerminalProvisionReport | null | undefined): string {
  if (!report) return '未回报'
  if (report.ok) return '通过'
  const count = report.failedChecks?.length || report.failedKeys?.length || 0
  return count > 0 ? `${count} 项未通过` : '未通过'
}

export function provisionHover(report: TerminalProvisionReport | null | undefined): string {
  if (!report || report.ok) return ''
  return report.failedChecks.map((check) => failedCheckLine(check)).join('；')
}

export function identityLabel(status: TerminalIdentityStatus | null | undefined): string {
  switch (status) {
    case 'ok':
      return '正常'
    case 'suspected_clone':
      return '疑似克隆'
    case 'suspected_replacement':
      return '疑似换件'
    default:
      return '未上报'
  }
}

export function identityTone(status: TerminalIdentityStatus | null | undefined): IdentityTone {
  switch (status) {
    case 'ok':
      return 'ok'
    case 'suspected_clone':
      return 'danger'
    case 'suspected_replacement':
      return 'warning'
    default:
      return 'muted'
  }
}

/** 已过期为红；到期时刻起 60 天内（含第 60 天）为黄。现在由调用方传入，测试用固定时钟。 */
export function credentialExpiryTone(expiresAt: string | null | undefined, now: Date): ExpiryTone {
  if (!expiresAt) return 'none'
  const at = Date.parse(expiresAt)
  if (Number.isNaN(at)) return 'none'
  const delta = at - now.getTime()
  if (delta <= 0) return 'error'
  if (delta <= EXPIRY_WARNING_MS) return 'warning'
  return 'none'
}
