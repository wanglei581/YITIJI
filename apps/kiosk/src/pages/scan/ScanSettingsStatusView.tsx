import { SCAN_ACK_PENDING_NOTICE, type ScanAckState } from './scanDeliveryAck'
import { SCAN_OUTPUT_FORMAT_PENDING } from './scanOutputFormat'
import { PhoneHelpLine } from '../print-scan/phoneHelp'
import type { SessionFailure } from './scanRescanRecovery'
import { sessionNatureRow, type SessionPhase } from './scanSettingsModel'
import {
  ScanCta,
  ScanWorkbenchShell,
} from './ScanWorkbenchChrome'
import { SCAN_TYPE_LABELS, type ScanType } from './scanWorkbench'
import type { TerminalSessionState } from '../../services/terminalAuth'

/**
 * 设置页「还不能去面板操作」的那几屏。
 *
 * 搬出来的理由和 `scanSettingsModel` / `scanRescanRecovery` 同一条：`ScanSettingsPage`
 * 贴着 800 行硬线（CLAUDE.md §8），而这一整块**只读 props、不碰任何 ref/effect/请求**。
 * 副作用（创建、撤销、确认投递、置状态）仍然全部留在页面里 —— 它们要读生命周期。
 *
 * 这里一共五种屏，判据互不重叠：
 *   · invalid —— 没有合法扫描类型，本页一个请求都不会发；
 *   · create-loading —— 创建请求在路上（含丢失响应的有界重放窗口）；
 *   · awaiting-ack —— **会话已经建成，但还没拿到投递授权**（2026-09-14 新增，见下）；
 *   · expired —— 服务端给的有效期走完了；
 *   · cleanup-holding —— **上一位的扫描还没收完尾**（2026-09-15 新增，见下）；
 *   · create-failed —— 创建失败的各种结论屏。
 *
 * ## awaiting-ack 这一屏为什么必须存在
 *
 * 服务端 2026-09-14 起把「建成」和「可投递」拆成两段：新建会话一律
 * `deliveryAckedAt = null`，Agent 的 current-lease **看不见**它，直到本机
 * `POST /scan/sessions/:id/ack` 确认自己确实握着这一场的控制凭据。
 *
 * ## cleanup-holding 这一屏为什么不能说成「会话创建失败」
 *
 * 它的成因在**上一位**身上：清场收尾闸还没拿到服务端「上一场已取消」的回执
 * （scanCleanupGate）。这一刻本页**一个创建请求都没发出去** —— 说「会话创建失败」
 * 就是把一次根本没发生的请求说成失败了，也把责任说给了服务端。所以它自带一屏：
 * 状态条说「还在收上一场的尾」，主行动是禁用的，正文解释为什么现在扫会出事。
 * 出路刻意不是一颗按钮：收尾是本机自己在重试，好了这一页会自己往下走。
 *
 * ## awaiting-ack（续）
 *
 * 于是这一刻屏幕上绝不能出现面板操作指引或「我已操作，开始等待」：任务在服务端是
 * 不可投递的，用户照着指引扫一张纸，那份文件不会进他的会话。它不会被别人收走
 * （不可投递对谁都一样），但人会在机器前白等到轮询上限。所以这一屏说的是
 * 「先别按开始」，不是「去面板操作」。
 */
export interface ScanSettingsStatusViewProps {
  phase: SessionPhase
  ackState: ScanAckState
  scanType: ScanType | null
  terminalSession: TerminalSessionState
  failure: SessionFailure | null
  replayingLostCreate: boolean
  rescanRetryable: boolean
  rescanCredentialsLost: boolean
  rescanRefusedByServer: boolean
  ackRefused: boolean
  /** 凭据没能真正落进本机登记：这一屏不给「重新开始一次扫描」，理由见 scanSettingsModel。 */
  liveNotDurable: boolean
  /** 上一位的扫描还没收完尾：本页一个创建请求都没发，所以不许说成「会话创建失败」。 */
  cleanupHolding: boolean
  quietPeriodRemaining: number
  quietPeriodBlocked: boolean
  handleSafeReturn: () => void
  handlePlainRestart: () => void
  handleRescanRetry: () => void
  handleAckRetry: () => void
  handleQuietPeriodRetry: () => void
}

