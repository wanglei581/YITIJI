import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { scanCleanupHolding, subscribeScanCleanup } from './scanCleanupGate'
import type { ScanAckState } from './scanDeliveryAck'
import type { ScanType } from './scanWorkbench'
import type { ScanLiveState } from './scanWorkbenchSession'
import {
  subscribeTerminalSession,
  terminalSessionState,
  type TerminalSessionState,
} from '../../services/terminalAuth'

/**
 * 设置页那一组「这一场此刻是什么处境」的状态位，连同推进其中两位的订阅。
 *
 * 搬出来的理由和 `scanSettingsModel` / `scanSettingsTeardown` / `ScanSettingsStatusView`
 * 同一条：`ScanSettingsPage` 贴着 CLAUDE.md §8 的 800 行硬线。判据、初值、注释一个字都没改 ——
 * 页面拿回去的仍然是同名的 state 与 setter，读写它们的每一处也原样不动。
 *
 * 分界线是「位」和「这一场的数据」：
 *   · 搬进来的是位 —— 性质标注（rescanRequested / plainRestartChosen）、进度
 *     （replayingLostCreate / ackState）、fail-closed（rescanRefusedByServer / ackRefused /
 *     liveNotDurable / cleanupHolding）、以及终端身份（terminalSession）；
 *   · 留在页面里的是这一场的数据 —— phase / failure / instructions / scanTaskId /
 *     controlToken / expiresAt / countdown，它们要和写它们的那几段挨着看。
 *
 * 两条订阅跟着各自那一位一起搬：它们是那一位**唯一**的推进方式，分开放就会有人以为
 * 那一位可以由页面自己写。注册顺序没变（终端在前、收尾闸在后，两条都排在创建 effect 之前），
 * 两个 setter 也因此不必交出去。
 *
 * 有一位例外，刻意留在页面：`rescanCredentialsLost`。它的初值是**挂载那一刻算一次**的判断，
 * 读的就是紧挨着它的 stored / restoredLive，拆开看就读不懂了。
 */
export interface ScanSettingsFlags {
  rescanRequested: boolean
  setRescanRequested: Dispatch<SetStateAction<boolean>>
  plainRestartChosen: boolean
  setPlainRestartChosen: Dispatch<SetStateAction<boolean>>
  rescanRefusedByServer: boolean
  setRescanRefusedByServer: Dispatch<SetStateAction<boolean>>
  rescanRetryable: boolean
  setRescanRetryable: Dispatch<SetStateAction<boolean>>
  replayingLostCreate: boolean
  setReplayingLostCreate: Dispatch<SetStateAction<boolean>>
  ackState: ScanAckState
  setAckState: Dispatch<SetStateAction<ScanAckState>>
  ackRefused: boolean
  setAckRefused: Dispatch<SetStateAction<boolean>>
  liveNotDurable: boolean
  setLiveNotDurable: Dispatch<SetStateAction<boolean>>
  /** 只读：唯一的推进方式是本模块里那条订阅。 */
  terminalSession: TerminalSessionState
  /** 只读：同上。 */
  cleanupHolding: boolean
}

