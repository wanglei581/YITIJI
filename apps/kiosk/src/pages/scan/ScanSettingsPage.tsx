import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ScanSessionCreateResponse } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { getTerminalId } from '../../services/api/screensaver'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { createScanSession } from '../../services/api/scanTasks'
import { replayCreateUntilOutcomeKnown } from './scanCreateReplay'
import { acknowledgeScanDelivery, type ScanAckCredentials, type ScanAckState } from './scanDeliveryAck'
import { ScanSettingsSessionFacts, ScanSettingsStatusView } from './ScanSettingsStatusView'
import {
  formatCountdown,
  getCancellationCredentials,
  isValidCreatedSession,
  liveSessionStillValid,
  SCAN_CLEANUP_HOLD_FAILURE,
  SCAN_LIVE_NOT_DURABLE_FAILURE,
  type SessionPhase,
} from './scanSettingsModel'
import {
  scanCleanupHolding,
  scanCleanupInProgress,
  subscribeScanCleanup,
  trackScanSessionCreation,
} from './scanCleanupGate'
import { createScanSessionTeardown } from './scanSettingsTeardown'
import {
  subscribeTerminalSession,
  terminalSessionState,
  type TerminalSessionState,
} from '../../services/terminalAuth'
import { errorCodeOf, userMessageOf } from '../../services/api/userErrorMessage'
import {
  classifyCreateFailure,
  isRescanRefusedByServer,
  RESCAN_CREDENTIALS_LOST_FAILURE,
  type SessionFailure,
} from './scanRescanRecovery'
import {
  ScanChain,
  ScanCta,
  ScanPanelMock,
  ScanSec,
  ScanWorkbenchShell,
} from './ScanWorkbenchChrome'
import { SCAN_TYPE_LABELS, type ScanType } from './scanWorkbench'
import { type ScanStage } from './scanWorkbenchModel'
import {
  beginPlainScanRestart,
  discardTakenScanRescanAuthority,
  patchScanWorkbenchSession,
  patchScanWorkbenchSessionWithDurableLive,
  readScanWorkbenchSession,
  restoreScanRescanAuthority,
  scanLifecycleGeneration,
  scanRescanCredentialsLost,
  takeScanRescanAuthority,
} from './scanWorkbenchSession'

function isScanType(value: unknown): value is ScanType {
  return value === 'resume' || value === 'id' || value === 'document'
}

interface LocationState {
  scanType?: unknown
}

