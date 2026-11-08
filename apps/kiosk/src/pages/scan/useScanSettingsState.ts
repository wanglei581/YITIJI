import { useEffect, useRef, useState } from 'react'
import type { ScanSessionCreateResponse } from '@ai-job-print/shared'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { RESCAN_CREDENTIALS_LOST_FAILURE, type SessionFailure } from './scanRescanRecovery'
import type { SessionPhase } from './scanSettingsModel'
import { useScanSettingsFlags } from './scanSettingsFlags'
import { createScanSessionTeardown } from './scanSettingsTeardown'
import type { ScanType } from './scanWorkbench'
import {
  scanRescanCredentialsLost,
  type ScanLiveState,
  type ScanWorkbenchSession,
} from './scanWorkbenchSession'

/**
 * 设置页「这一场」的全部状态位与引用，连同由它们装配出来的四种收场。
 *
 * 2026-11-02 K1a 拆分：此前这些声明、六段 effect、六个处理函数和渲染全挤在
 * `ScanSettingsPage.tsx` 一个文件里（784 行，离 CLAUDE.md §8 的 800 行硬线只差 16 行），
 * 而下一步要往这页里加屏上扫描。按职责拆开之后各文件的分工是：
 *   · 本文件 —— 状态位与引用的声明（含 `scanSettingsFlags` 那一组、`scanSettingsTeardown` 装配出的四种收场），
 *     以及紧挨着 `unmountedRef` 的忙碌锁和卸载标记 effect；
 *   · `useScanSessionCreate` —— 复水补身份、创建会话那一大段 effect、静默期倒计时；
 *   · `useScanSettingsDeliveryAck` —— 投递确认（ACK）；
 *   · `useScanSettingsExpiry` —— 服务端有效期倒计时与到期处置；
 *   · `useScanSettingsActions` —— 六个按钮处理函数；
 *   · `ScanSettingsPage` —— 读路由 state 与本机登记，把上面这些装起来，再渲染。
 *
 * **只搬不改**：判据、初值、顺序、注释一个字都没动。唯一的形变是 hook 之间靠这一份
 * 返回值交接（页面把它整份传给各个 hook），各 hook 开头把用到的名字原样解构出来，
 * 所以下面每一段代码读起来和拆分前在页面里一模一样。hook 的调用顺序（于是 effect 的
 * 注册顺序）与拆分前完全一致：flags 的两条订阅 → 忙碌锁 → 卸载标记 → 复水补身份 →
 * 创建 → 静默期倒计时 → 投递确认 → 到期倒计时（前三项在本文件里，其余依次在后面几个 hook 里）。
 */