export function useScanSettingsFlags(input: {
  restoredLive: ScanLiveState | null
  scanType: ScanType | null
}): ScanSettingsFlags {
  const { restoredLive, scanType } = input
  // 本次创建是否带了一次性安全重扫授权。只用于**如实说明**这一次是什么性质的会话
  // （成功时告诉用户可以照原样再扫同一份材料），不参与任何放行判断 ——
  // 授权成不成立由服务端判，本机只负责不把话说反。
  const [rescanRequested, setRescanRequested] = useState(false)
  // 用户在 fail-closed 那一屏显式按了「重新开始一次扫描」。只用于如实标注这一场的性质：
  // 它是一次普通会话，而且是他自己选的，不是本页悄悄降级的。
  const [plainRestartChosen, setPlainRestartChosen] = useState(false)
  /**
   * 服务端把这次安全重扫判为不作数（SCAN_RESCAN_REJECTION_CODES）。
   *
   * 和 `rescanCredentialsLost` 分开两个变量而不是合成一个，是因为它们的**成因**不同，
   * 正文要说的话也不同（本机取不到 vs 服务端不认）。但它们给的出路必须是同一个：
   * 一个显式的、写清代价的「重新开始一次扫描」。合并成一个布尔会让正文只能二选一地
   * 说假话；各自留一个，CTA 那里取并集。
   */
  const [rescanRefusedByServer, setRescanRefusedByServer] = useState(false)
  /**
   * 创建失败了，但失败码**证明不了服务端已经消费**那枚授权（429 / 断网 / 5xx /
   * `SCAN_TERMINAL_BUSY` / 终端票失效）。凭据已被原样放回，所以出路不是
   * 「重新开始一次扫描」，而是再发一次同样成对的请求。
   *
   * 和另外两位分得很清楚：那两位是「安全重扫这条路走不通了」，只能显式开普通会话；
   * 这一位是「路还通着，只是这一次没发出去」—— 降级反而会让同一张纸撞上两小时的
   * 同字节去重。所以 CTA 里它排在最前面。
   */
  const [rescanRetryable, setRescanRetryable] = useState(false)
  /**
   * 第一次配对创建的响应丢了，本机正在把**同一对**请求重放，去把可能已经建成的那条
   * child 领回来（见 scanCreateReplay）。
   *
   * 只影响等待屏那句话怎么说：这一刻「正在建扫描会话」已经不准确了 —— 会话可能早就
   * 建成，丢的只是回话。屏幕上必须说得出这个区别，否则用户会以为什么都没发生，
   * 转身去面板上扫一张纸，而那条 child 正等着收它。
   *
   * 刻意**不**进 effect 依赖：它是同一次创建意图内部的进度，不是一次新的创建触发条件。
   */
  const [replayingLostCreate, setReplayingLostCreate] = useState(false)
  /**
   * 投递授权（ACK）的进度。这一位决定**面板操作指引出不出得来**：服务端 2026-09-14
   * 起把「建成」和「可投递」拆开了，'acked' 之前扫出来的文件不会投到这一场
   * （完整契约见 scanDeliveryAck）。复水进来的会话一开始就是 'pending'，理由同上。
   */
  const [ackState, setAckState] = useState<ScanAckState>(restoredLive && scanType ? 'pending' : 'idle')
  /**
   * 服务端明确不认这一场的投递授权（409 / 403 / 404）。
   *
   * 和 `rescanCredentialsLost` / `rescanRefusedByServer` 并列的第三种 fail-closed：
   * 成因不同（这一条是「会话建出来了却拿不到投递授权」），出路同样只剩一个显式的
   * 「重新开始一次扫描」。它必须进创建 effect 的依赖 —— 置位时让 effect 早退，
   * 用户按下重启复位时让它重跑并发出那一次新的创建。
   */
  const [ackRefused, setAckRefused] = useState(false)
  /* 会话建成了，本机却没能把它的凭据真正写进登记（写完读回来对不上）。第四种 fail-closed，
   * 也是唯一**不给重来按钮**的：存储坏了 / 被禁用 / 写满，重建只会在同一处再失败一次。
   * 不进 effect 依赖 —— 这一支同时立起 creationAbandonedRef，那道闸已经让 effect 到此为止。 */
  const [liveNotDurable, setLiveNotDurable] = useState(false)
  // POST /scan/sessions 挂着 TerminalIdentityGuard（scan-tasks.controller.ts）：
  // 没有终端会话令牌就是 401。和打印确认页同一口径 —— 订阅状态，不猜、不抢跑。
  const [terminalSession, setTerminalSession] = useState<TerminalSessionState>(() => terminalSessionState())
  useEffect(() => subscribeTerminalSession(setTerminalSession), [])
  /**
   * 上一位的扫描还没收完尾（scanCleanupGate 仍在等服务端确认那条任务已经取消）。
   *
   * 第五种 fail-closed，成因在**上一位**身上而不是这一场：服务端的租约取的是这台
   * 终端最早那条「已确认 + waiting」的行，现在建会话，下一位扫出来的纸会落到上一位
   * 名下。所以这一刻一个创建请求都不发，屏上也不出现任何面板指引。
   *
   * 和另外四位不同，它不需要用户按任何按钮：收尾是本机自己在重试，
   * 订阅一变 false，页面那条创建 effect 就会重跑并把这一次创建正常发出去。
   */
  const [cleanupHolding, setCleanupHolding] = useState(() => scanCleanupHolding())
  // 收尾闸的状态只由它自己推进（重试成功 / 自然过期），所以订阅，不轮询。
  useEffect(() => subscribeScanCleanup(() => setCleanupHolding(scanCleanupHolding())), [])

  return {
    rescanRequested, setRescanRequested,
    plainRestartChosen, setPlainRestartChosen,
    rescanRefusedByServer, setRescanRefusedByServer,
    rescanRetryable, setRescanRetryable,
    replayingLostCreate, setReplayingLostCreate,
    ackState, setAckState,
    ackRefused, setAckRefused,
    liveNotDurable, setLiveNotDurable,
    terminalSession,
    cleanupHolding,
  }
}
