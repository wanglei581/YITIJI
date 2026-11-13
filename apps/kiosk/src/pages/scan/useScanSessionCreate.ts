import { useEffect } from 'react'
import { useAuth } from '../../auth/useAuth'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { getTerminalId } from '../../services/api/screensaver'
import { createScanSession } from '../../services/api/scanTasks'
import { errorCodeOf, userMessageOf } from '../../services/api/userErrorMessage'
import { scanCleanupInProgress, trackScanSessionCreation } from './scanCleanupGate'
import { replayCreateUntilOutcomeKnown } from './scanCreateReplay'
import {
  classifyCreateFailure,
  isRescanRefusedByServer,
  RESCAN_CREDENTIALS_LOST_FAILURE,
} from './scanRescanRecovery'
import {
  getCancellationCredentials,
  isValidCreatedSession,
  SCAN_CLEANUP_HOLD_FAILURE,
  SCAN_LIVE_NOT_DURABLE_FAILURE,
} from './scanSettingsModel'
import { SCAN_TERMINAL_FAIL_COPY, scanShownText } from './scanShownText'
import type { ScanType } from './scanWorkbench'
import {
  discardTakenScanRescanAuthority,
  patchScanWorkbenchSessionWithDurableLive,
  restoreScanRescanAuthority,
  scanLifecycleGeneration,
  takeScanRescanAuthority,
} from './scanWorkbenchSession'
import type { ScanSettingsSession } from './useScanSettingsState'

/**
 * 设置页「把这一场建出来」：复水补身份、创建会话那一大段 effect、创建失败后的静默期倒计时。
 *
 * 2026-11-02 K1a 从 `ScanSettingsPage.tsx` 整段搬来（理由与分工见 `useScanSettingsState`）。
 * **只搬不改**：前置闸门、发起与重放、生命周期闸门、失败处置的顺序、判据、注释都是拆分前的原文；
 * 开头把用到的名字从那一份交接值里解构出来，所以下面每一段代码和它在页面里时逐字一致。
 *
 * 三段 effect 的注册顺序也没变（复水补身份 → 创建 → 静默期倒计时），
 * 紧跟在 `useScanSettingsState` 里的忙碌锁和卸载标记之后、投递确认之前。
 * 屏上扫描要往这里加的创建参数（startMode / source / colorMode）只能加在 `sendCreate` 这一个出口上。
 *
 * 与拆分前唯一逐字不同的一行：静默期倒计时那条 effect 的依赖数组补上了 `setQuietPeriodRemaining`。
 * 它是 `useState` 的 setter，引用永远稳定，所以不改变这条 effect 何时重跑；补它只是因为
 * setter 现在经由交接值传进来，lint 认不出它是稳定的。
 */
export function useScanSessionCreate(input: ScanSettingsSession & { scanType: ScanType | null }): void {
  const { getToken } = useAuth()
  const {
    scanType,
    terminalSession,
    rescanCredentialsLost, setRescanCredentialsLost,
    rescanRefusedByServer, setRescanRefusedByServer,
    rescanRetryable, setRescanRetryable,
    ackRefused,
    cleanupHolding,
    quietPeriodRemaining, setQuietPeriodRemaining,
    quietPeriodBlocked, setQuietPeriodBlocked,
    setRescanRequested,
    setReplayingLostCreate,
    setLiveNotDurable,
    setFailure,
    setPhase,
    setInstructions,
    setScanTaskId,
    setControlToken,
    setExpiresAt,
    setAckState,
    confirmedRef,
    createdIdRef,
    controlTokenRef,
    restoredFromStorageRef,
    rescanIntentRef,
    skipCreateRef,
    sessionPromiseRef,
    createGenerationRef,
    createTokenRef,
    ackRequestedForRef,
    unmountedRef,
    terminalFailClosedRef,
    creationAbandonedRef,
    cancelSessionOnce,
    abandonCreatedSession,
    discardCreatedSession,
  } = input

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
    // 服务端静默期是隐私闸门：倒计时未结束前不重发创建请求。
    if (quietPeriodBlocked) return
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
          title: '这台机器的安全校验没通过',
          description: scanShownText(
            userMessageOf({ code: 'TERMINAL_SESSION_INVALID' }, SCAN_TERMINAL_FAIL_COPY),
            SCAN_TERMINAL_FAIL_COPY,
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
        if (verdict.quietPeriodSeconds !== undefined) {
          setQuietPeriodRemaining(verdict.quietPeriodSeconds)
          setQuietPeriodBlocked(true)
        }
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
  }, [terminalSession, rescanCredentialsLost, rescanRefusedByServer, rescanRetryable, ackRefused, cleanupHolding, quietPeriodBlocked])

  useEffect(() => {
    if (!quietPeriodBlocked || quietPeriodRemaining <= 0) return undefined
    const timer = window.setInterval(() => {
      setQuietPeriodRemaining((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [quietPeriodBlocked, quietPeriodRemaining, setQuietPeriodRemaining])
}
