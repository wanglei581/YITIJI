// 行动清单各状态的正文。从 JobFitActionsPage 拆出，避免单文件超过 500 行。
import type { ReactNode } from 'react'
import type { JobFitResponse } from '@ai-job-print/shared'
import { BriefcaseIcon, FileTextIcon, ListIcon, PenLineIcon, PrinterIcon, UserIcon } from 'lucide-react'
import { AiDisclaimerLine, AigcMark, EvidenceBadge, EvidenceLegend } from '../../ai'
import {
  Checks, CtaNote, Ghosts, Guardline, KitRows, Nots, RouteCards, Sec, Slots, Steps, Trace, Verdict, Waiting,
} from './jobFit/jobFitQxKit'
import { actionsConfirm, actionsSessionVerdict } from './jobFit/jobFitActionsConfirm'

const JOB_FIT_ROUTE = '/resume/job-fit'

export interface ActionsScreenView {
  title: string
  subtitle: string
  pill: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  body: ReactNode
  cta: ReactNode
}

function QxAction({ label, variant, onClick, icon }: {
  label: string
  variant: 'ghost' | 'primary' | 'teal'
  onClick: () => void
  icon?: ReactNode
}) {
  return (
    <button type="button" className="qx-btn" data-variant={variant} onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}

export interface JobFitActionsViewDeps {
  screen: string
  result: JobFitResponse | null
  error: string | null
  failReason: string | null
  jobLabel: string
  hostingOpen: boolean
  isAnonymous: boolean
  aiOutage: string | null
  gapPoints: JobFitResponse['gapPoints']
  rewrites: JobFitResponse['targetedSuggestions']
  navigate: (to: string, opts?: { state?: unknown }) => void
  backToCompare: () => void
  goJobs: () => void
  goMaterials: () => void
  goPrintHub: () => void
  goResumeHub: () => void
  goResumeOptimize: () => void
  goTriage: () => void
  handlePrint: () => void
  setError: (value: string | null) => void
}

export function buildJobFitActionsView(d: JobFitActionsViewDeps): ActionsScreenView {
  const {
    screen, result, error, failReason, jobLabel, hostingOpen, isAnonymous, aiOutage,
    gapPoints = [], rewrites = [], navigate, backToCompare, goJobs, goMaterials, goPrintHub,
    goResumeHub, goResumeOptimize, goTriage, handlePrint, setError,
  } = d
  function buildView(): ActionsScreenView {
    // 出口一律不带 taskId / accessToken：会话已经不属于现在站在屏幕前的这一位。
    if (screen === 'session-ended') {
      return {
        title: '这次办理已结束',
        subtitle: '登录状态或这台机器上的这次使用刚刚变化（退出、过期或清场）。刚才的行动清单和还在路上的请求都不再显示或继续。',
        pill: { tone: 'warn', label: '这次办理已结束 · 内容已隐藏' },
        body: (
          <>
            {actionsSessionVerdict()}
            {actionsConfirm('session-ended')}
            <Sec title="这次没有发生的事" hint="明确否定，避免误解">
              <Nots items={[
                '不再显示刚才的差距清单与改写建议',
                '不再用刚才的登录凭证读取或生成打印版',
                '还在路上的返回结果不会再进入打印确认',
              ]} />
            </Sec>
          </>
        ),
        cta: (
          <>
            <CtaNote>需要继续时，请重新登录或重新准备简历材料。</CtaNote>
            <QxAction label="返回简历服务" variant="ghost" onClick={goResumeHub} />
            <QxAction label="去准备简历材料" variant="primary" onClick={goTriage} />
          </>
        ),
      }
    }

    if (screen === 'missing-task') {
      return {
        title: '还没有可用的对照结果',
        subtitle: '请先完成一次简历对照，再看差距行动清单。行动清单必须来自真实的对照结果，没有结果就不生成空模板。',
        pill: { tone: 'warn', label: '缺少可用的简历对照结果' },
        body: (
          <>
            <Sec no="01" title="清单依赖的三项输入" hint="缺一项就不生成">
              <Slots items={[
                { label: '本人简历任务', value: '尚未确认' },
                { label: '目标岗位', value: '尚未选择' },
                { label: '对照结果', value: '尚未生成' },
              ]} />
            </Sec>
            <Sec no="02" title="拿到清单的四步" hint="顺序固定，不能跳过" copy="每一步都在既有流程里完成，本页不会替你跳过其中任何一步。" grow>
              <Steps items={[
                { title: '准备本人简历任务', desc: '上传 PDF 或扫描纸质简历，等待解析成功。' },
                { title: '选择目标岗位', desc: hostingOpen ? '从已发布岗位中选择，或只填一个目标岗位名称。' : '填一份岗位要求，至少要有岗位名称。' },
                { title: '确认本人授权', desc: '确认之后，简历才会用于这次简历对照。' },
                { title: '等待对照结果返回', desc: '结果返回后，差距与建议才会变成可执行的行动项。' },
              ]} />
            </Sec>
            <Sec no="03" title="现在就能开始的两条路" hint="按你手上有什么来选">
              <RouteCards items={[
                { title: '去做简历对照', desc: '写下要对照的要求并确认授权，走完才会有行动清单。', action: '去简历对照', onClick: () => navigate(JOB_FIT_ROUTE) },
                hostingOpen
                  ? { title: '先看来源岗位要求', desc: '直接浏览来源平台的岗位信息，自己比对要求。', action: '去岗位信息', onClick: goJobs }
                  : { title: '先准备简历材料', desc: '上传或扫描一份简历，解析成功后才能对照。', action: '去准备简历', onClick: goTriage },
              ]} />
            </Sec>
          </>
        ),
        cta: (
          <>
            <CtaNote>没有真实结果时，不生成也不打印任何清单。</CtaNote>
            <QxAction label="返回简历服务" variant="ghost" onClick={goResumeHub} />
            <QxAction label="去准备简历材料" variant="primary" onClick={goTriage} />
          </>
        ),
      }
    }

    if (screen === 'loading') {
      return {
        title: '正在读取，清单还没到',
        subtitle: '读取请求已提交。只有系统确认存在真实差距与建议，才会出现行动项。',
        pill: { tone: 'unknown', label: '正在读取行动清单' },
        body: (
          <>
            <Sec title="正在读取本人的行动清单" hint="无进度条 · 无预计时间">
              <Waiting
                icon={<ListIcon size={34} />}
                title="读取请求已提交，等待返回"
                desc="清单内容全部来自这次对照结果。读取失败或没有内容会直接说明，不补造行动项。"
                tag="整体等待中，没有百分比"
              />
            </Sec>
            <Sec title="这次读取用到的条件" hint="每一项都可核对" grow>
              <Checks items={[
                { tone: 'ok', icon: <UserIcon size={24} />, title: '本人凭证', desc: '请求带着你这次登录的身份，系统据此只返回属于你本人的清单。', chip: '已提交' },
                { tone: 'wait', icon: <FileTextIcon size={24} />, title: '对照结果', desc: '按这次对照的任务读取；任务失效或不属于你时会直接说明。', chip: '等待返回' },
                { tone: 'wait', icon: <ListIcon size={24} />, title: '行动项内容', desc: '差距与准备建议由系统逐条给出。', chip: '等待返回' },
                { tone: 'wait', icon: <PrinterIcon size={24} />, title: '打印版文件', desc: '清单可读之后才谈打印，本页现在不生成任何文件。', chip: '未开始' },
              ]} />
            </Sec>
            <Sec title="还没有返回的内容" hint="返回前一律留空">
              <Ghosts items={[
                { title: '差距与依据', desc: '每条行动项对应的岗位要求与准备建议，返回后才显示。', tag: '等待返回' },
                { title: '可执行动作', desc: '优化、材料准备还是打印，按真实建议再决定。', tag: '等待返回' },
              ]} />
            </Sec>
          </>
        ),
        cta: (
          <>
            <CtaNote>读取期间不放开打印，也不提前显示清单内容。</CtaNote>
            <QxAction label="返回简历服务" variant="ghost" onClick={goResumeHub} />
            <QxAction label="取消读取，返回简历对照" variant="primary" onClick={backToCompare} />
          </>
        ),
      }
    }

    if (screen === 'ai-down') {
      return {
        title: '差距清单这次读不到',
        subtitle: `${aiOutage ?? 'AI 服务当前不可用'} —— 差距与准备建议由 AI 生成，这次生成不了。`,
        pill: { tone: 'bad', label: 'AI 差距清单当前不可用' },
        body: (
          <>
            <Sec title="当前判定" hint="只写已经确认的事实">
              <Verdict items={[
                { tone: 'bad', label: 'AI 差距与准备建议', value: '当前不可用' },
                hostingOpen ? { tone: 'ok', label: '岗位原文与来源信息', value: '照常可看' } : { tone: 'ok', label: '简历优化编辑区', value: '照常能改' },
                { tone: 'ok', label: '简历原文与打印', value: '不经过这条 AI' },
              ]} />
              <p className="jfq-sec-copy">
                {hostingOpen
                  ? '岗位原文与来源信息照常可看；你的简历原文照常可打印；简历优化编辑区也照常能改。想投递请回岗位详情页，从来源平台入口走。'
                  : '你的简历原文照常可打印；简历优化编辑区也照常能改。'}
              </p>
            </Sec>
            {actionsConfirm('ai-down')}
            <Sec title="现在能用的非 AI 入口" hint="都是既有流程">
              <KitRows items={[
                { icon: <PenLineIcon size={22} />, title: '自己改简历', desc: '简历优化编辑区照常能改', onClick: goResumeOptimize },
                ...(hostingOpen ? [{ icon: <ListIcon size={22} />, title: '看来源岗位要求', desc: '直接浏览来源平台的岗位信息', onClick: goJobs }] : []),
                { icon: <PrinterIcon size={22} />, title: '打印现有简历', desc: '走既有打印流程，不依赖 AI', onClick: goPrintHub },
              ]} />
            </Sec>
          </>
        ),
        cta: (
          <>
            <CtaNote>服务不可用时不显示任何清单内容，也不承诺恢复时间。</CtaNote>
            <QxAction label="返回简历服务" variant="ghost" onClick={goResumeHub} />
            <QxAction label="返回对照结果" variant="primary" onClick={backToCompare} />
          </>
        ),
      }
    }

    if (screen === 'failed') {
      return {
        title: '这次没有可执行的差距清单',
        subtitle: failReason
          ? `本次没有可执行的差距清单：${failReason}`
          : '本次没有可执行的差距清单。',
        pill: { tone: 'warn', label: '本次没有返回行动项' },
        body: (
          <>
            <Sec title="这次的结果" hint="只写事实，不补内容">
              <Verdict items={[
                { tone: 'warn', label: '差距清单', value: '这次没有' },
                { tone: 'ok', label: '简历对照', value: '回对照页查看' },
              ]} />
              <p className="jfq-sec-copy">
                这不是你的操作问题。可以回对照页重新分析一次；若这个岗位的要求写得很笼统，通常就抽不出可执行的差距项。
              </p>
            </Sec>
            {actionsConfirm('failed')}
            <Sec title="接下来" hint="都进入既有流程">
              <RouteCards items={[
                { title: '回对照结果', desc: '重新分析一次，或换一个更具体的目标岗位。', action: '返回对照结果', onClick: backToCompare },
                { title: '先自己改简历', desc: '按目标岗位调整内容重点，不依赖这份清单。', action: '去简历优化', onClick: goResumeOptimize },
                hostingOpen
                  ? { title: '看来源岗位要求', desc: '直接浏览来源平台的岗位信息，自己逐条比对。', action: '去岗位信息', onClick: goJobs }
                  : { title: '打印现有简历', desc: '手上已有可用文件时，直接进入既有打印流程。', action: '去打印服务', onClick: goPrintHub },
              ]} />
            </Sec>
          </>
        ),
        cta: (
          <>
            <CtaNote>没有返回的内容不会先填上凑数。</CtaNote>
            <QxAction label="返回简历服务" variant="ghost" onClick={goResumeHub} />
            <QxAction label="返回对照结果" variant="primary" onClick={backToCompare} />
          </>
        ),
      }
    }

    if (screen === 'unknown') {
      return {
        title: '还没有确认服务状态',
        subtitle: '还没有确认 AI 服务状态，本页暂不展示差距清单 —— 状态不明时不假装能算。',
        pill: { tone: 'unknown', label: '服务状态未确认' },
        body: (
          <Sec title="现在能做的" hint="回到对照页会重新读取">
            <RouteCards items={[
              { title: '回对照结果', desc: '对照页会重新读取这次的对照结果。', action: '返回对照结果', onClick: backToCompare },
              hostingOpen
                ? { title: '看来源岗位要求', desc: '直接浏览来源平台的岗位信息。', action: '去岗位信息', onClick: goJobs }
                : { title: '先自己改简历', desc: '按目标岗位调整内容重点，不依赖这份清单。', action: '去简历优化', onClick: goResumeOptimize },
            ]} />
          </Sec>
        ),
        cta: (
          <>
            <CtaNote>状态不明时不显示任何清单内容。</CtaNote>
            <QxAction label="返回对照结果" variant="primary" onClick={backToCompare} />
          </>
        ),
      }
    }

    if (screen === 'print-pending') {
      return {
        title: '打印版还没有生成',
        subtitle: '文件正在等待生成。生成成功才进入既有打印确认流程；本页不代表已打印或已出纸。',
        pill: { tone: 'unknown', label: '等待生成打印版文件' },
        body: (
          <>
            <Sec title="已提交生成打印版" hint="生成 ≠ 打印">
              <Waiting
                icon={<PrinterIcon size={34} />}
                title="请求已提交，等待文件生成"
                desc="行动清单可读，不等于打印文件已经存在。文件真实生成后，才会进入既有的打印确认与取件流程。"
                tag="等待生成，没有进度和预计时间"
              />
            </Sec>
            <Sec title="打印这件事现在到哪一步" hint="只标位置，不画进度">
              <Trace items={[
                { phase: '第一步', title: '清单已可读', desc: '行动项来自这次真实的对照结果。' },
                { phase: '第二步', title: '等待生成文件', desc: '生成文件之前不进入打印。', now: true },
                { phase: '第三步', title: '进入打印确认', desc: '份数、单双面与费用在确认页由你决定。' },
              ]} />
            </Sec>
            <Sec title="现在还没有发生的事" hint="不提前写成已完成" grow>
              <Nots items={[
                '没有发送到打印机，也没有开始出纸',
                '没有产生取件码或订单号',
                '本页没有发起支付',
                '还没有拿到可预览的打印版文件',
                '没有把清单内容提供给企业或第三方',
              ]} />
            </Sec>
          </>
        ),
        cta: (
          <>
            <CtaNote>离开本页后，这次生成的结果不会再把你带去打印确认页。</CtaNote>
            <QxAction label="返回对照结果" variant="ghost" onClick={backToCompare} />
            <QxAction label="改用现有文件打印" variant="primary" onClick={goPrintHub} />
          </>
        ),
      }
    }

    if (screen === 'print-failed') {
      return {
        title: '打印版没有生成成功',
        subtitle: '文件生成失败。系统不会把失败写成已发送打印。',
        pill: { tone: 'bad', label: '打印版文件生成失败' },
        body: (
          <>
            <Sec title="这次的结果" hint="只写已确认的事实">
              <Verdict items={[
                { tone: 'bad', label: '打印版文件', value: '未生成' },
                { tone: 'ok', label: '行动清单', value: '仍可查看' },
                { tone: 'ok', label: '打印机', value: '未收到任务' },
              ]} />
              {error && (
                <p className="jfq-alert" role="alert">{error}</p>
              )}
            </Sec>
            {actionsConfirm('print-failed')}
            <Sec title="接下来" hint="两条都进入既有流程">
              <RouteCards items={[
                { title: '重新生成打印版', desc: '沿用当前清单再试一次，不重新做这次对照。', action: '重新生成', onClick: () => void handlePrint() },
                { title: '改用现有文件打印', desc: '手上已有可用文件或纸质件时，直接走既有打印流程。', action: '去打印服务', onClick: goPrintHub },
              ]} />
            </Sec>
          </>
        ),
        cta: (
          <>
            <CtaNote>失败就是失败，不写成已发送到打印机。</CtaNote>
            <QxAction label="返回行动清单" variant="ghost" onClick={() => setError(null)} />
            <QxAction label="重新生成打印版" variant="primary" onClick={() => void handlePrint()} />
          </>
        ),
      }
    }

    return {
      title: '清单来了，一件一件来',
      subtitle: '每条准备事项都来自这次的对照结果。没有返回的条目留空，不先填内容凑数。',
      pill: { tone: 'ok', label: '行动建议以真实对照结果为准' },
      body: (
        <>
          <Sec title="你的准备清单" hint="按这次返回的内容分组" grow>
            <Slots items={[
              { label: '目标岗位', value: jobLabel },
              { label: '清单归属', value: '仅本人准备使用', fixed: true },
            ]} />
            <div className="rdq-ai">
              <AiDisclaimerLine>
                以下差距与准备建议由 AI 依据你的简历与该岗位公开要求生成，仅供参考，不代表任何招聘结果。
              </AiDisclaimerLine>
            </div>
            <div className="rdq-groups">
              <section className="rdq-group" data-tone="urgent" aria-label="差距与准备建议">
                <div className="rdq-group-top">
                  <span className="rdq-group-no" aria-hidden="true">1</span>
                  <b>差距与准备建议</b>
                  <span className="rdq-group-chip">{gapPoints.length > 0 ? `${gapPoints.length} 项` : '本次未提供'}</span>
                </div>
                <p className="rdq-group-desc">岗位要求里有、简历里还看不到的部分，以及每一项怎么补。</p>
                {gapPoints.length > 0 ? (
                  <ul className="rdq-items">
                    {gapPoints.map((point, index) => (
                      <li key={`${point.gap.slice(0, 24)}-${index}`} className="rdq-item">
                        <b><EvidenceBadge level="E3" />{point.gap}</b>
                        <p>{point.suggestion}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rdq-muted">这次返回的结果里没有差距项。</p>
                )}
              </section>
              <section className="rdq-group" data-tone="week" aria-label="简历定向优化建议">
                <div className="rdq-group-top">
                  <span className="rdq-group-no" aria-hidden="true">2</span>
                  <b>简历定向优化建议</b>
                  <span className="rdq-group-chip">{rewrites.length > 0 ? `${rewrites.length} 条` : '本次未提供'}</span>
                </div>
                <p className="rdq-group-desc">照着改的是你自己的简历，本页不会自动改写或保存任何内容。</p>
                {rewrites.length > 0 ? (
                  <ul className="rdq-items">
                    {rewrites.map((item, index) => (
                      <li key={`${item.slice(0, 24)}-${index}`} className="rdq-item">
                        <b><EvidenceBadge level="E3" />{item}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rdq-muted">这次返回的结果里没有改写建议。</p>
                )}
              </section>
              <section className="rdq-group" data-tone="print" aria-label="材料与打印">
                <div className="rdq-group-top">
                  <span className="rdq-group-no" aria-hidden="true">3</span>
                  <b>材料与打印</b>
                  <span className="rdq-group-chip">由你决定</span>
                </div>
                <p className="rdq-group-desc">需要纸质件时，先生成打印版，再在打印确认页决定份数与单双面。</p>
                <div className="rdq-fields">
                  <div className="rdq-field"><small>打印版文件</small><span>尚未生成</span></div>
                  <div className="rdq-field"><small>要不要纸质件</small><span>由你在打印流程里确认</span></div>
                </div>
              </section>
            </div>
            <div className="rdq-ai">
              <EvidenceLegend />
              <AigcMark />
            </div>
          </Sec>

          <Sec title="准备路径" hint="确认后再进入既有流程">
            <RouteCards items={[
              { title: '按建议改简历', desc: '按你确认的方向修改内容，不自动改写简历。', action: '去简历优化', onClick: goResumeOptimize },
              { title: '准备求职材料', desc: '按目标岗位补齐成果、证书这类可出示材料。', action: '去材料工坊', onClick: goMaterials },
              { title: '生成打印版', desc: '文件生成成功后才进入打印确认，生成前不表示已打印。', action: '生成打印版', onClick: () => void handlePrint() },
            ]} />
            <Guardline
              head="清单只供本人准备"
              body="以下内容仅为帮助你修改简历与准备材料的参考，不代表任何招聘结果；本平台不提供投递功能，投递请前往岗位来源平台。"
            />
          </Sec>

          {hostingOpen && result?.job?.sourceName && (
            <Sec title="岗位来源" hint="以来源平台公示为准">
              <div className="qx-card jfq-consent-card">
                <p>
                  岗位来源：{result.job.sourceName}
                  {result.job.externalId ? ` · 外部ID ${result.job.externalId}` : ''}
                </p>
                <p>准备好之后，请前往来源平台完成投递。</p>
                {result.job.id && (
                  <div className="rdq-actions">
                    <QxAction
                      label="查看岗位"
                      variant="teal"
                      icon={<BriefcaseIcon size={22} aria-hidden="true" />}
                      onClick={() => navigate(`/jobs/${result.job?.id ?? ''}`)}
                    />
                  </div>
                )}
              </div>
            </Sec>
          )}

          {isAnonymous && (
            <Guardline head="这次使用" body="未登录时，本次结果只保留在这台机器的这次使用里，离场即清。" />
          )}
        </>
      ),
      cta: (
        <>
          <CtaNote>没有返回的条目会一直留空，不会先填内容凑数。</CtaNote>
          <QxAction label="返回对照结果" variant="ghost" onClick={backToCompare} />
          <QxAction
            label="生成打印版"
            variant="primary"
            icon={<PrinterIcon size={22} aria-hidden="true" />}
            onClick={() => void handlePrint()}
          />
        </>
      ),
    }
  }

  return buildView()
}
