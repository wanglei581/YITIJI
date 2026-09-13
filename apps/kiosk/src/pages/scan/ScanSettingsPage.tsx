import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ClockIcon } from 'lucide-react'
import type { ScanSessionCreateResponse } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { getTerminalId } from '../../services/api/screensaver'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { cancelScanSession, createScanSession } from '../../services/api/scanTasks'
import { revokeCreatedScanSession } from './scanSessionRevoke'
import {
  subscribeTerminalSession,
  terminalSessionState,
  type TerminalSessionState,
} from '../../services/terminalAuth'
import { errorCodeOf, userMessageOf } from '../../services/api/userErrorMessage'
import { SCAN_OUTPUT_FORMAT_PENDING } from './scanOutputFormat'
import {
  ScanChain,
  ScanCta,
  ScanKvCard,
  ScanNoteCard,
  ScanPanelMock,
  ScanPlan,
  ScanSec,
  ScanStatusPanel,
  ScanWorkbenchShell,
} from './ScanWorkbenchChrome'
import { SCAN_TYPE_LABELS, type ScanType } from './scanWorkbench'
import { type ScanStage } from './scanWorkbenchModel'
import {
  beginPlainScanRestart,
  patchScanWorkbenchSession,
  readScanWorkbenchSession,
  scanLifecycleGeneration,
  scanRescanCredentialsLost,
  takeScanRescanAuthority,
  type ScanLiveState,
} from './scanWorkbenchSession'

function isScanType(value: unknown): value is ScanType {
  return value === 'resume' || value === 'id' || value === 'document'
}

type SessionPhase = 'invalid' | 'loading' | 'success' | 'expired' | 'error'

/**
 * 服务端（或本机成对校验）判「这次安全重扫不作数」的四个码。
 *
 * 前三个来自 scan-tasks.service.ts：授权无效 / 已过期 / 已被消费（403）、
 * 授权正被并发处理或血缘已被占用（409）、只给了凭证没给原任务 id（400）。
 * 第四个来自本机 scanTasks.ts：拿到的是半对凭据，请求根本没发出去。
 * 四个的用户处置完全一样，所以合成一张表，页面不按码分叉。
 */
const SCAN_RESCAN_REJECTION_CODES = new Set([
  'SCAN_RETRY_NOT_AUTHORIZED',
  'SCAN_RETRY_CONFLICT',
  'SCAN_RETRY_TASK_ID_MISSING',
  'SCAN_RESCAN_AUTHORITY_INCOMPLETE',
])

/**
 * 带着「同一份材料」的意图进来，凭据却已经不在内存里 —— 这一屏说的话。
 *
 * **成因不止一个，所以措辞不能只说其中一个。** 已知两条，用户处置完全一样：
 *   · 整页重载（看门狗）：授权刻意只活在内存里，重载就没了，而登记里那笔意图还在；
 *   · 延迟取用：本页在等终端换票（`terminalSession === 'checking'`）的那一会儿，
 *     本地 15 分钟窗口走完，或者别处发生过一次清场，于是真正取用那一刻槽位已空。
 * 早先这里写死「已随本页重载消失」，第二条成因发生时就是一句假的诊断。
 *
 * 三件事必须都说到：为什么不能继续、本页**没有**替他改发普通重扫（否则同一张纸会
 * 撞上两小时的重复件拒收）、以及他现在能按哪一个。
 */
const RESCAN_CREDENTIALS_LOST_FAILURE = {
  title: '安全重扫凭据已经不在本机',
  description: '你刚才选的是「同一份材料」重扫。那份凭据只存在页面内存里（不落存储，'
    + '换人清场也带不走）：本页重载过、或者它已经超过 15 分钟、或者中间清过场，'
    + '现在都取不到了，本机无法再向服务端申请放行。'
    + '本页不会替你改发一次普通重扫 —— 同一张纸走普通会话会被服务端按重复件拒收，'
    + '你会在机器前白等到会话过期。可以安全返回扫描首页，'
    + '或者按「重新开始一次扫描」建一个普通会话（那不是安全重扫，建议换一份材料）。',
} as const

