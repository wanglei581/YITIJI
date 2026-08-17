import { safeCode, safeErrorName, stackFramesOnly } from '../common/filters/error-log'

/**
 * 合同审查阶段失败日志 —— **复用** PR #658 建立的取材白名单规范，不另造一套。
 *
 * ── 修复前 ─────────────────────────────────────────────────────────────────
 *
 * `safeStageError` 把底层错误脱敏成一个固定码抛出去，**底层原因不落任何地方**。
 * 2026-08-17 的生产排查因此必须反向去 Redis 把 failed job 的 stacktrace 读出来
 * 才拿到第一条硬事实，中间连续误判六次。其中一次误判正是「grep
 * CONTRACT_REVIEW_* 零输出 ⇒ 处理器没接手」——而 processor 与 orchestrator
 * 本来就没有 Logger，零输出是必然的。本模块把这个洞补上。
 *
 * ── 为什么不记 `error.message`（与交接文档的字面要求有出入，此处说明理由） ──
 *
 * 交接文档建议记「错误类型 + 消息」。但 `common/filters/error-log.ts` 已经为
 * 全站定了相反的规矩，理由充分且适用于此：`PrismaClientValidationError.message`
 * 会把参数对象（含字段值）拼进消息，业务异常也可能把输入回显进消息。
 * 合同审查处理的恰恰是**劳动合同全文**（姓名、身份证号、薪资、住址），
 * 是全仓最不能出现在日志里的一类数据。
 *
 * 折中做法：消息只在它**本身就是机器码**时才入日志。
 * 本模块内部所有错误都是 `CONTRACT_*` 形式的 UPPER_SNAKE 码，
 * 走 `safeCode()` 校验后原样保留；任何其他形态的消息（含一切可能夹带
 * 合同正文的自由文本）统一记成 `NON_MACHINE_CODE`，
 * 定位信息由 `errorType` + 栈帧承担。
 *
 * 于是「底层原因」在日志里的表现是：
 *   safeCode=CONTRACT_PROVIDER_TIMEOUT errorType=Error at ...
 * 这正是那晚要靠挖 Redis 才能得到的东西。
 *
 * 合同正文、PII、凭证没有任何一条路径能进到日志里 —— 不是靠正则过滤，
 * 而是靠它们从不被读取（与 #658 同一条性质）。
 */

/** 可搜索前缀。运维 grep 这个词就能捞出全部合同审查阶段失败。 */
export const CONTRACT_REVIEW_ERROR_LOG_MARKER = 'CONTRACT_REVIEW_STAGE_FAILED'

/** taskId 字符集与 `assertContractReviewTaskId` 一致（服务端生成的 cuid）。 */
const SAFE_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const STAGES = new Set(['extract', 'analyze'])
const MAX_FRAMES = 8

export interface ContractReviewErrorLogInput {
  readonly taskId: string
  readonly stage: 'extract' | 'analyze'
  /** 对外返回的安全码（脱敏后的结论）。 */
  readonly safeCode: string
  /** 底层错误对象。只从中读取构造函数名、机器码形态的消息与 `at` 栈帧。 */
  readonly cause: unknown
}

/**
 * 拼成一条单行、可 grep、字段稳定的日志。
 *
 * 字段：
 *   taskId     服务端生成的任务 id（受字符集校验；不含用户数据）
 *   stage      extract / analyze —— 源码字面量
 *   code       对外返回的安全码
 *   causeCode  底层错误消息，**仅当它是机器码时**；否则 NON_MACHINE_CODE
 *   errorType  底层错误的构造函数名
 *   frames     只含 `at …` 帧，丢掉带 message 的首行
 */
export function formatContractReviewErrorLog(input: ContractReviewErrorLogInput): string {
  const frames = stackFramesOnly(input.cause, MAX_FRAMES)
  const head = [
    CONTRACT_REVIEW_ERROR_LOG_MARKER,
    `taskId=${safeTaskId(input.taskId)}`,
    `stage=${STAGES.has(input.stage) ? input.stage : 'unknown'}`,
    `code=${safeCode(input.safeCode)}`,
    `causeCode=${causeCodeOf(input.cause)}`,
    `errorType=${safeErrorName(input.cause)}`,
    `frames=${frames.length}`,
  ].join(' ')
  return frames.length === 0 ? head : `${head}\n${frames.join('\n')}`
}

function safeTaskId(taskId: unknown): string {
  return typeof taskId === 'string' && SAFE_TASK_ID.test(taskId) ? taskId : 'unknown'
}

/**
 * 底层错误消息，**只在它整体是一个机器码时**才放行。
 *
 * `safeCode()` 对不匹配 `^[A-Z][A-Z0-9_]*$` 的输入返回固定占位符，
 * 因此「TypeError: Cannot read properties of undefined」这类自由文本，
 * 以及任何夹带了合同正文的消息，都只会记成 NON_MACHINE_CODE。
 */
function causeCodeOf(cause: unknown): string {
  if (!(cause instanceof Error) || typeof cause.message !== 'string') return 'NON_MACHINE_CODE'
  return safeCode(cause.message)
}
