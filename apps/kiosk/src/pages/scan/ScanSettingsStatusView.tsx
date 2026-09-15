import { ClockIcon } from 'lucide-react'
import { SCAN_ACK_PENDING_NOTICE, type ScanAckState } from './scanDeliveryAck'
import { SCAN_OUTPUT_FORMAT_PENDING } from './scanOutputFormat'
import type { SessionFailure } from './scanRescanRecovery'
import { sessionNatureRow, type SessionPhase } from './scanSettingsModel'
import {
  ScanCta,
  ScanKvCard,
  ScanNoteCard,
  ScanPlan,
  ScanSec,
  ScanStatusPanel,
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
  handleSafeReturn: () => void
  handlePlainRestart: () => void
  handleRescanRetry: () => void
  handleAckRetry: () => void
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
  handleSafeReturn,
  handlePlainRestart,
  handleRescanRetry,
  handleAckRetry,
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
    ? failure?.title ?? '正在确认投递授权'
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
        ? '正在等待服务端返回真实会话，成功前不会显示任务信息或操作指引。'
        : failure?.description ?? '本次没有可用的扫描会话。'
  const status = awaitingAck
    ? ackRetryable
      ? { tone: 'warn' as const, label: '投递授权未确认' }
      : { tone: 'unknown' as const, label: '正在确认投递授权' }
    : phase === 'loading'
      ? {
          tone: 'unknown' as const,
          // 还在换终端票据时不能说「正在建扫描会话」—— 那一刻请求还没发出去。
          // 重放期间也不能那么说 —— 会话可能早就建成了，丢的只是那一次回话。
          label: replayingLostCreate
            ? '正在确认上一次请求'
            : terminalSession === 'checking' ? '正在做终端安全校验' : '正在建扫描会话',
        }
      : phase === 'expired'
        ? { tone: 'warn' as const, label: '会话已过期' }
        /* 没发过请求就不许说「创建失败」：这一屏等的是上一场的收尾回执。 */
        : cleanupHolding
          ? { tone: 'warn' as const, label: '正在收上一场的尾' }
          : { tone: 'bad' as const, label: '会话创建失败' }

  return (
    <ScanWorkbenchShell
      page="scan-settings"
      state={workbenchState}
      title={title}
      subtitle={description}
      status={status}
      ctabar={
        <ScanCta
          reason={
            awaitingAck
              ? '没拿到投递授权前不显示面板操作步骤 —— 这一刻扫出来的文件不会投到这一场'
              : phase === 'loading'
                ? '请求还在路上 —— 这一刻页面不做任何判断，也不给你一个假的编号'
                : cleanupHolding
                  ? '上一场还没收完尾 —— 这一刻建会话，你扫的那张纸可能落到上一位名下'
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
                等服务端确认投递授权
              </button>
            )
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
                ? '等服务端返回会话'
                /* 这一支上任务**建过**（随后被本页撤掉），说「未创建」就是句假话。 */
                : liveNotDurable
                  ? '本机存储不可用，无法建会话'
                  /* 这一支上一个请求都没发过，说「未创建扫描任务」不算错，但没说出
                     为什么按不了 —— 用户会以为是自己哪一步做漏了。 */
                  : cleanupHolding ? '等本机收完上一场的尾' : '未创建扫描任务'}
            </button>
          )}
        </ScanCta>
      }
    >
      <ScanStatusPanel
        tone={
          awaitingAck
            ? ackRetryable ? 'warn' : 'info'
            : phase === 'loading' ? 'info'
              // cleanup-holding 是一道闸，不是一次失败：用锁不用错。
              : phase === 'invalid' || cleanupHolding ? 'lock' : 'error'
        }
        title={title}
        breathe={phase === 'loading' || (awaitingAck && !ackRetryable)}
        chips={
          awaitingAck
            ? [
                { label: '会话已建成', tone: 'ok' as const },
                { label: '投递授权未确认', tone: 'warn' as const },
              ]
            : phase === 'loading'
              ? [
                  {
                    label: replayingLostCreate
                      ? '正在确认上一次请求'
                      : terminalSession === 'checking' ? '正在做终端安全校验' : '正在等服务端回话',
                  },
                  { label: scanType ? `选中类型：${SCAN_TYPE_LABELS[scanType]}` : '未选择类型' },
                ]
              : [
                  { label: '没有任务编号', tone: 'warn' as const },
                  { label: '本机没有文件' },
                ]
        }
      >
        <p>{description}</p>
        {phase === 'loading' && !awaitingAck ? <p>这一步不碰扫描仪，也不会替你启动任何硬件。</p> : null}
        {/* 没拿到投递授权的窗口必须说出「现在扫也不会进这一场」。不说的话用户看到
            「扫描任务已创建」就转身去按开始，而服务端此刻还不肯把文件投给这一场。 */}
        {awaitingAck ? (
          <p data-testid="scan-ack-pending-notice">
            会话<b>已经建成</b>，但服务端还没确认这台机器可以收它的文件。
            没确认之前，面板上扫出来的东西<b>不会</b>投到这一场，所以<b>先别在面板上按开始</b>。
            这一场也<b>不会</b>被别人收走：没确认的任务对谁都不可投递。
          </p>
        ) : null}
        {/* 重放窗口必须说出「会话可能已经建成」。不说的话用户以为什么都没发生，
            转身去面板上扫一张纸 —— 而服务端那条 child 正等着收它。 */}
        {phase === 'loading' && replayingLostCreate ? (
          <p data-testid="scan-create-replay-notice">
            上一次请求<b>没有收到服务端回话</b>，本机正在用<b>同一份凭据</b>再问一次：
            会话可能已经建成，这一步是去把它领回来（服务端认同一对凭据，<b>不会多建一场</b>）。
            问清楚之前<b>先别在面板上按开始</b>。
          </p>
        ) : null}
        {/* 必须把「凭据还在」和「有效期不会因为重试而延长」都说出来：只给按钮不给这
            两句，用户会以为同一份材料已经扫不成了，转头去开一场注定被去重拒收的会话。 */}
        {/* 存储写不进去这一屏必须自己说出「任务建过、已经撤掉」：只显示 failure 正文的话，
            下一位读屏的人分不清「没建成」和「建成了但本机记不住」——两者该做的事不一样。 */}
        {liveNotDurable ? (
          <p data-testid="scan-live-not-durable-notice">
            会话<b>建出来过</b>，但本机没能把它的凭据记住（写完读回来对不上），
            所以本页<b>没有</b>向服务端确认投递授权，并且已经把那条任务<b>撤掉</b>了。
            现在<b>先别在面板上按开始</b>：没有会话会认领那份文件，它也不会被别人收走。
          </p>
        ) : null}
        {rescanRetryable && !awaitingAck ? (
          <p data-testid="scan-rescan-still-held">
            <b>这次失败没有用掉你的安全重扫凭据</b> —— 本机把它原样留着，
            有效期照旧从上一场算起（<b>重试不会延长</b>）。按「再试一次安全重扫」发出去的
            仍然是同一份材料的授权；本页<b>不会</b>替你改发普通重扫。
          </p>
        ) : null}
      </ScanStatusPanel>
      {awaitingAck ? (
        <div className="sw-grid2">
          <ScanNoteCard
            title="本机正在做什么"
            foot="确认是一次幂等请求：问几次都不会多建一场，也不会延长有效期。"
          >
            <ScanPlan items={[
              '本机把这一场的控制凭据交给服务端，证明有人正看着它。',
              '服务端确认之后，这台机器才被允许收这一场的文件。',
              ackRetryable
                ? '上一次确认没成，点右下角「再确认一次」重来；一直不成就安全返回。'
                : '通常一两秒；一直转多半是本机到服务端的网络有问题。',
            ]} />
          </ScanNoteCard>
          <ScanNoteCard title="为什么现在不给你操作指引" foot="这一屏的空白是有意的，不是还没加载完。">
            <p>指引一出现，你就会照着去面板上按开始。<b>而这一刻服务端还不肯把文件投给这一场</b> —— 扫出来的那张纸不会进你的记录，也不会被别人收走，只是白扫一次。</p>
          </ScanNoteCard>
        </div>
      ) : phase === 'loading' ? (
        <div className="sw-grid2">
          <ScanNoteCard title="会话建成之后会出现什么" foot="这三样都由服务端下发，本机一样都编不出来。">
            <ScanPlan items={[
              '服务端发的任务编号，用来认领待会儿回传的文件。',
              '按扫描类型定制的面板操作指引，本机原样转达。',
              '一枚只存在页面内存里的控制凭证，用来查询和取消。',
            ]} />
          </ScanNoteCard>
          <ScanNoteCard title="这一刻你可以做什么" foot="这一刻页面还没有任何结论可写。">
            <p>把要扫的纸先整理好、订书钉取掉，<b>但先别在面板上按开始</b> —— 会话还没建成，这时候扫出来的文件没人认领。</p>
            <p>等待通常就是一两秒。一直转，多半是本机到服务端的网络有问题。</p>
          </ScanNoteCard>
        </div>
      ) : (
        <div className="sw-grid2">
          {/* 这句落款分两种写法，因为它在两种屏上说的是两件事。
              本页刚刚**确实**用同一份凭据重放过（配对重扫的未知态才会），
              这时还挂着「本页不会自动重发」就是当场自打嘴巴 —— 用户据此以为
              服务端一定没收到，转身去开一场注定撞同字节去重的会话。 */}
          <ScanNoteCard
            title="接下来怎么办"
            foot={replayingLostCreate
              ? '本页只用同一份凭据问过服务端，没有多建会话，也不会自己变成成功。'
              : '本页不会自动重发，也不会自己变成成功。'}
          >
            {/* 指路跟着 ctabar 的分支走：写死「返回扫描首页」时，拿着凭据的那一屏上
                最该按的那颗按钮反而没人提。 */}
            <ScanPlan items={[
              rescanRetryable
                ? '点右下角「再试一次安全重扫」：同一份材料的授权还在手上。'
                : '返回扫描首页，从选择类型重新走一遍。',
              '连续失败就别在面板上扫了，扫了也没有会话认领。',
              '叫工作人员看一眼这台机器到服务端的网络。',
            ]} />
          </ScanNoteCard>
          <ScanNoteCard title="为什么不给你一个编号" foot="这一屏的空白是有意的，不是还没加载完。">
            <p>编号是服务端发的，本机编不出来。<b>硬编一个给你看，你就会照着它去面板上操作</b>，扫出来的文件也没人认领。</p>
          </ScanNoteCard>
        </div>
      )}
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
  scanTaskId: string
  countdown: string
  rescanRequested: boolean
  plainRestartChosen: boolean
  restoredFromStorage: boolean
}