export function ScanSettingsStatusView({
  phase,
  ackState,
  scanType,
  terminalSession,
  failure,
  replayingLostCreate,
  rescanRetryable,
  rescanCredentialsLost,
  rescanRefusedByServer,
  ackRefused,
  liveNotDurable,
  cleanupHolding,
  quietPeriodRemaining,
  quietPeriodBlocked,
  handleSafeReturn,
  handlePlainRestart,
  handleRescanRetry,
  handleAckRetry,
  handleQuietPeriodRetry,
}: ScanSettingsStatusViewProps) {
  /* 会话建成了，投递授权还没到手。它压在其它分支**之上**：phase 已经是 success，
   * 按旧判据这一屏会直接画出面板操作指引 —— 而那正是这次要挡掉的动作。 */
  const awaitingAck = phase === 'success' && ackState !== 'acked'
  const ackRetryable = awaitingAck && ackState === 'retryable'

  const workbenchState = awaitingAck
    ? 'awaiting-ack'
    : cleanupHolding
      ? 'cleanup-holding'
      : phase === 'invalid'
        ? 'invalid'
        : phase === 'loading'
          ? 'create-loading'
          : phase === 'expired'
            ? 'expired'
            : 'create-failed'
  const title = awaitingAck
    ? failure?.title ?? '正在确认能收到扫描件'
    : phase === 'invalid'
      ? '未创建扫描任务'
      : phase === 'loading'
        ? '正在创建扫描任务'
        : failure?.title ?? '扫描任务未创建'
  const description = awaitingAck
    ? failure?.description ?? SCAN_ACK_PENDING_NOTICE
    : phase === 'invalid'
      ? '当前页面没有来自扫描首页的合法类型信息，本次不会发起创建请求。'
      : phase === 'loading'
        ? '正在等系统建好这次扫描，成功前不会显示任务信息或操作指引。'
        : failure?.description ?? '这次没有可用的扫描。'
  const status = awaitingAck
    ? ackRetryable
      ? { tone: 'warn' as const, label: '还没确认能收到扫描件' }
      : { tone: 'unknown' as const, label: '正在确认能收到扫描件' }
    : phase === 'loading'
      ? {
          tone: 'unknown' as const,
          // 还在换终端票据时不能说「正在建扫描会话」—— 那一刻请求还没发出去。
          // 重放期间也不能那么说 —— 会话可能早就建成了，丢的只是那一次回话。
          label: replayingLostCreate
            ? '正在确认上一次请求'
            : terminalSession === 'checking' ? '正在做这台机器的安全校验' : '正在建立这次扫描',
        }
      : phase === 'expired'
        ? { tone: 'warn' as const, label: '这次扫描已过期' }
        /* 没发过请求就不许说「创建失败」：这一屏等的是上一场的收尾回执。 */
        : cleanupHolding
          ? { tone: 'warn' as const, label: '正在收上一场的尾' }
          : { tone: 'bad' as const, label: '这次扫描没建好' }
  /* 稿 18 状态屏骨架：当前状态 → 链路位置 → 下一步。这几屏一律还没有一段开始（链路不点亮），
   * 标题只说「卡在哪」—— 不写百分比，也不暗示哪一段已经在动。 */
  const chainHead: readonly [string, string] = awaitingAck
    ? ['这次扫描已经建好，还没确认能收到扫描件', '确认之前，请先不要按开始']
    : cleanupHolding
      ? ['还在收上一场的尾', '这一场的四段都还没开始']
      : phase === 'loading'
        ? ['这次扫描建好才算迈出第一步', '这四段一段都还没开始']
        : phase === 'expired'
          ? ['流程停在哪', '文件没有挂到这次扫描']
          : phase === 'invalid'
            ? ['这次扫描还没建好', '这四段一段都还没开始']
            : ['现在卡在建立这次扫描', '扫描还没开始']

  return (
    <ScanWorkbenchShell
      page="scan-settings"
      state={workbenchState}
      title={title}
      subtitle={description}
      status={status}
      layout="spread"
      ctabar={
        <ScanCta
          reason={
            awaitingAck
              ? '还没确认能收到扫描件之前，不显示面板操作步骤 —— 这一刻扫出来的文件不会交到这一场'
              : phase === 'loading'
                ? '请求还在路上 —— 这一刻页面不做任何判断，也不给你一个假的编号'
                : cleanupHolding
                  ? '上一场还没收完尾 —— 这一刻建立这次扫描，你扫的那张纸可能落到上一位名下'
                  : '未确认成功前不显示扫描操作步骤'
          }
        >
          <button type="button" className="qx-btn" data-variant="ghost" onClick={handleSafeReturn}>
            安全返回扫描首页
          </button>
          {/* 四条分支。awaiting-ack 排在最前面：这一屏上「再试一次安全重扫」「重新开始
              一次扫描」都是错的主行动 —— 会话已经建成了，缺的只是那一次确认，
              重开一场只会白建一条任务。
              其余三条按「安全重扫这条路还通不通」排序，顺序不能反：还通的排最前
              （再发一次成对的重扫，不是降级）—— 排在后面的话，一次限流就会把用户推去
              开普通会话，同一张纸再撞上两小时的同字节去重。其次是三条 fail-closed 的
              显式普通重启；最后是与重扫无关的失败：什么都不许按。 */}
          {awaitingAck ? (
            ackRetryable ? (
              <button type="button" className="qx-btn" data-variant="primary" onClick={handleAckRetry}>
                再确认一次
              </button>
            ) : (
              <button type="button" className="qx-btn" data-variant="primary" disabled aria-disabled="true">
                等系统确认能收到扫描件
              </button>
            )
          ) : quietPeriodBlocked ? (
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              disabled={quietPeriodRemaining > 0}
              aria-disabled={quietPeriodRemaining > 0}
              onClick={handleQuietPeriodRetry}
            >
              {quietPeriodRemaining > 0 ? `请等约 ${quietPeriodRemaining} 秒` : '重新开始一次扫描'}
            </button>
          ) : rescanRetryable ? (
            <button type="button" className="qx-btn" data-variant="primary" onClick={handleRescanRetry}>
              再试一次安全重扫
            </button>
          ) : rescanCredentialsLost || rescanRefusedByServer || ackRefused ? (
            <button type="button" className="qx-btn" data-variant="primary" onClick={handlePlainRestart}>
              重新开始一次扫描
            </button>
          ) : (
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              disabled
              aria-disabled="true"
            >
              {phase === 'loading'
                ? '等系统返回这次扫描'
                /* 这一支上任务**建过**（随后被本页撤掉），说「未创建」就是句假话。 */
                : liveNotDurable
                  ? '本机暂时存不下扫描记录，无法开始这次扫描'
                  /* 这一支上一个请求都没发过，说「未创建扫描任务」不算错，但没说出
                     为什么按不了 —— 用户会以为是自己哪一步做漏了。 */
                  : cleanupHolding ? '等本机收完上一场的尾' : '未创建扫描任务'}
            </button>
          )}
        </ScanCta>
      }
    >
      <div className="fs-grow">
        {awaitingAck ? (
          <span className="fs-chips">
            <span className="fs-chip">这次扫描已经建好</span>
            <span className="fs-chip is-warn">还没确认能收到扫描件</span>
          </span>
        ) : null}
        <div className="fs-facts">
          <div className="fs-fact wide">
            <b>{chainHead[0]}</b>
            <span>{description}</span>
          </div>
          <div className="fs-fact"><b>类型</b><span>{scanType ? SCAN_TYPE_LABELS[scanType] : '还没选定'}</span></div>
          <div className="fs-fact"><b>输出格式</b><span>{SCAN_OUTPUT_FORMAT_PENDING}</span></div>
          <div className="fs-fact wide"><b>保存</b><span>按设备回传的原格式保存，系统不做转换</span></div>
          <div className="fs-fact wide"><b>{chainHead[1]}</b><span>确认完成之前，不显示面板步骤，也不开始等待。</span></div>
        </div>
        {phase === 'loading' && !awaitingAck ? <p className="fs-p">这一步不碰扫描仪，也不会替你启动任何硬件。</p> : null}
        {awaitingAck ? (
          <p className="fs-warn" data-testid="scan-ack-pending-notice">
            这次扫描<b>已经建好</b>，但系统还没确认这台机器可以收它的文件。
            没确认之前，面板上扫出来的东西<b>不会</b>交到这一场，所以<b>先别在面板上按开始</b>。
            这一场也<b>不会</b>被别人收走：没确认的任务不会接收任何文件。
          </p>
        ) : null}
        {phase === 'loading' && replayingLostCreate ? (
          <p className="fs-warn" data-testid="scan-create-replay-notice">
            上一次请求<b>没有收到系统回应</b>，本机正在用<b>同一份凭据</b>再问一次：
            这次扫描可能已经建好，这一步是去把它领回来（系统认同一对凭据，<b>不会多建一场</b>）。
            问清楚之前<b>先别在面板上按开始</b>。
          </p>
        ) : null}
        {liveNotDurable ? (
          <p className="fs-warn" data-testid="scan-live-not-durable-notice">
            这次扫描<b>建出来过</b>，但本机没能把它的凭据记住（写完读回来对不上），
            所以本页<b>没有</b>向系统确认投递授权，并且已经把那条任务<b>撤掉</b>了。
            现在<b>先别在面板上按开始</b>：没有这次扫描来接收那份文件，它也不会被别人收走。
          </p>
        ) : null}
        {rescanRetryable && !awaitingAck ? (
          <p className="fs-warn" data-testid="scan-rescan-still-held">
            <b>这次失败没有用掉你的安全重扫凭据</b> —— 本机把它原样留着，
            有效期照旧从上一场算起（<b>重试不会延长</b>）。按「再试一次安全重扫」发出去的
            仍然是同一份材料的授权；本页<b>不会</b>替你改发普通重扫。
          </p>
        ) : null}
        <PhoneHelpLine />
      </div>
    </ScanWorkbenchShell>
  )
}

