import type { NavigateOptions } from 'react-router-dom'
import { PhoneHelpLine } from '../print-scan/phoneHelp'
import { FsRow } from '../print-scan/FsRow'
import { ScanSample, ScanWorkbenchShell } from './ScanWorkbenchChrome'
import type { ScanOutcome } from './scanWorkbenchSession'

/**
 * 结果页的「没拿到可用文件」视图：扫描未完成、等待超时、已完成但结果里没有文件，三种共用一个版式。
 *
 * 2026-11-02 K1a 从 `ScanResultPage.tsx` 整段搬来（理由：页面 512 行，往里再加屏上扫描的结果之前先按职责拆开）。
 * **只搬不改**：标题、状态条、三种原因的措辞、两个按钮的分工、「刚才那份凭据已经用不了了」那段话，
 * 都是拆分前的原文；判定（走哪个视图）和所有处理函数仍由页面与两个 hook 提供。
 */
export function ScanResultFailedView({
  outcome,
  formatFailure,
  shownReason,
  rescanAuthorized,
  safeRescanLost,
  handleRetry,
  handlePlainRestart,
  leaveScanFlow,
}: {
  outcome: ScanOutcome
  formatFailure: boolean
  shownReason: string | null
  rescanAuthorized: boolean
  safeRescanLost: boolean
  handleRetry: () => void
  handlePlainRestart: () => void
  leaveScanFlow: (destination: string, options?: NavigateOptions) => void
}) {
  const isNoFile = outcome === 'completed-no-file'
  const isExpired = outcome === 'expired'
  return (
    <ScanWorkbenchShell
      page="scan-result"
      /* outcome 'expired' 有两个来源、同一份快照：服务端回执 expired，和本机轮询到 10 分钟
       * 自己放弃（ScanProgressPage 的 localGiveUp，撤销是尽力而为、没有回执）。这里分不出
       * 是哪一个，所以标题 / 状态条 / 横幅一律只说「等待超时」，不说「会话已过期」或「服务端确认」。 */
      state={isNoFile ? 'completed-no-file' : isExpired ? 'wait-timeout' : 'failed'}
      layout="spread"
      title={isNoFile ? '已完成 · 结果里没有文件' : isExpired ? '等待超时' : '扫描未完成'}
      subtitle="本次没有生成可用的扫描文件"
      status={{ tone: isNoFile || isExpired ? 'warn' : 'bad', label: isNoFile ? '已完成 · 结果里没有文件' : isExpired ? '等待超时 · 没有文件' : '扫描未完成' }}
      /* 两个按钮，不是一个按钮两种文案：拿到凭据时它是「同一份材料」的安全重扫，
         拿不到时它是一次普通新会话 —— 后者会让同一张纸撞上服务端两小时的重复件
         拒收，代价完全不同，所以文案必须分开，并且由用户自己按下那一个。 */
      dock={{
        left: { label: '返回打印扫描', leaveTo: '/print-scan' },
        primary: formatFailure
          ? (rescanAuthorized
            ? { label: '选 JPG 格式重扫（同一份材料）', onClick: handleRetry }
            : { label: '选 JPG 格式重新扫描', onClick: handlePlainRestart })
          : rescanAuthorized
          ? { label: '重试扫描（同一份材料）', onClick: handleRetry }
          : { label: '重新开始一次扫描', onClick: handlePlainRestart },
      }}
    >
      {/* 失败态：原因只写一处。此前意图带标题、状态条、面板标题三处都是「扫描未完成」，面板里的原因
          和下面「失败原因原文」说明格又是同一句。现在第一格就是原因（标题 + 原因本身）。
          这一屏也接本机自己放弃的两条路（轮询到点、连续查不动），那两条服务端并没有说过「失败」或「过期」，
          所以第一格的标题只说所有成因都成立的那句话，真实成因由 reason 原样转达。 */}
      <div className="fs-grow is-status">
        <div className="fs-facts">
          <div className="fs-fact wide">
            <b>{isNoFile ? '系统说已完成，但这次结果里没有可用文件' : isExpired ? '等待超时，这次没有拿到文件' : '这次没扫成的原因'}</b>
            {isNoFile ? (
              <>
                <span>系统确认<b>这次扫描已经完成</b>，可是同一份结果里<b>没有带可用的文件信息</b>（结果里允许不带文件，这不是出错）。</span>
                <span>这份文件此刻还在不在系统里，<b>本机没有依据判断</b>。页面不替系统说它还在，不说它已被删掉，也不承诺能找回来。这次扫描到此结束。</span>
              </>
            ) : (
              <span>{shownReason ?? '扫描任务未能完成，请重试。'}</span>
            )}
          </div>
          <div className="fs-fact wide">
            <b>同一张纸</b>
            <span>同一张纸原样再扫，系统可能按重复件拒收（两小时内）。</span>
          </div>
          <div className="fs-pairgrid">
            <div className="fs-fact">
              <b>重试扫描（同一份材料）</b>
              <span>{rescanAuthorized ? '这一次会带上上一场的凭据去申请安全重扫放行：系统认了，同一份材料照原样再扫一遍就行；不认会在下一页当场说明，不会悄悄按普通重扫处理。' : '本机没有可用的安全重扫凭据。这里不写成已经放行。'}</span>
            </div>
            <div className="fs-fact">
              <b>重新开始一次扫描</b>
              <span>这是一次普通新会话，不是免查重的重扫。不自动重扫。</span>
            </div>
          </div>
        </div>
        {safeRescanLost ? (
          <p className="fs-warn" data-testid="scan-safe-rescan-lost">
            <b>刚才那份安全重扫凭据已经用不了了</b>（超过 15 分钟，或者中间清过场 / 换过人）。
            本页<b>没有</b>替你改成普通重扫 —— 同一张纸如果走普通扫描，系统会按重复件拒收，
            你会在机器前白等到这次扫描过期。要继续，请自己按右下角<b>「重新开始一次扫描」</b>，
            并且换一份材料。
          </p>
        ) : null}
        <PhoneHelpLine />
        <ScanSample />
      </div>
      {isNoFile ? null : (
        <FsRow title="返回首页" desc="结束这次等待" onClick={() => leaveScanFlow('/')} />
      )}
      {rescanAuthorized ? (
        <FsRow title="重新开始一次扫描" desc="回选类型，不带安全重扫凭据" onClick={handlePlainRestart} />
      ) : null}
    </ScanWorkbenchShell>
  )
}