export function ScanSettingsSessionFacts({
  scanType,
  scanTaskId,
  countdown,
  rescanRequested,
  plainRestartChosen,
  restoredFromStorage,
}: ScanSettingsSessionFactsProps) {
  // 「本次性质」那一行（四种互斥情况与各自的理由见 scanSettingsModel）。
  const natureRow = sessionNatureRow({ rescanRequested, plainRestartChosen, restoredFromStorage })
  return (
    <ScanSec no="03" title="这次会话">
      <div className="sw-grid2">
        <ScanKvCard
          title="任务信息"
          rows={[
            ['扫描类型', SCAN_TYPE_LABELS[scanType]],
            ['任务编号', scanTaskId],
            ['剩余时间', countdown],
            ['输出格式', SCAN_OUTPUT_FORMAT_PENDING],
            ...(natureRow ? [natureRow] : []),
            ['控制凭证', '不上屏、不进链接；本次一体机会话内存里，换人清场会清掉'],
          ]}
        />
        <ScanNoteCard title="按完面板之后" foot={<><ClockIcon size={16} aria-hidden /> 任务剩余 {countdown}。仅当前会话有效。点击返回会取消这个未确认的任务。</>}>
          <ScanPlan items={[
            ...(rescanRequested
              ? ['把刚才那份原件照原样放回去 —— 这一次服务端认它，不会当成重复件拒掉。']
              : []),
            '点「我已操作，开始等待」。',
            '进了等待页本机就每隔几秒自动查一次，你不用一直点。',
            '文件回来之前不显示扫到第几张：链路上没有这种事件。',
          ]} />
        </ScanNoteCard>
      </div>
    </ScanSec>
  )
}