export function useScanSettingsState(input: {
  stored: ScanWorkbenchSession | null
  scanType: ScanType | null
  restoredLive: ScanLiveState | null
}) {
  const { stored, scanType, restoredLive } = input
  /**
   * fail-closed：本页是带着「安全重扫意图」进来的，凭据却已经不在内存里。
   *
   * 唯一的成因是整页重载（授权刻意只活在内存里，看门狗一重载就没了，而登记里那笔
   * 意图还在）。**这一刻绝不能照常发普通创建**：用户按的是「同一份材料」，手里还是
   * 同一张纸，普通会话回传时会被服务端两小时的同字节去重拒掉，任务停在 waiting
   * 直到过期 —— 人在机器前白等十分钟，屏幕上全程没有一句话解释。
   *
   * 必须是**挂载那一刻算一次**的状态，不能每帧重算。每帧重算试过，会坏在这里：
   * 正常的安全重扫路径上，创建 effect 一开跑就把授权取走（一次性），槽位随即变空 ——
   * 下一帧重算就会把一场**正在正常创建**的会话判成「凭据没了」，effect 因依赖变化重跑
   * 并在 fail-closed 处早退，于是再没有人给那个还在飞的响应挂处置：页面永远停在
   * 「正在创建扫描任务」，服务端那个任务也没人认领。
   *
   * 唯一允许它改口的是用户显式按下「重新开始一次扫描」（handlePlainRestart）。
   */
  const [rescanCredentialsLost, setRescanCredentialsLost] = useState(() =>
    scanRescanCredentialsLost({ session: stored, scanType, restoredLive }),
  )

  const [phase, setPhase] = useState<SessionPhase>(
    rescanCredentialsLost
      ? 'error'
      : restoredLive && scanType
        ? 'success'
        : scanType
          ? 'loading'
          : 'invalid',
  )
  const [failure, setFailure] = useState<SessionFailure | null>(
    rescanCredentialsLost ? RESCAN_CREDENTIALS_LOST_FAILURE : null,
  )
  const [instructions, setInstructions] = useState<string[] | null>(restoredLive?.instructions ?? null)
  const [starting, setStarting] = useState(false)
  const [scanTaskId, setScanTaskId] = useState<string | null>(restoredLive?.scanTaskId ?? null)
  const [expiresAt, setExpiresAt] = useState<string | null>(restoredLive?.expiresAt ?? null)
  const [countdown, setCountdown] = useState('剩余 -- 分 -- 秒')
  const [quietPeriodRemaining, setQuietPeriodRemaining] = useState(0)
  const [quietPeriodBlocked, setQuietPeriodBlocked] = useState(false)
  const [controlToken, setControlToken] = useState<string | null>(restoredLive?.controlToken ?? null)
  /**
   * 这一场的状态位（性质标注 / 进度 / fail-closed / 终端身份 / 收尾闸）连同推进后两位的
   * 那两条订阅，整组搬进了 `scanSettingsFlags.ts` —— 理由和 `scanSettingsTeardown` 同一条：
   * 本页贴着 CLAUDE.md §8 的 800 行硬线。判据、初值与各自的成因说明一个字都没改，
   * 下面读写它们的每一处也原样不动。
   *
   * `rescanCredentialsLost` 刻意留在上面没跟着搬：它的初值是**挂载那一刻算一次**的判断，
   * 读的就是紧挨着它的 stored / restoredLive，拆开看就读不懂了。
   */
  const {
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
  } = useScanSettingsFlags({ restoredLive, scanType })

  const confirmedRef = useRef(false)
  const createdIdRef = useRef<string | null>(restoredLive?.scanTaskId ?? null)
  const controlTokenRef = useRef<string | null>(restoredLive?.controlToken ?? null)
  /**
   * 挂载那一刻这一场就已经在本机登记里了 —— 也就是说它是**复水**出来的，不是本页
   * 这一次创建的（看门狗整页重载、从别处回到本阶段都会走这条）。
   *
   * 必须锁在初次渲染（ref），不能每次渲染重算：创建成功之后本页自己会把 live 写回
   * 登记，重算的话下一帧 `restoredLive` 就非空了，一个刚刚在本页建成的会话会被说成
   * 「本页重载过」—— 那是句假话。skipCreateRef 从同一个判断派生，两者本来就是同一件事。
   */
  const restoredFromStorageRef = useRef(Boolean(restoredLive && scanType))
  /**
   * 这一场是带着「同一份材料」的意图进来的（`beginScanRescan` 在跳过来之前写的登记位）。
   *
   * 挂载时取一次，此后只由用户显式按下「重新开始一次扫描」改成 false。
   *
   * 它守的是**延迟取用**那个洞：`rescanCredentialsLost` 是挂载那一刻算一次的
   * （必须如此，理由见它自己的注释），而真正取用授权的那一刻可能
   * 晚得多 —— 终端会话在换票时本页会停在 checking 等着，等完才创建。这中间本地 15 分钟
   * 窗口可能走完、别处可能清过场，于是取用返回 null。没有这一位的话，下一行就会照常
   * 发一个**不带签名**的普通创建：用户按的是「同一份材料」，手里还是同一张纸，
   * 回传时被两小时同字节去重拒掉，人在机器前白等十分钟。
   * 有了它，那一刻 fail-closed，一个请求都不发。
   */
  const rescanIntentRef = useRef(stored?.rescanIntent === true)
  const skipCreateRef = useRef(restoredFromStorageRef.current)
  const sessionPromiseRef = useRef<Promise<ScanSessionCreateResponse> | null>(null)
  const cancelRequestedRef = useRef(false)
  const expiryHandledRef = useRef(false)
  // 发出创建请求那一刻的扫描生命周期代次，以及当时用的那个会员身份。
  // 响应回来时用代次判断「这一场还在不在」，用身份把任务撤干净——
  // 服务端 cancel() 校验 endUserId，清场之后 getToken() 已经是空的，
  // 拿它发只会 403：看起来撤了，其实没撤。
  const createGenerationRef = useRef<number | null>(null)
  const createTokenRef = useRef<string | null>(null)
  /**
   * 已经为哪一条任务发起过投递确认。防的是一个真实的死循环：创建那段 `.then` 挂在
   * `sessionPromiseRef` 上，effect 每次重跑都会给同一个**已经 resolve** 的 promise
   * 再挂一遍处置并重跑成功分支 —— 无条件置位的话，那里的 `setAckState('pending')`
   * 会把刚确认好的 'acked' 打回去，两个 effect 互相喂招，永不停。
   */
  const ackRequestedForRef = useRef<string | null>(restoredLive?.scanTaskId ?? null)
  // 「本页已经不在了」。刻意不复用 effect 的 cancelled：那个标志每次依赖变化
  // （终端会话 checking / ready 来回切）都会置位，拿它当卸载判据会把一次正常的
  // 终端重校验误判成「用户走了」，把一个好好的会话撤掉。
  const unmountedRef = useRef(false)
  // 终端身份在本次创建在飞期间 fail-closed，且页面已据此对用户宣告失败。
  // 这一场不会再有人使用，响应回来必须把任务撤掉（否则它停在 waiting 收下一位的文件）。
  const terminalFailClosedRef = useRef(false)
  // 这一次创建已经被丢弃：手里那份响应指向的任务已经 DELETE 掉了。
  //
  // 和 terminalFailClosedRef 的分工，是这条存在的全部理由：那条描述「终端此刻证明不了
  // 自己」，终端一回到 ready 就作废；这条描述「那个任务已经撤了」，**不可逆** ——
  // 服务端不会因为终端恢复而把它变回 waiting。
  const creationAbandonedRef = useRef(false)

  useBusyLock(phase === 'loading' || phase === 'success' || starting)

  /**
   * 「这一场到此为止」的四种收场（取消 / 放弃 / 丢弃 / 投递授权被拒）。
   *
   * 判据、顺序、注释原样搬进了 `scanSettingsTeardown.ts`，这里只做装配：它们要读的
   * ref 和要改的 state 全在本组件里，所以按值传进去，而不是让那个文件自己去拿。
   * 搬家的唯一理由是 CLAUDE.md §8 的 800 行硬线。
   */
  const { cancelSessionOnce, abandonCreatedSession, discardCreatedSession, failClosedOnAckRefusal } =
    createScanSessionTeardown(
      {
        cancelRequestedRef,
        createTokenRef,
        createdIdRef,
        controlTokenRef,
        ackRequestedForRef,
        sessionPromiseRef,
      },
      {
        setScanTaskId,
        setControlToken,
        setInstructions,
        setExpiresAt,
        setAckState,
        setAckRefused,
        setFailure,
        setPhase,
      },
    )

  // 只认卸载：空依赖，终端会话状态怎么变都不会重跑。
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  return {
    // 这一场的数据（要和写它们的那几段挨着看，所以不归 scanSettingsFlags）
    rescanCredentialsLost, setRescanCredentialsLost,
    phase, setPhase,
    failure, setFailure,
    instructions, setInstructions,
    starting, setStarting,
    scanTaskId, setScanTaskId,
    expiresAt, setExpiresAt,
    countdown, setCountdown,
    quietPeriodRemaining, setQuietPeriodRemaining,
    quietPeriodBlocked, setQuietPeriodBlocked,
    controlToken, setControlToken,
    // 状态位（scanSettingsFlags）
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
    // 引用
    confirmedRef,
    createdIdRef,
    controlTokenRef,
    restoredFromStorageRef,
    rescanIntentRef,
    skipCreateRef,
    sessionPromiseRef,
    cancelRequestedRef,
    expiryHandledRef,
    createGenerationRef,
    createTokenRef,
    ackRequestedForRef,
    unmountedRef,
    terminalFailClosedRef,
    creationAbandonedRef,
    // 四种收场（scanSettingsTeardown）
    cancelSessionOnce,
    abandonCreatedSession,
    discardCreatedSession,
    failClosedOnAckRefusal,
  }
}

/** 各个 hook 之间交接的就是这一整份。 */
export type ScanSettingsSession = ReturnType<typeof useScanSettingsState>