/**
 * 服务端把这次安全重扫判为不作数（403 / 409 / 400）之后，这一屏说的话。
 *
 * 和上面那条的区别只在**是谁判的**：上面是本机取不到凭据，这条是凭据发出去了、
 * 服务端不认。用户处置一样，所以两条都必须给出同一个显式出路
 * （「重新开始一次扫描」），并且都必须把代价说清楚。
 *
 * 早先这条只说「请返回扫描首页重新开始一次扫描」，屏幕上却没有任何叫这个名字的按钮 ——
 * 唯一能按的是「安全返回扫描首页」，用户得自己走回选类型那一屏再来一遍。而这一屏
 * 最常见的来源恰恰是「上一场根本没走到取件」（服务端那种情况从不铸授权，必然 403），
 * 于是最常见的失败路径上，主行动是一个注定失败的按钮。
 */
const RESCAN_REFUSED_FAILURE = {
  title: '安全重扫授权已失效',
  description: '服务端不认这次的安全重扫凭据（过期、已被用掉，或者上一场根本没走到取件'
    + '——那种情况服务端不会铸授权）。本页不会自动改用普通重扫。'
    + '你可以按「重新开始一次扫描」建一个普通会话：那不是同字节重扫，'
    + '如果放回去的还是同一张纸，服务端可能按重复件拒收（两小时内），'
    + '建议换一份材料或找工作人员；也可以安全返回扫描首页。',
} as const

interface LocationState {
  scanType?: unknown
}

interface SessionFailure {
  title: string
  description: string
}

function getCancellationCredentials(created: unknown): { scanTaskId: string; controlToken: string } | null {
  if (!created || typeof created !== 'object') return null
  const candidate = created as Partial<ScanSessionCreateResponse>
  if (typeof candidate.scanTaskId !== 'string' || candidate.scanTaskId.trim().length === 0) return null
  if (typeof candidate.controlToken !== 'string' || candidate.controlToken.trim().length === 0) return null
  return { scanTaskId: candidate.scanTaskId, controlToken: candidate.controlToken }
}

