import {
  ScanChain,
  ScanNoteCard,
  ScanPlan,
  ScanSec,
  ScanStatusPanel,
} from './ScanWorkbenchChrome'

/**
 * 结果页「没拿到可用文件」那三屏的正文（稿 18 failed / expired / completed-no-file）。
 *
 * **纯展示**：只读调用方给的结论与两个标志，不碰重扫授权、存储或跳转 —— 那些全在
 * ScanResultPage。拆出来是为了让结果页不再往 600 行以上长（CLAUDE.md §8）。
 *
 * 标题与第一枚标签只说**所有成因都成立**的那句话：这一屏也接本机自己放弃的两条路
 * （轮询到点、连续查不动），那两条服务端并没有说过「失败」或「过期」，
 * 真实成因由 reason 原样转达。
 */
export function ScanResultFailureBody({
  isNoFile,
  isExpired,
  reason,
  rescanAuthorized,
  safeRescanLost,
}: {
  isNoFile: boolean
  isExpired: boolean
  reason: string | undefined
  rescanAuthorized: boolean
  safeRescanLost: boolean
}) {
  const panel = (
    <ScanStatusPanel
      tone={isNoFile ? 'warn' : 'error'}
      title={isNoFile ? '系统说已完成，但这次结果里没有可用文件' : isExpired ? '等待超时，这次没有拿到文件' : '扫描未完成'}
      /* 不写「编号已作废」：本机放弃那两条路上的撤销没有回执，本机不知道服务端作没作废。 */
      chips={isNoFile
        ? [{ label: '状态：已完成', tone: 'ok' }, { label: '结果里没有文件信息', tone: 'warn' }, { label: '这次办理到此收尾' }]
        : [
            ...(isExpired ? [{ label: '等待已超时', tone: 'warn' as const }] : []),
            { label: '这次办理没有文件', tone: isExpired ? undefined : 'warn' as const },
            { label: '不自动重扫' },
          ]}
    >
      {isNoFile ? (
        <>
          <p>系统确认<b>这次扫描已经完成</b>，可是同一份结果里<b>没有带可用的文件信息</b>（结果里允许不带文件，这不是出错）。</p>
          <p>这份文件此刻还在不在系统里，<b>本机没有依据判断</b>：可能已按留存规则清理，也可能是这一次结果没有带上它。页面不替系统说它还在，不说它已被删掉，也不承诺能找回来。</p>
          <p>所以这次办理到这里收尾。再点也只会拿到同一句结果，这一屏不再发起新的查询。</p>
        </>
      ) : (
        <>
          <p>{reason ?? '扫描任务未能完成，请重试或联系工作人员'}</p>
          {isExpired ? null : <p>失败原因由系统给出，<b>本机不猜是纸的问题还是机器的问题</b>。这次办理没有可用文件，重扫要另开一次。</p>}
        </>
      )}
      {safeRescanLost ? (
        <p data-testid="scan-safe-rescan-lost">
          <b>刚才那份安全重扫凭据已经用不了了</b>（超过 15 分钟，或者中间清过场 / 换过人）。
          本页<b>没有</b>替你改成普通重扫 —— 同一张纸如果走普通扫描，系统会按重复件拒收，
          你会在机器前白等到这次扫描过期。要继续，请自己按右下角<b>「重新开始一次扫描」</b>，
          并且换一份材料或找工作人员。
        </p>
      ) : null}
    </ScanStatusPanel>
  )
  /* 按钮文案是两条分支（见 ctabar），指路也必须跟着分支走：写死「点右下角重试扫描」时，
   * 没有凭据的那一屏上根本没有叫这个名字的按钮。
   *
   * 服务端对「取过件但没建档成功」的同一份字节有两小时去重。本机**不知道**服务端铸没铸过
   * 那枚授权（本机在还停在 waiting 的任务上放弃轮询也会走到这里），所以只能说「会带着凭据
   * 去申请」，不能说「系统已经放行」。 */
  const rescanPointer = rescanAuthorized
    ? '点右下角「重试扫描（同一份材料）」：那是另一次任务。'
    : '点右下角「重新开始一次扫描」：那是另一次任务，也不是免查重的重扫。'
  const rescanCredential = rescanAuthorized
    ? '这一次会带上上一场的凭据去申请安全重扫放行：系统认了，同一份材料照原样再扫一遍就行；不认会在下一页当场说明，不会悄悄按普通重扫处理。'
    : '本机没有可用的安全重扫凭据：同一张纸原样再扫，系统可能按重复件拒收（两小时内），换一次扫描或找工作人员。'
  if (isNoFile) {
    return (
      <>
        {panel}
        <ScanSec no="01" title="现在能做什么" hint="这是终态，不用再等">
          <div className="sw-grid2 is-even">
            <ScanNoteCard title="还需要这份材料" foot="新开的那一次交回来的是新扫的那一份，不等于把这一次的结果找回来。">
              <ScanPlan items={[
                '点右下角「重新开始一次扫描」，再到面板上扫一遍 —— 那是另一次任务。',
                '重扫之前把纸从进纸器里取回来，订书钉取掉。',
                '这个编号问不出文件，反复点也是同一句结果。',
              ]} />
            </ScanNoteCard>
            <ScanNoteCard title="想弄清这份文件的下落" foot="留存按文件类型与系统留存规则执行，本屏不替它下结论。">
              <p>找工作人员，他们能按这台机器查这次任务和它的文件记录。本屏只转达系统这一次说了什么，问不出更多。</p>
              <p>归属在开始这次扫描那一刻就定了：那时没登录，扫描件就不挂账号。</p>
            </ScanNoteCard>
          </div>
        </ScanSec>
      </>
    )
  }
  if (isExpired) {
    return (
      <>
        {panel}
        <ScanSec no="01" title="停在哪一步" hint="文件没有挂到这次办理">
          <ScanChain active={-1} />
        </ScanSec>
        <ScanSec no="02" title="下一步" hint="这一屏现在能做什么">
          <div className="sw-grid2 is-even">
            <ScanNoteCard title="下次少走弯路" foot="这台机器的接收目录已由管理员配好，不用你填地址。">
              <ScanPlan items={[
                '在面板上选「扫描到网络文件夹」，不要选 U 盘或邮件。',
                '开始这次扫描、看到面板指引之后再去扫，别提前扫。',
                '扫完回到这台屏幕，进入等待后本机会自动查，别干等。',
                '证件正反面要翻面各扫一次。',
              ]} />
            </ScanNoteCard>
            <ScanNoteCard title="再扫一次之前" foot="重扫是另开一次，面板上的操作要再做一遍。">
              <ScanPlan items={[rescanPointer, rescanCredential]} />
            </ScanNoteCard>
          </div>
        </ScanSec>
      </>
    )
  }
  return (
    <>
      <ScanSec no="01" title="这次没扫成" hint="实际给出的原样结果">
        {panel}
      </ScanSec>
      <ScanSec no="02" title="现在怎么办" hint="右下角重扫，左下角找人">
        <div className="sw-grid2 is-even">
          <ScanNoteCard title="重扫一次要做的三件" foot="重扫不会自动开始，也不会接着这一次。">
            <ScanPlan items={[
              rescanPointer,
              '把纸取回来抚平、订书钉取掉，再回到奔图面板上重扫。',
              rescanCredential,
            ]} />
          </ScanNoteCard>
          <ScanNoteCard title="什么时候直接找工作人员" foot="本机收不到纸张与机器的故障事件，现场判断比在这一屏猜准。">
            <ScanPlan items={[
              '同一份材料连续失败两次，就别自己再试了。',
              '面板上按不动、报错或取不出纸，属于现场处理。',
              '「联系工作人员」随时可以点。',
            ]} />
          </ScanNoteCard>
        </div>
      </ScanSec>
      <ScanSec no="03" title="文件还没回到这台机器" hint="没有可用文件挂到这次办理">
        <div className="sw-stack">
          <ScanChain active={-1} />
          <ScanNoteCard title="本机不会替系统补话" foot="页面只原样转达系统这一次说了什么。">
            <ScanPlan className="is-two-col" items={[
              '不猜纸张或机器故障原因，本机收不到这些事件。',
              '不自动重扫，避免同一份材料出两份。',
              '不说「稍后会好」，也不按等待时长改判结果。',
            ]} />
          </ScanNoteCard>
        </div>
      </ScanSec>
    </>
  )
}
