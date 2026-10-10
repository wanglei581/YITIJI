import { HeadphonesIcon } from 'lucide-react'
import { helpNeededLine, preferUnattended } from '../../copy/unattendedCopy'
import {
  ScanChain,
  ScanCta,
  ScanNoteCard,
  ScanPlan,
  ScanSec,
  ScanStatusPanel,
  ScanWorkbenchShell,
} from './ScanWorkbenchChrome'

/**
 * 结果页没拿到可用文件的那一屏。从 ScanResultPage 拆出来，好让成功页的门禁字符串留在原文件。
 * 只有「等待超时」把状态卡放进 02：失败和「完成了但没有文件」仍按稿的状态屏骨架排。
 */
export function ScanResultOutcomeView({
  isNoFile,
  isExpired,
  reason,
  safeRescanLost,
  rescanAuthorized,
  leaveScanFlow,
  handleRetry,
  handlePlainRestart,
}: {
  isNoFile: boolean
  isExpired: boolean
  reason: string | null
  safeRescanLost: boolean
  rescanAuthorized: boolean
  leaveScanFlow: (destination: string) => void
  handleRetry: () => void
  handlePlainRestart: () => void
}) {
  const statusPanel = (
    <ScanStatusPanel
      tone={isNoFile ? 'warn' : 'error'}
      title={isNoFile ? '系统说已完成，但这次结果里没有可用文件' : isExpired ? '等待超时，这次没有拿到文件' : '扫描未完成'}
      chips={isNoFile
        ? [{ label: '状态：已完成', tone: 'ok' }, { label: '这次扫描没有文件', tone: 'warn' }, { label: '这次扫描到此结束' }]
        : [
            ...(isExpired ? [{ label: '等待已超时', tone: 'warn' as const }] : []),
            { label: '这次扫描没有文件', tone: isExpired ? undefined : 'warn' as const },
            { label: '不自动重扫' },
          ]}
    >
      {isNoFile ? (
        <>
          <p>系统确认<b>这次扫描已经完成</b>，可是同一份结果里<b>没有带可用的文件信息</b>（结果里允许不带文件，这不是出错）。</p>
          <p>这份文件此刻还在不在系统里，<b>本机没有依据判断</b>。页面不替系统说它还在，不说它已被删掉，也不承诺能找回来。</p>
        </>
      ) : (
        <p>{reason
          ? preferUnattended(reason, `扫描任务未能完成，请重试。${helpNeededLine()}。`)
          : `扫描任务未能完成，请重试。${helpNeededLine()}。`}</p>
      )}
      {safeRescanLost ? (
        <p data-testid="scan-safe-rescan-lost">
          <b>刚才那份安全重扫凭据已经用不了了</b>（超过 15 分钟，或者中间清过场 / 换过人）。
          本页<b>没有</b>替你改成普通重扫 —— 同一张纸如果走普通扫描，系统会按重复件拒收，
          你会在机器前白等到这次扫描过期。要继续，请自己按右下角<b>「重新开始一次扫描」</b>，
          {`并且换一份材料。${helpNeededLine()}。`}
        </p>
      ) : null}
    </ScanStatusPanel>
  )
  const advice = (
    <div className="sw-grid2">
      <ScanNoteCard title="现在能做什么" foot="重扫是另建一次扫描，不是接着这一次。">
        <ScanPlan items={[
          rescanAuthorized
            ? '点右下角「重试扫描（同一份材料）」：那是另一次任务。'
            : '点右下角「重新开始一次扫描」：那是另一次任务，也不是免查重的重扫。',
          '重扫之前把纸取回来抚平、订书钉取掉。',
          rescanAuthorized
            ? '这一次会带上上一场的凭据去申请安全重扫放行：系统认了，同一份材料照原样再扫一遍就行；不认会在下一页当场说明，不会悄悄按普通重扫处理。'
            : `本机没有可用的安全重扫凭据：同一张纸原样再扫，系统可能按重复件拒收（两小时内），换一次扫描。${helpNeededLine()}。`,
          isNoFile ? '这个编号问不出文件，反复点也是同一句结果。' : `同一份材料连续失败两次。${helpNeededLine()}。`,
        ]} />
      </ScanNoteCard>
      <ScanNoteCard title="本机不会替系统补话">
        <ScanPlan items={[
          '不猜纸张或机器故障原因，本机收不到这些事件。',
          '不自动重扫，避免同一份材料出两份。',
          '不说「稍后会好」，也不按等待时长改判结果。',
        ]} />
      </ScanNoteCard>
    </div>
  )
  const chain = isNoFile ? null : (
    <ScanSec no={isExpired ? '01' : '02'} title={isExpired ? '就这三步' : '流程没走完'} hint="没有可用文件挂到这次扫描">
      <ScanChain active={-1} />
    </ScanSec>
  )
  return (
    <ScanWorkbenchShell
      page="scan-result"
      state={isNoFile ? 'completed-no-file' : isExpired ? 'wait-timeout' : 'failed'}
      layout="spread"
      title={isNoFile ? '已完成 · 结果里没有文件' : isExpired ? '等待超时' : '扫描未完成'}
      subtitle="本次没有生成可用的扫描文件"
      status={{ tone: isNoFile || isExpired ? 'warn' : 'bad', label: isNoFile ? '已完成 · 结果里没有文件' : isExpired ? '等待超时 · 没有文件' : '扫描未完成' }}
      ctabar={
        <ScanCta>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => leaveScanFlow('/print-scan')}>
            返回打印扫描
          </button>
          {isNoFile ? (
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => leaveScanFlow('/help')}>
              <HeadphonesIcon aria-hidden />
              问小青
            </button>
          ) : (
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => leaveScanFlow('/')}>
              返回首页
            </button>
          )}
          {rescanAuthorized ? (
            <button type="button" className="qx-btn" data-variant="primary" onClick={handleRetry}>
              重试扫描（同一份材料）
            </button>
          ) : (
            <button type="button" className="qx-btn" data-variant="primary" onClick={handlePlainRestart}>
              重新开始一次扫描
            </button>
          )}
        </ScanCta>
      }
    >
      {isExpired ? (
        <>
          {chain}
          <ScanSec no="02" title="现在这一步" hint="文件没有回到这台机器">
            {statusPanel}
          </ScanSec>
          <ScanSec no="03" title="现在怎么办" hint="右下角重扫，左下角回打印扫描">
            {advice}
          </ScanSec>
        </>
      ) : (
        <>
          {statusPanel}
          <ScanSec no="01" title={isNoFile ? '现在能做什么' : '现在怎么办'} hint={isNoFile ? '这是终态，不用再等' : '右下角重扫，左下角回打印扫描'}>
            {advice}
          </ScanSec>
          {chain}
        </>
      )}
    </ScanWorkbenchShell>
  )
}