/**
 * 面板指引屏右下角那张「这次会话」——**纯展示**，一个 ref / effect / 请求都不碰。
 *
 * 搬出来的理由和本文件其余部分同一条：`ScanSettingsPage` 顶着 800 行硬线
 * （CLAUDE.md §8）。判据一条没减，只是换了个地方渲染；决定「这一屏出不出得来」的
 * 那道投递授权放行闸仍然在页面里，本组件只在闸门放行之后才被渲染。
 *
 * `restoredFromStorage` 必须由调用方喂**挂载那一刻**那个 ref：每帧重算会把一个刚在
 * 本页建成的会话说成「本页重载过」—— 创建成功之后本页自己就把 live 写回登记了。
 */
export interface ScanSettingsSessionFactsProps {
  scanType: ScanType
  countdown: string
  rescanRequested: boolean
  plainRestartChosen: boolean
  restoredFromStorage: boolean
}

export function ScanSettingsSessionFacts({
  scanType,
  countdown,
  rescanRequested,
  plainRestartChosen,
  restoredFromStorage,
}: ScanSettingsSessionFactsProps) {
  // 「本次性质」那一行（四种互斥情况与各自的理由见 scanSettingsModel）。
  const natureRow = sessionNatureRow({ rescanRequested, plainRestartChosen, restoredFromStorage })
  return (
    <div className="fs-kvs">
      <div className="fs-kv"><span>类型</span><b>{SCAN_TYPE_LABELS[scanType]}</b></div>
      <div className="fs-kv"><span>这次扫描 10 分钟内有效</span><b>{countdown}</b></div>
      <div className="fs-kv"><span>输出格式</span><b>{SCAN_OUTPUT_FORMAT_PENDING}</b></div>
      <div className="fs-kv"><span>保存</span><b>按设备回传的原格式保存，系统不做转换</b></div>
      {natureRow ? (
        <div className="fs-kv"><span>{natureRow[0]}</span><b>{natureRow[1]}</b></div>
      ) : null}
      <div className="fs-kv"><span>控制凭证</span><b>不显示在屏幕上</b></div>
      {rescanRequested ? (
        <div className="fs-kv"><span>安全重扫</span><b>要等系统确认才能继续，这里不写成已经放行</b></div>
      ) : null}
    </div>
  )
}