export function ScanSettingsPage({ onGoStage }: { onGoStage?: (stage: ScanStage) => void } = {}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as LocationState
  const stored = readScanWorkbenchSession()
  const storedType = stored?.scanType
  const storedLive = stored?.live
  const scanType = isScanType(state.scanType)
    ? state.scanType
    : isScanType(storedType)
      ? storedType
      : null
  const restoredLive = liveSessionStillValid(storedLive) ? storedLive : null
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
  const [countdown, setCountdown] = useState('--:--')
  const [controlToken, setControlToken] = useState<string | null>(restoredLive?.controlToken ?? null)
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
  /**
   * 上一位的扫描还没收完尾（scanCleanupGate 仍在等服务端确认那条任务已经取消）。
   *
   * 第五种 fail-closed，成因在**上一位**身上而不是这一场：服务端的租约取的是这台
   * 终端最早那条「已确认 + waiting」的行，现在建会话，下一位扫出来的纸会落到上一位
   * 名下。所以这一刻一个创建请求都不发，屏上也不出现任何面板指引。
   *
   * 和另外四位不同，它不需要用户按任何按钮：收尾是本机自己在重试，
   * 订阅一变 false，本 effect 就会重跑并把这一次创建正常发出去。
   */
  const [cleanupHolding, setCleanupHolding] = useState(() => scanCleanupHolding())

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

  useEffect(() => subscribeTerminalSession(setTerminalSession), [])

  // 只认卸载：空依赖，终端会话状态怎么变都不会重跑。
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  /* 复水进来的那一场没走过创建，身份快照是空的。挂载这一刻补一份：撤销与确认都要用
   * 「建这一场的那个身份」发（服务端按 endUserId 校验），而复水之后当前身份就是它 ——
   * 换过人的话本机登记早就被清场抹掉了，根本复水不出来。补在这里而不是等确认 effect：
   * 用户可能在确认回来之前就按下「返回（取消任务）」，那一刻 createTokenRef 不能是空的。 */
  useEffect(() => {
    if (restoredFromStorageRef.current && createTokenRef.current === null) {
      createTokenRef.current = getToken()
    }
    // getToken 是 AuthContext 里的稳定回调（只读 ref），不构成重跑理由。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 收尾闸的状态只由它自己推进（重试成功 / 自然过期），所以订阅，不轮询。
  useEffect(() => subscribeScanCleanup(() => setCleanupHolding(scanCleanupHolding())), [])

  useEffect(() => {
    if (!scanType) return
    if (skipCreateRef.current) return
    // 这一次创建已经被丢弃并撤销：服务端那个任务已经不在了，这条 effect 到此为止。
    //
    // 终端身份恢复（failed → ready）会让本 effect 再跑一次，但它**不能**把这一场接回来：
    //   · 不重新挂那个已经 resolve 的 promise —— 它手里那份响应指向一个已经撤掉的任务，
    //     写成成功等于把用户支到面板上去扫一份没人认领的文件，还会把这份作废的凭证
    //     重新写回本机登记；
    //   · 也不在这里顺手重建一次 —— 页面已经对用户宣告过「终端安全校验失败」，
    //     恢复路径只有「安全返回扫描首页」重走一遍，扫不扫由用户自己决定。
    if (creationAbandonedRef.current) return
    /* fail-closed：会话建出来了，服务端却明确不给它投递授权（409 / 403 / 404）。
     * 那一场已经被撤掉、本机登记也清了，这条 effect 到此为止 —— 不许顺手重建一次：
     * 页面刚刚对用户宣告过结论，重不重开由他按「重新开始一次扫描」决定。
     * 那一按会把这一位复位，effect 随之重跑并发出那一次新的创建。 */
    if (ackRefused) return
    /* fail-closed：带着安全重扫意图进来，凭据却已经不在内存里（整页重载抹掉的）。
     * 这一条必须排在终端会话那两个分支**之前** —— 页面此刻要说的是「凭据没了」，
     * 不是「正在做终端安全校验」。它是这次修复的核心：这里 return 掉的正是那一个
     * 会悄悄发出去的普通创建。用户按下「重新开始一次扫描」之后，
     * rescanCredentialsLost 当帧变 false，本 effect 再跑一次，那时才创建。 */
    if (rescanCredentialsLost) return
    /* fail-closed：上一位的扫描还没收完尾。排在终端会话那两个分支之前 —— 这一刻
     * 要说的是「还在收上一场的尾」，不是「正在做终端安全校验」。一个请求都不发：
     * 服务端的租约取的是这台终端最早那条「已确认 + waiting」的行，现在建会话，
     * 这一位扫出来的纸会落到上一位名下。收完尾订阅会把这一位打回 false，
     * effect 随之重跑并正常创建。 */
    if (cleanupHolding) {
      setFailure(SCAN_CLEANUP_HOLD_FAILURE)
      setPhase('error')
      return
    }
    // 终端安全会话还在换票：什么都不发，页面停在等待态。抢跑只会拿回一个 401，
    // 还会把一次「本可以成功」的创建写成失败。
    if (terminalSession === 'checking') return
    if (terminalSession === 'failed') {
      // 终端身份是 fail-closed 的：这台机器现在证明不了自己是谁，就不创建扫描任务。
      // 恢复由 terminalAuth 负责（续期 / 向本机 Agent 重新取票）；一旦回到 ready，
      // 这个 effect 会再跑一次并正常创建。已经建成的会话不受影响。
      //
      // 判据是「已经**建成**」（createdIdRef）而不是「已经**发起**」（sessionPromiseRef）：
      // 终端会话被吊销时，那次创建多半还在飞，而 retryRefresh 先把状态推到 checking、
      // 再推到 failed —— 依赖一变，上一轮 effect 的清理就把 cancelled 置了位，
      // 那次创建随后 reject 时 `.catch` 第一行 `if (cancelled) return` 会把结论吞掉，
      // 而 checking / failed 两个分支都在挂新 then/catch 之前就 return 了，没有人再写结论。
      // 按「已经发起」判的后果是页面永远停在「正在创建扫描任务」——
      // 把一个已经 fail-closed 的终端说成「还在加载」，正是 CLAUDE.md §9 不允许的伪造状态。
      if (!createdIdRef.current) {
        // 页面就此对用户宣告失败。如果那次创建其实成功了（响应还在路上），
        // 它回来时就是个没人认领的任务 —— 登记这一笔，让它到时候把自己撤掉。
        terminalFailClosedRef.current = true
        setFailure({
          title: '终端安全校验失败',
          description: userMessageOf(
            { code: 'TERMINAL_SESSION_INVALID' },
            '终端安全校验失败，请联系现场工作人员',
          ),
        })
        setPhase('error')
      }
      return
    }

    // 回到 ready：上面那句失败结论作废（响应回来时按正常成功处理，不再撤销）。
    terminalFailClosedRef.current = false
    let cancelled = false

    if (!sessionPromiseRef.current) {
      setFailure(null)
      setPhase('loading')
      /* 身份**只取一次**，此后这一场的创建、重放、撤销全用这一份快照。
       *
       * 此前是两处取值：这里写一次 `createTokenRef.current = getToken()`，下面的
       * `sendCreate` 里又写一次 `getToken()` —— 中间隔着最长 24 秒的丢失响应重放。
       * 用户在那 24 秒里退出 / 换人 / 会话过期的话，重放会用**新身份**去建任务
       * （或者变成一次匿名创建），而 createTokenRef 里还是旧的那一个；撤销时服务端
       * 按 endUserId 校验，只会 403。于是那条 child 以另一个人的名义活着，
       * 谁都撤不掉，一直等到自然过期。所以三件事必须绑同一份身份。 */
      createGenerationRef.current = scanLifecycleGeneration()
      const identityToken = getToken()
      createTokenRef.current = identityToken
      // 授权只取一次，且必须和代次在同一个同步块里取（按代次校验，隔一次 await
      // 就可能取到属于上一场的那一份）。取到 null 有两种含义，下一行的闸门负责分开：
      // 用户从头新开一场 = 正常，发普通创建；意图还在却取不到 = 延迟取用，什么都不发。
      const rescan = takeScanRescanAuthority(scanType)
      // 延迟取用闸门。判据、成因与「为什么锁在 ref 里」见 rescanIntentRef 的声明处。
      // 早退之前不碰 sessionPromiseRef（仍是 null），用户显式按下「重新开始一次扫描」
      // 之后 effect 重跑就能正常发出那一次普通创建。
      if (!rescan && rescanIntentRef.current) {
        setRescanCredentialsLost(true)
        setFailure(RESCAN_CREDENTIALS_LOST_FAILURE)
        setPhase('error')
        return undefined
      }
      setRescanRequested(rescan !== null)
      /* 同一对请求的**唯一**发送口。重放必须复用这一个闭包 —— 另写一处调用就可能漏带
       * 那两半，而漏带的那一次是一个无签名的普通创建。 */
      const sendCreate = () => createScanSession(
        { scanType, terminalId: getTerminalId() },
        identityToken,
        rescan,
      )
      /* 「结果未知」时把同一对请求重放到有答案为止（有界退避，只对配对请求）。
       * 服务端对配对创建是幂等的：重放拿回的是**同一条** child，不会多建一条。
       * 边界、退避表与「为什么只吃未知态」见 scanCreateReplay。
       * 这里不另挂 then/catch：重放的结果照旧落进下面那一套生命周期闸门，
       * 于是「离开 / 清场 / 换人 / 卸载之后领回来的 child」会被同一段代码撤掉。 */
      sessionPromiseRef.current = replayCreateUntilOutcomeKnown(sendCreate, rescan !== null, {
        onReplay: () => setReplayingLostCreate(true),
        /* 清场开始之后不再发新的重放：这一位已经走了，把 child 领回来没有意义，
         * 而重放最长 24 秒 —— 那段时间清场屏只能干等着。收手之后那条 child 仍然安全
         * （本机不知道它的 id，永远不会确认它；未确认的 waiting 对 Agent 不可见）。
         * 判据用 scanCleanupInProgress 而不是代次：页内离开（leaveScanFlow）也会推进
         * 代次，而那条路径上执行环境还在，重放领回来的 child 会被当场撤掉，更干净。 */
        shouldContinue: () => !scanCleanupInProgress(),
      })
      /* 把这一次创建交给收尾闸看着，连同身份快照。
       *
       * 清场发生在创建在飞的那一刻时，本机登记里还没有 live —— 闸从登记里读不到任何
       * 可撤的东西，而本页的 `.then` 会被整页重载连同执行环境一起干掉。交给闸之后，
       * 响应落地那一刻由它按同一份身份把任务撤掉，并在此期间把重载按住。 */
      trackScanSessionCreation(sessionPromiseRef.current, identityToken)
    }

    sessionPromiseRef.current
      .then((created) => {
        // 2xx = 服务端真的跑过 handler，事务里的 CAS 已经消费掉那枚授权。所以无论这份
        // 响应本身可不可用（字段缺失、页面已离开都算），寄存的那一份都必须永久丢弃。
        discardTakenScanRescanAuthority()
        const cancellationCredentials = getCancellationCredentials(created)
        if (cancellationCredentials) {
          createdIdRef.current = cancellationCredentials.scanTaskId
          controlTokenRef.current = cancellationCredentials.controlToken
        }

        /* ── 生命周期闸门：这个响应还属于「这一场扫描」吗 ─────────────────────
         *
         * 三种情况都意味着「没有人会再用这个刚建成的任务」：
         *   · 代次变了 —— 清场（隐私空闲 / 退出 / 屏保）、离开扫描流程、安全返回，
         *     全都在抹掉本机登记**之前**同步推进代次；
         *   · 本页已卸载而用户从未确认 —— 他没走到等待页，任务不会有人认领；
         *   · 终端身份在此期间 fail-closed，页面已据此对他宣告失败。
         *
         * 这一刻必须做两件事，且**先于任何写回**：
         *   1. 绝不回写本机登记 —— 清场刚把它抹掉，写回去等于把上一位的收件箱
         *      重新立起来，下一位在面板上按下扫描，文件就投给了他；
         *   2. 用手里这份凭证把服务端任务撤掉 —— 不撤它就停在 waiting，
         *      和上面是同一个后果，只是本机连界面都不再提它，更难被发现。
         *
         * 此前这里的判据是「只有用户显式点过返回才撤」，
         * 于是清场和卸载这两条最常见的路径全都留下孤儿任务。 */
        const createGeneration = createGenerationRef.current
        const lifecycleEnded = createGeneration === null
          || scanLifecycleGeneration() !== createGeneration
        const abandoned = !confirmedRef.current
          && (lifecycleEnded || unmountedRef.current || terminalFailClosedRef.current)
        if (abandoned) {
          // 先登记再撤：登记这一笔之后，本 effect 不会再为这一场做任何事。
          creationAbandonedRef.current = true
          if (cancellationCredentials) abandonCreatedSession(cancellationCredentials)
          return
        }

        if (!isValidCreatedSession(created)) {
          if (cancellationCredentials) {
            cancelSessionOnce(cancellationCredentials.scanTaskId, cancellationCredentials.controlToken)
          }
          // status 必须**非 0**：本仓约定 status===0 表示「压根没拿到 HTTP 响应」
          // （networkError 就是这么造的），下面的 catch 据此判 outcomeUnknown 并显示
          // 「网络连接中断，无法确认服务端是否收到请求」。而这里的情况恰恰相反——
          // 服务端**回了** 2xx，只是响应体缺字段。用 0 会让页面对用户说反话，
          // 还会走进「为避免重复创建不自动重发」那条本不适用的分支。
          throw new ApiHttpError('INVALID_SCAN_SESSION', '扫描任务未创建成功，请返回重试', 200)
        }

        if (cancelled) {
          // 走到这里说明：这一场还活着、本页还挂着、只是本轮 effect 已经过时
          // （终端会话状态变过一次）。撤销与否已经由上面的闸门判完，这里什么都不做，
          // 把结论留给仍然有效的那一轮 —— 它挂在同一个 promise 上，随后就会跑。
          return
        }

        /* 先把凭据写进本机登记并**读回核对**，核不上就一步都不再往下走。「写过了」不是判据：
         * setItem 可能抛（已被吞），更可能静默什么都不做（隐私模式 / 配额满 / 被改写过的
         * storage）。没真正记住却照常 ACK，服务端那条任务就变得可投递，而整页重载之后本机
         * 再也找不回它 —— 又一个「可投递却没人看着」的收件箱。 */
        const live = {
          scanTaskId: created.scanTaskId,
          controlToken: created.controlToken,
          instructions: created.instructions,
          expiresAt: created.expiresAt,
        }
        if (!patchScanWorkbenchSessionWithDurableLive({ stage: 'settings', scanType, live })) {
          /* 没记住 = 没有人看得住这一场。撤掉它（用**创建时**那个身份，服务端 cancel() 按
           * endUserId 校验），一个 ACK 都不发，屏上也不许出现「已创建 / 去面板操作」。
           * creationAbandonedRef 让 effect 到此为止：任务已 DELETE，终端恢复也接不回来。 */
          creationAbandonedRef.current = true
          discardCreatedSession(live, SCAN_LIVE_NOT_DURABLE_FAILURE)
          setLiveNotDurable(true)
          return
        }
        setInstructions(created.instructions)
        setScanTaskId(created.scanTaskId)
        setControlToken(created.controlToken)
        setExpiresAt(created.expiresAt)
        setPhase('success')
        /* 登记核对通过才**立刻**确认投递授权，顺序不能反：ACK 一旦成功，服务端那条
         * 任务就变得可投递，这时候本机必须已经把凭据落到能跨重载存活的地方。
         *
         * 认 id 而不是无条件置位：这段 `.then` 挂在一个可能被重挂多次的 promise 上，
         * 无条件置位会和确认 effect 互相喂招，把 'acked' 一次次打回 'pending'。 */
        if (ackRequestedForRef.current !== created.scanTaskId) {
          ackRequestedForRef.current = created.scanTaskId
          setAckState('pending')
        }
      })
      .catch((error: unknown) => {
        const code = errorCodeOf(error)

        /* 那枚一次性授权的裁决（为什么失败之后它多半还活着，见 scanWorkbenchSession
         * 的 takenRescanAuthority）。二选一，判据只有失败码：服务端明确不认 → 永久丢弃；
         * 其余一律原样放回。
         *
         * 必须排在 `if (cancelled) return` **之前**：cancelled 只表示本轮 effect 过时
         * （终端会话 checking/ready 切一次就置位），和授权归谁无关。排在后面的话，
         * 正好在换票窗口里失败的那一次会两头落空 —— 既没恢复也没丢弃。 */
        const serverRefusedRescan = isRescanRefusedByServer(code)
        const createGeneration = createGenerationRef.current
        const rescanCarriesOver = !serverRefusedRescan
          && createGeneration !== null
          && scanLifecycleGeneration() === createGeneration
          && !unmountedRef.current
        // 代次没变但页面已经卸载时也走丢弃：没有人会再用它，而它握着上一场的
        // controlToken 明文，留在模块内存里只是多一份可被下一位继承的残留。
        let rescanStillUsable = false
        if (rescanCarriesOver) {
          rescanStillUsable = restoreScanRescanAuthority(scanType)
        } else {
          discardTakenScanRescanAuthority()
        }
        // 只在真的恢复成功时立起这一位，**从不**在这里把它写回 false。
        // 本 promise 已经 settle，后续每一轮 effect 都会再挂一次 catch；那时寄存格已空、
        // 恢复必然返回 false，若照写就会把上一轮刚立起来的按钮当场按灭。
        if (rescanStillUsable) setRescanRetryable(true)

        if (cancelled) return
        // 结论文案按失败码翻译，纯函数、不碰状态（scanRescanRecovery）。
        // 「服务端不认」那一支的授权已在上面丢弃，这里只负责把出路切成普通新会话。
        const verdict = classifyCreateFailure(error)
        if (verdict.refusedRescan) setRescanRefusedByServer(true)
        setFailure(verdict.failure)
        setPhase('error')
      })

    return () => {
      // 只表示「本轮 effect 过时了」。它每次依赖变化都会跑（终端会话 checking / ready
      // 来回切也算），所以**不能**拿它当「用户走了」的判据 —— 真正的卸载判据是
      // unmountedRef，撤不撤由上面那道生命周期闸门统一裁决。
      cancelled = true
    }
    // StrictMode 需要在同一组 refs 上复用唯一创建 promise，不按渲染重发。
    // 依赖三个：终端会话状态（从 checking / failed 回到 ready 时要能补发这一次创建），
    // 以及两个 fail-closed 标志 —— 用户显式选了「重新开始一次扫描」之后它们变 false，
    // 这一次普通创建就该发出去了（那是他自己按的）。
    //
    // `rescanRefusedByServer` 必须在这里，而且这一条容易被判成冗余：服务端拒绝时
    // `rescanCredentialsLost` 从头到尾都是 false，复位它不构成依赖变化，effect 不会重跑，
    // 「重新开始一次扫描」按下去就毫无反应。true→false 的那一位只有它。
    //
    // `rescanRetryable` 同理，是「再试一次安全重扫」那颗按钮的复跑开关：handleRescanRetry
    // 把它由 true 打回 false，effect 因此重跑，并在 sessionPromiseRef 已被置空的前提下
    // 重新取一次授权（那正是刚被原样放回去的同一份）→ 发出去的仍然是成对的重扫请求。
    //
    // `ackRefused` 是第三个 fail-closed 开关，同理：它 true→false 的那一下是用户按
    // 「重新开始一次扫描」，这一次创建必须发得出去。
    //
    // `cleanupHolding` 是第四个，唯一一个**不由用户按钮**复位的：上一场收完尾时
    // 订阅把它打回 false，这一次创建才发得出去。不进依赖的话页面会永远停在
    // 「还在收上一场的尾」，而收尾其实早就结束了。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalSession, rescanCredentialsLost, rescanRefusedByServer, rescanRetryable, ackRefused, cleanupHolding])

  /**
   * 投递确认（ACK）：唯一一处让这一场在服务端变得可投递的地方（见 scanDeliveryAck）。
   *
   * 三条路汇到这同一段：新建成功、重放领回来的 child、以及**复水**（整页重载 / 从别处
   * 回到本阶段）。复水那一条本机并不知道当初确认过没有，而 ACK 幂等，所以再问一次
   * 永远是对的，猜「应该确认过了」才是错的。
   *
   * 生命周期闸门与创建那一段同一副判据（代次 / 卸载），但后果更重：ACK 成功那一刻
   * 任务**已经可投递**，用户若已经走了或清过场，它就是一个没人看着的收件箱 ——
   * 所以那一支必须撤，且绝不许写回状态。
   */
  useEffect(() => {
    if (ackState !== 'pending') return undefined
    const pendingScanTaskId = createdIdRef.current
    const pendingControlToken = controlTokenRef.current
    // 没有完整凭据就一个请求都不发：半对凭据发出去只会拿回 403，
    // 而那条 403 在屏幕上会被读成「服务端不认这一场」—— 把本机的缺失说成服务端的结论。
    if (!pendingScanTaskId || !pendingControlToken) return undefined
    const credentials: ScanAckCredentials = {
      scanTaskId: pendingScanTaskId,
      controlToken: pendingControlToken,
    }
    const ackGeneration = scanLifecycleGeneration()
    /* 身份用**这一场建成时**那份快照，不是现取。创建 effect 在发请求之前写下它，
     * 复水那一条由挂载 effect 补上，所以这里读到的永远是「建这一场的那个人」。
     * 现取的坏处不是理论上的：ACK 与撤销在服务端都按 endUserId 校验，用户中途退出
     * 或换人之后现取只会拿回 403，而页面会把那条 403 读成「服务端不认这一场」——
     * 把本机的身份漂移说成服务端的结论。 */
    const memberToken = createTokenRef.current
    let stale = false

    void acknowledgeScanDelivery(credentials, memberToken).then((outcome) => {
      if (scanLifecycleGeneration() !== ackGeneration || unmountedRef.current) {
        /* 用户走了 / 清场了 / 换人了。确认可能刚刚成功，也就是说服务端那条任务此刻
         * 可能已经可投递 —— 必须撤掉，并且一个字节都不许写回本机。
         *
         * 这一次是**补偿**，不是又一次尽力而为：离开那条路径（leaveScanFlow /
         * 清场）已经按本机登记发过一次 DELETE 了，按普通去重这里会被直接挡掉。
         * 而「ACK 成功」正是那一次 DELETE 没生效的证据（生效了服务端只会回 409），
         * 同时 deliveryAckedAt 已经非空 —— 60 秒未确认回收器再也收不到它，
         * 它会一直可投递到自然过期。所以这一次必须越过去重发出去。 */
        abandonCreatedSession(credentials, 'ack-compensation')
        return
      }
      if (stale) return
      if (outcome.ok) {
        setFailure(null)
        setAckState('acked')
        return
      }
      if (outcome.definitive) {
        failClosedOnAckRefusal(credentials, outcome.failure)
        return
      }
      // 断网 / 5xx / 429 / 终端票失效：任务仍然停在不可投递，没有人会收到那张纸。
      // 如实说还没确认，并保留重试；这一屏不许出现任何让用户去面板操作的话。
      setFailure(outcome.failure)
      setAckState('retryable')
    })

    return () => {
      stale = true
    }
    // 只由 ackState 驱动：'pending' 进来、拿到结论出去。用户按「再确认一次」时
    // handleAckRetry 把它打回 'pending'，这一段就再跑一次（服务端幂等）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ackState])

  useEffect(() => {
    if (!expiresAt) return

    const tick = () => {
      setCountdown(formatCountdown(expiresAt))
      if (Date.parse(expiresAt) > Date.now() || expiryHandledRef.current) return
      expiryHandledRef.current = true
      if (createdIdRef.current && controlTokenRef.current && !confirmedRef.current) {
        cancelSessionOnce(createdIdRef.current, controlTokenRef.current)
      }
      setFailure({
        title: '扫描会话已过期',
        description: '当前会话已超过服务端返回的有效期，本页已停止继续操作。请返回扫描首页重新创建。',
      })
      setPhase('expired')
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
    // 取消函数依赖可变 token/ref，当前 effect 只应由服务端过期时间重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt])

  const handleSafeReturn = () => {
    if (createdIdRef.current && controlTokenRef.current && !confirmedRef.current) {
      cancelSessionOnce(createdIdRef.current, controlTokenRef.current)
    }
    // live: undefined 同时是「这一场到此为止」的宣告（代次 +1）：
    // 创建请求还在飞的时候点返回，响应回来会因为代次对不上而自己把任务撤掉。
    patchScanWorkbenchSession({ stage: 'start', live: undefined, result: undefined })
    if (onGoStage) {
      onGoStage('start')
      return
    }
    navigate('/scan?stage=start')
  }

  /**
   * fail-closed 两屏共用的出路：用户显式选择「重新开始一次扫描」。
   *
   * 覆盖两种成因 —— 本机取不到凭据（`rescanCredentialsLost`，含整页重载与延迟取用）
   * 和服务端不认（`rescanRefusedByServer`）。两屏的正文各说各的成因，出路只有这一个。
   * 这一条不是降级的捷径：文案已经说清它不是安全同字节重扫，按下它是用户的选择。
   *
   * 四件事缺一不可：
   *   1. `beginPlainScanRestart` 抹掉登记里那笔安全重扫意图（也顺手清空授权槽位）；
   *   2. `rescanIntentRef` 跟着变 false —— 否则上面那道延迟取用闸门会把这一次
   *      **用户亲手选的**普通创建当成「意图还在却没凭据」再判一次 fail-closed，
   *      按钮按下去什么都不会发生；
   *   3. `sessionPromiseRef.current = null` —— 服务端拒绝那条路径上它握着一个**已经
   *      reject 的 promise**。不置空的话 effect 重跑只会给那个 rejection 再挂一遍
   *      then/catch，新的 POST 永远发不出去，页面停在 loading。
   *      （凭据丢失那条路径上它本来就是 null，正是这个差别让人容易漏掉这一行。）
   *   4. 两个 fail-closed 标志都复位，effect 依赖随之变化并重跑。
   */
  const handlePlainRestart = () => {
    if (!scanType) return
    beginPlainScanRestart({ scanType, extras: stored?.extras })
    rescanIntentRef.current = false
    sessionPromiseRef.current = null
    setRescanCredentialsLost(false)
    setRescanRefusedByServer(false)
    // 用户选的是普通会话：那颗「再试一次安全重扫」必须一起下台，
    // 否则这一屏会同时挂着两个互相矛盾的主行动。
    setRescanRetryable(false)
    setPlainRestartChosen(true)
    // 这一次是用户新选的普通会话：上一次那场重放的进度不许留在等待屏上。
    setReplayingLostCreate(false)
    // 投递授权那条 fail-closed 也要一起复位（它是这一屏的第三种成因）：
    // 不复位的话，创建 effect 会在 `if (ackRefused) return` 处早退，按钮按下去毫无反应。
    setAckRefused(false)
    setAckState('idle')
    setFailure(null)
    setPhase('loading')
  }

  /**
   * 「再确认一次」——把那一次投递确认原样重发。
   *
   * 只对**不确定**的失败出现（断网 / 5xx / 429 / 终端票失效）：那时任务仍停在
   * 不可投递，谁都收不到那张纸，重发一次是安全的，而且服务端对已确认的会话幂等。
   * 服务端明确拒绝的那一支走 failClosedOnAckRefusal，不会走到这里。
   */
  const handleAckRetry = () => {
    if (ackState !== 'retryable') return
    setFailure(null)
    setAckState('pending')
  }

  /**
   * 「再试一次安全重扫」——把刚被原样放回的那枚授权再发一次，**仍然成对**，不降级。
   *
   * 置空 sessionPromiseRef 与「复位标志让 effect 重跑」两件事的理由同 handlePlainRestart。
   * 差别只在两处，而它们正是这条存在的全部意义：
   *   · `rescanIntentRef` 保持 true —— 这仍然是一次「同一份材料」，万一取用时授权已经
   *     过期，延迟取用闸门必须照旧 fail-closed，而不是放一个无签名的普通创建出去；
   *   · 不碰 armedAtMs —— 有效期始终从上一场铸出来那一刻算起，点几次都不会延长。
   */
  const handleRescanRetry = () => {
    if (!scanType) return
    sessionPromiseRef.current = null
    setRescanRetryable(false)
    // 新一轮请求从「还没开始重放」起算；上一轮的进度不许挂在这一轮的等待屏上。
    setReplayingLostCreate(false)
    setFailure(null)
    setPhase('loading')
  }

  const handleConfirm = () => {
    if (!scanType || !scanTaskId || !controlToken || starting) return
    confirmedRef.current = true
    setStarting(true)
    patchScanWorkbenchSession({
      stage: 'progress',
      scanType,
      live: {
        scanTaskId,
        controlToken,
        instructions: instructions ?? [],
        expiresAt: expiresAt ?? new Date().toISOString(),
      },
    })
    if (onGoStage) {
      onGoStage('progress')
      return
    }
    navigate('/scan?stage=progress', { state: { scanTaskId, scanType, controlToken } })
  }

  /* 「可以去面板操作了」的判据是两件事同时成立，不是一件：服务端回了一个可用的
   * 会话（phase success + 四样字段齐全），**并且**它已经拿到投递授权（ackState acked）。
   * 少了后半句，用户会照着指引去按开始，而那一刻服务端还不肯把文件投给这一场。 */
  if (ackState !== 'acked' || phase !== 'success' || !scanType || !scanTaskId || !controlToken || !instructions || !expiresAt) {
    // 这一整块只读值、不碰 ref/effect/请求，所以整份交出去（ScanSettingsStatusView）。
    return <ScanSettingsStatusView {...{
      phase, ackState, scanType, terminalSession, failure, replayingLostCreate,
      rescanRetryable, rescanCredentialsLost, rescanRefusedByServer, ackRefused, liveNotDurable,
      cleanupHolding,
      handleSafeReturn, handlePlainRestart, handleRescanRetry, handleAckRetry,
    }} />
  }

  return (
    <ScanWorkbenchShell
      page="scan-settings"
      state="panel-instruction"
      title="扫描指引"
      subtitle={<><b>扫描任务已创建</b>，请仅按服务端返回的当前会话指引操作。</>}
      status={{ tone: 'ok', label: '第 2 步 · 去面板操作' }}
      ctabar={
        <ScanCta>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={handleSafeReturn}>
            返回（取消任务）
          </button>
          <button type="button" className="qx-btn" data-variant="primary" disabled={starting} onClick={handleConfirm}>
            {starting ? '正在进入等待…' : '我已操作，开始等待'}
          </button>
        </ScanCta>
      }
    >
      <ScanSec no="01" title="照着做：全在机器面板上" hint="服务端下发原文，本机不改写" grow>
        <ScanPanelMock
          instructions={instructions.map((instruction) => instruction)}
          scanLabel={SCAN_TYPE_LABELS[scanType]}
        />
      </ScanSec>
      <ScanSec no="02" title="现在在第一段" hint="链路位置，不是百分比">
        <ScanChain active={0} />
      </ScanSec>
      {/* 「这次会话」整张卡是纯展示，已搬去 ScanSettingsStatusView。restoredFromStorage 必须喂
          **挂载那一刻**那个 ref：每帧重算会把一个刚在本页建成的会话说成「本页重载过」。 */}
      <ScanSettingsSessionFacts
        scanType={scanType} scanTaskId={scanTaskId} countdown={countdown}
        rescanRequested={rescanRequested} plainRestartChosen={plainRestartChosen}
        restoredFromStorage={restoredFromStorageRef.current}
      />
    </ScanWorkbenchShell>
  )
}
