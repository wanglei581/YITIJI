import type { ScanSessionCreateResponse } from '@ai-job-print/shared'
import type { SessionFailure } from './scanRescanRecovery'
import type { ScanLiveState } from './scanWorkbenchSession'

/**
 * 设置页里**无状态**的那几条判定与取数。
 *
 * 搬出来的理由和 `scanRescanRecovery.ts` 同一条：`ScanSettingsPage` 贴着 800 行硬线
 * （CLAUDE.md §8），而这几个函数一个 ref 都不读、一个 state 都不写，搬走不改变任何判据。
 * 副作用（撤销、置状态、发请求）仍然留在页面里——它们要读生命周期。
 */

export type SessionPhase = 'invalid' | 'loading' | 'success' | 'expired' | 'error'

/**
 * 会话建出来了，但本机没能把它的凭据真正写进这台机器的会话存储（写完读回来对不上）。
 *
 * 这一屏的出路刻意**不是**「重新开始一次扫描」：写不进去是这台机器的存储坏了 /
 * 被禁用 / 写满，重建一次只会在同一处再失败一次，还多留一条要撤的服务端任务。
 * 所以只给两件真能做的事 —— 安全返回，以及叫现场工作人员看一眼这台机器。
 *
 * 纯字符串、没有 markdown（会被原样渲染进 <p>），也**不含任何凭证**：
 * 任务编号与控制凭证一个字都不上 27 寸公共屏。
 */
export const SCAN_LIVE_NOT_DURABLE_FAILURE: SessionFailure = {
  title: '本机没能记住这次扫描会话',
  description: '扫描会话确实建出来了，但本机把它的凭据写进这台机器的会话存储时失败了：'
    + '写完读回来对不上。记不住就等于这一场随时会找不回来，所以本页没有向服务端确认'
    + '投递授权，而是把刚建的那条任务撤掉了 —— 服务端那边没有留下还在等文件的任务，'
    + '你手上的纸不会被谁悄悄收走。现在请先别在面板上按开始：没有会话认领那份文件。'
    + '请安全返回扫描首页，并叫现场工作人员看一眼这台机器的浏览器存储是不是被禁用或者写满了。',
}

/**
 * 从一份「可能不完整」的创建响应里取出撤销所需的那两样。
 *
 * 独立于 `isValidCreatedSession` 的理由：响应体缺 `instructions` / `expiresAt` 时这一场
 * 对用户不可用，但只要 id 与 controlToken 在，服务端那条任务就是真的、就**撤得掉**。
 * 合成一个判定会让这种半残响应变成孤儿任务：它停在 waiting，收下一位的面板扫描。
 */
export function getCancellationCredentials(
  created: unknown,
): { scanTaskId: string; controlToken: string } | null {
  if (!created || typeof created !== 'object') return null
  const candidate = created as Partial<ScanSessionCreateResponse>
  if (typeof candidate.scanTaskId !== 'string' || candidate.scanTaskId.trim().length === 0) return null
  if (typeof candidate.controlToken !== 'string' || candidate.controlToken.trim().length === 0) return null
  return { scanTaskId: candidate.scanTaskId, controlToken: candidate.controlToken }
}

/** 这一场对用户可用：四样服务端字段齐全、未过期、指引非空。 */
export function isValidCreatedSession(created: unknown): created is ScanSessionCreateResponse {
  if (!created || typeof created !== 'object') return false
  const candidate = created as Partial<ScanSessionCreateResponse>
  return getCancellationCredentials(candidate) !== null
    && typeof candidate.expiresAt === 'string'
    && Number.isFinite(Date.parse(candidate.expiresAt))
    && Date.parse(candidate.expiresAt) > Date.now()
    && Array.isArray(candidate.instructions)
    && candidate.instructions.length > 0
    && candidate.instructions.every((instruction) => typeof instruction === 'string' && instruction.trim().length > 0)
}

export function formatCountdown(expiresAt: string): string {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  return `${minutes}:${String(remain).padStart(2, '0')}`
}

export function liveSessionStillValid(live: ScanLiveState | undefined): live is ScanLiveState {
  if (!live) return false
  return Date.parse(live.expiresAt) > Date.now() && live.instructions.length > 0
}

/**
 * 「本次性质」那一行说什么，取决于本机**确实知道**什么。null = 无可声明。
 *
 * 四种情况，一句都不许互相顶替：
 *   · 这一次真的带了重扫两半且创建成功 —— 服务端已经把那枚授权消费掉了，
 *     所以「已放行」在这一行是可以说的（结果页那边不行，它手里只有凭据）；
 *   · 用户在 fail-closed 那一屏显式选了普通会话 —— 把这个选择记下来，
 *     免得下一屏看起来像是本页悄悄降级的；
 *   · 复水出来的会话 —— 授权只活在内存里，重载后本页说不出当初带没带，
 *     就如实说无从判断，不猜；
 *   · 普通新建 —— 不多这一行，没什么要声明的。
 */
export function sessionNatureRow(args: {
  rescanRequested: boolean
  plainRestartChosen: boolean
  restoredFromStorage: boolean
}): [string, string] | null {
  return args.rescanRequested
    ? ['本次性质', '安全重扫：服务端已放行同一份材料再扫一次']
    : args.plainRestartChosen
      ? ['本次性质', '普通会话：你已确认这一次不是安全同字节重扫']
      : args.restoredFromStorage
        ? ['本次性质', '本页重载过；这一场当初是不是安全重扫，本机无从判断']
        : null
}