function isValidCreatedSession(created: unknown): created is ScanSessionCreateResponse {
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

function formatCountdown(expiresAt: string): string {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  return `${minutes}:${String(remain).padStart(2, '0')}`
}

function liveSessionStillValid(live: ScanLiveState | undefined): live is ScanLiveState {
  if (!live) return false
  return Date.parse(live.expiresAt) > Date.now() && live.instructions.length > 0
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
  // POST /scan/sessions 挂着 TerminalIdentityGuard（scan-tasks.controller.ts）：
  // 没有终端会话令牌就是 401。和打印确认页同一口径 —— 订阅状态，不猜、不抢跑。
  const [terminalSession, setTerminalSession] = useState<TerminalSessionState>(() => terminalSessionState())

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

  const cancelSessionOnce = (id: string, token: string) => {
    if (cancelRequestedRef.current) return
    cancelRequestedRef.current = true
    void cancelScanSession(id, token, getToken()).catch(() => undefined)
  }

  /**
   * 丢弃一个刚建成、却已经没有人会使用的任务。
   *
   * 和 cancelSessionOnce 的分工：那条是**页面还在**时的正常取消（等得起一次 await、
   * 用当前身份发）；这条发生在清场 / 卸载之后，页面随时可能被拆掉或整页重载，
   * 所以走 keepalive 的撤销通道，并且用**创建时**那个身份。
   * 共用 cancelRequestedRef：两条合起来对同一个任务只发一次 DELETE。
   */
  const abandonCreatedSession = (credentials: { scanTaskId: string; controlToken: string }) => {
    if (cancelRequestedRef.current) return
    cancelRequestedRef.current = true
    revokeCreatedScanSession(credentials, createTokenRef.current)
  }

  useEffect(() => subscribeTerminalSession(setTerminalSession), [])

  // 只认卸载：空依赖，终端会话状态怎么变都不会重跑。
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

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
    /* fail-closed：带着安全重扫意图进来，凭据却已经不在内存里（整页重载抹掉的）。
     * 这一条必须排在终端会话那两个分支**之前** —— 页面此刻要说的是「凭据没了」，
     * 不是「正在做终端安全校验」。它是这次修复的核心：这里 return 掉的正是那一个
     * 会悄悄发出去的普通创建。用户按下「重新开始一次扫描」之后，
     * rescanCredentialsLost 当帧变 false，本 effect 再跑一次，那时才创建。 */
    if (rescanCredentialsLost) return
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
      createGenerationRef.current = scanLifecycleGeneration()
      createTokenRef.current = getToken()
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
      sessionPromiseRef.current = createScanSession(
        { scanType, terminalId: getTerminalId() },
        getToken(),
        rescan,
      )
    }

    sessionPromiseRef.current
      .then((created) => {
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

        setInstructions(created.instructions)
        setScanTaskId(created.scanTaskId)
        setControlToken(created.controlToken)
        setExpiresAt(created.expiresAt)
        setPhase('success')
        patchScanWorkbenchSession({
          stage: 'settings',
          scanType,
          live: {
            scanTaskId: created.scanTaskId,
            controlToken: created.controlToken,
            instructions: created.instructions,
            expiresAt: created.expiresAt,
          },
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const code = errorCodeOf(error)
        const outcomeUnknown = error instanceof ApiHttpError && (error.code === 'NETWORK_ERROR' || error.status === 0)
        if (outcomeUnknown) {
          setFailure({
            title: '无法确认扫描任务状态',
            description: '网络连接中断，无法确认服务端是否收到请求。为避免重复创建，本页不会自动重发。请检查网络后返回重试。',
          })
        } else if (SCAN_RESCAN_REJECTION_CODES.has(code ?? '')) {
          /* 安全重扫被服务端拒了（过期 / 已被用掉 / 血缘被占 / 上一场根本没走到取件）。
           *
           * 这里**不自动改发一次普通创建**。普通创建本身不危险，但它会把用户支到面板前
           * 去扫同一张纸，而那份字节可能落在服务端的 2 小时去重窗口里 —— 文件投回来会被拒，
           * 任务停在 waiting 直到过期，用户在这台机器前白等十分钟，且全程没有任何提示。
           * 静默降级正是这条防线要挡的东西。
           *
           * 但「不自动降级」不等于「不给出路」。这一屏最常见的来源是**上一场根本没走到
           * 取件**（服务端那种情况从不铸授权，必然 403），把它做成一个只能原路退回的
           * 死胡同，等于让最常见的失败路径上主行动注定失败。所以：出路给出来，
           * 代价写清楚，按不按由用户决定 —— 这和「本页替他按」是两件事。 */
          setRescanRefusedByServer(true)
          setFailure({
            title: RESCAN_REFUSED_FAILURE.title,
            description: userMessageOf(error, RESCAN_REFUSED_FAILURE.description),
          })
        } else if (code === 'SCAN_TERMINAL_BUSY') {
          setFailure({
            title: '本机正在扫描中',
            description: userMessageOf(error, '请等待当前扫描任务完成后再试。'),
          })
        } else if (code === 'SCAN_TERMINAL_DISABLED') {
          setFailure({
            title: '扫描功能已停用',
            description: userMessageOf(error, '请联系现场工作人员。'),
          })
        } else if (code === 'TERMINAL_SESSION_INVALID') {
          setFailure({
            title: '终端安全校验失败',
            description: userMessageOf(error, '终端安全校验失败，请联系现场工作人员'),
          })
        } else if (code === 'RATE_LIMITED' || (error instanceof ApiHttpError && error.status === 429)) {
          setFailure({
            title: '请求过于频繁',
            description: userMessageOf(error, '请稍后再试。'),
          })
        } else {
          setFailure({
            title: '扫描任务未创建',
            description: userMessageOf(error, '服务端未能创建扫描会话。请返回重试，或联系现场工作人员。'),
          })
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalSession, rescanCredentialsLost, rescanRefusedByServer])

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
    setPlainRestartChosen(true)
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

  if (phase !== 'success' || !scanType || !scanTaskId || !controlToken || !instructions || !expiresAt) {
    const workbenchState = phase === 'invalid'
      ? 'invalid'
      : phase === 'loading'
        ? 'create-loading'
        : phase === 'expired'
          ? 'expired'
          : 'create-failed'
    const title = phase === 'invalid'
      ? '未创建扫描任务'
      : phase === 'loading'
        ? '正在创建扫描任务'
        : failure?.title ?? '扫描任务未创建'
    const description = phase === 'invalid'
      ? '当前页面没有来自扫描首页的合法类型信息，本次不会发起创建请求。'
      : phase === 'loading'
        ? '正在等待服务端返回真实会话，成功前不会显示任务信息或操作指引。'
        : failure?.description ?? '本次没有可用的扫描会话。'
    const status = phase === 'loading'
      ? {
          tone: 'unknown' as const,
          // 还在换终端票据时不能说「正在建扫描会话」—— 那一刻请求还没发出去。
          label: terminalSession === 'checking' ? '正在做终端安全校验' : '正在建扫描会话',
        }
      : phase === 'expired'
        ? { tone: 'warn' as const, label: '会话已过期' }
        : { tone: 'bad' as const, label: '会话创建失败' }

    return (
      <ScanWorkbenchShell
        page="scan-settings"
        state={workbenchState}
        title={title}
        subtitle={description}
        status={status}
        ctabar={
          <ScanCta reason={phase === 'loading' ? '请求还在路上 —— 这一刻页面不做任何判断，也不给你一个假的编号' : '未确认成功前不显示扫描操作步骤'}>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={handleSafeReturn}>
              安全返回扫描首页
            </button>
            {/* 两种「安全重扫走不下去」的屏各有一个能按的主行动：本机取不到凭据
                （重载 / 过期 / 清过场），以及服务端不认。它们是普通新会话，代价已经在
                正文里说清，按不按由用户决定 —— 这和「本页替他按」是两件事。
                其余失败态仍然什么都不许按：本页不会自动重发，也不会自己变成成功。 */}
            {rescanCredentialsLost || rescanRefusedByServer ? (
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
                {phase === 'loading' ? '等服务端返回会话' : '未创建扫描任务'}
              </button>
            )}
          </ScanCta>
        }
      >
        <ScanStatusPanel
          tone={phase === 'loading' ? 'info' : phase === 'invalid' ? 'lock' : 'error'}
          title={title}
          breathe={phase === 'loading'}
          chips={
            phase === 'loading'
              ? [
                  { label: terminalSession === 'checking' ? '正在做终端安全校验' : '正在等服务端回话' },
                  { label: scanType ? `选中类型：${SCAN_TYPE_LABELS[scanType]}` : '未选择类型' },
                ]
              : [
                  { label: '没有任务编号', tone: 'warn' },
                  { label: '本机没有文件' },
                ]
          }
        >
          <p>{description}</p>
          {phase === 'loading' ? <p>这一步不碰扫描仪，也不会替你启动任何硬件。</p> : null}
        </ScanStatusPanel>
        {phase === 'loading' ? (
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
            <ScanNoteCard title="接下来怎么办" foot="本页不会自动重发，也不会自己变成成功。">
              <ScanPlan items={[
                '返回扫描首页，从选择类型重新走一遍。',
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
  const natureRow: [string, string] | null = rescanRequested
    ? ['本次性质', '安全重扫：服务端已放行同一份材料再扫一次']
    : plainRestartChosen
      ? ['本次性质', '普通会话：你已确认这一次不是安全同字节重扫']
      : restoredFromStorageRef.current
        ? ['本次性质', '本页重载过；这一场当初是不是安全重扫，本机无从判断']
        : null

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
    </ScanWorkbenchShell>
  )
}
