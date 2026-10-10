import { AlertCircleIcon } from 'lucide-react'
import { SCAN_OUTPUT_FORMAT_PENDING } from './scanOutputFormat'
import {
  ScanChain,
  ScanKvCard,
  ScanNoteCard,
  ScanPlan,
  ScanSec,
  ScanStatusPanel,
} from './ScanWorkbenchChrome'
import { SCAN_TYPE_LABELS, type ScanType } from './scanWorkbench'

/**
 * 等待页正文。从 ScanProgressPage 拆出来，是为了让那一页停在 500 行以内。
 * 「系统不做转换」跟着这一块走，门禁改读本文件，判据没减。
 */
export function ScanProgressSections({
  scanType,
  elapsed,
  error,
  polls,
  matched,
  cancelling,
  deliveryAcked,
  ackRetryable,
  pollInFlight,
  chainHint,
}: {
  scanType: ScanType
  elapsed: string
  error: string | null
  polls: number
  matched: boolean
  cancelling: boolean
  deliveryAcked: boolean
  ackRetryable: boolean
  pollInFlight: boolean
  chainHint: string
}) {
  const ackInMiddle = !deliveryAcked && !cancelling
  const statusPanel = (
    <ScanStatusPanel
      tone={error || ackRetryable ? 'warn' : 'info'}
      icon={error || ackRetryable ? AlertCircleIcon : undefined}
      title={
        cancelling
          ? '正在发送取消请求'
          : !deliveryAcked
            ? ackRetryable ? '还没确认这台机器能收这份文件' : '正在确认投递授权'
            : pollInFlight
              ? '正在查询系统'
              : error
                ? '查状态失败，任务仍按进行中处理'
                : '正在等文件回传'
      }
      breathe={!error && !ackRetryable}
      chips={deliveryAcked
        ? [
            { label: error ? '正在自动重试' : '正在自动检查', tone: error ? 'warn' : 'ok' },
            { label: `已查询 ${polls} 次` },
            matched ? { label: '系统：已匹配，仍在处理', tone: 'ok' as const } : { label: '没有页级进度' },
          ]
        : [
            { label: '这次扫描已经建好', tone: 'ok' as const },
            { label: '投递授权未确认', tone: 'warn' as const },
          ]}
    >
      {!deliveryAcked && !cancelling ? (
        <p data-testid="scan-ack-pending-notice">
          这一场<b>已经建好</b>，但系统还没确认这台机器可以收它的文件。
          没确认之前，面板上扫出来的东西<b>不会</b>交到这一场，所以<b>先别在面板上按开始</b>。
          它也<b>不会</b>被别人收走：没确认的任务不会接收任何文件。
          {ackRetryable ? '上一次确认没成，点右下角「再确认一次」重来。' : '确认通常就是一两秒。'}
        </p>
      ) : cancelling ? (
        <>
          <p>本机正在请系统取消这次扫描。<b>系统没回之前，页面不说已取消</b> —— 取消成不成功由系统定。</p>
          <p>如果这一刻文件刚好交完，取消就会来不及，那时以系统结果为准。</p>
        </>
      ) : pollInFlight ? (
        <>
          <p>本机正在问系统：这次扫描现在是什么状态。<b>结果没回来之前，这一页不改任何判断</b>。</p>
          <p>查询只是读一次：查多少次都不会重扫，系统不做转换。</p>
        </>
      ) : error ? (
        <>
          <p>这一次查询没拿到系统返回的结果：<b>{error}</b>。</p>
          <p><b>查不到不等于扫描失败</b> —— 这一页不改判任务状态，还当它在进行中，下次继续查。</p>
        </>
      ) : (
        <>
          <p>面板扫完之后，文件会回到这台机器。<b>这中间没有可显示的张数</b>，所以这里只告诉你系统最近一次说了什么、已经查过几次。</p>
          <p><b>本机正在自动检查</b>：每隔几秒替你问一次系统。想马上知道，点右下角「立即检查」就行。</p>
        </>
      )}
    </ScanStatusPanel>
  )
  const nextCards = (
    <div className="sw-grid2">
      <ScanKvCard
        title="任务信息"
        rows={[
          ['扫描类型', SCAN_TYPE_LABELS[scanType]],
          ['开始等待', `已等待 ${elapsed}`],
          ['输出格式', SCAN_OUTPUT_FORMAT_PENDING],
          ['保存策略', '按设备回传的原格式保存，系统不做转换'],
        ]}
      />
      <ScanNoteCard title="这一屏现在会做什么" foot="自动检查只是查一下状态：不会重扫，也不会改变系统里的任何东西。">
        <ScanPlan items={deliveryAcked ? [
          '本机每隔几秒自动查一次，你什么都不用做。',
          '想马上知道就点「立即检查」，它只是插一次队，不改变结果。',
          '不想扫了就点「取消扫描」，取消成不成由系统定。',
        ] : [
          '本机正在向系统确认：这台机器可以收这一场的文件。',
          ackRetryable ? '上一次确认没成，点右下角「再确认一次」重来。' : '确认通常就是一两秒，不用你做任何事。',
          '不想扫了就点「取消扫描」，取消成不成由系统定。',
        ]} />
      </ScanNoteCard>
    </div>
  )
  if (ackInMiddle) {
    return (
      <>
        <ScanSec no="01" title="就这三步" hint={chainHint}>
          <ScanChain active={-1} />
        </ScanSec>
        <ScanSec no="02" title="现在这一步" hint="投递授权还没到手">
          {statusPanel}
        </ScanSec>
        <ScanSec no="03" title="这次扫描与下一步" hint="这一屏现在能做什么">
          {nextCards}
        </ScanSec>
      </>
    )
  }
  return (
    <>
      {statusPanel}
      <ScanSec no="01" title="流程走到哪一段" hint={chainHint}>
        <ScanChain active={matched ? 3 : -1} />
      </ScanSec>
      <ScanSec no="02" title="这次扫描与下一步" hint="这一屏现在能做什么">
        {nextCards}
      </ScanSec>
    </>
  )
}
