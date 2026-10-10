// 简历对照的结果屏与选岗屏。从 JobFitPage 拆出，避免单文件超过 500 行。
// 读取、分析、授权与打印仍留在 JobFitPage。
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { ExternalJobDTO, JobFitResponse } from '@ai-job-print/shared'
import { BriefcaseIcon, CheckCircle2Icon, HelpCircleIcon, ListIcon, PrinterIcon, SearchIcon } from 'lucide-react'
import { AiDeclarationNote } from '../../../ai/AiDeclarationNote'
import { QxPageFrame } from '../../../components/qingxu/QxPageFrame'
import { JobAiConsentModal } from '../../jobs/components/JobAiConsentModal'
import { AnonymousJobFitConsentCard } from './AnonymousJobFitConsentCard'
import { AnonymousJobFitConsentDialog } from './AnonymousJobFitConsentDialog'
import { DecisionSummaryBar } from './DecisionSummaryBar'
import { DecisionCta, DecisionHero } from './DecisionWorkspaceChrome'
import { emphasizeTitle } from './emphasizeTitle'
import { FitSkillMap } from './FitSkillMap'
import { MemberJobFitConsentCard } from './MemberJobFitConsentCard'
import { JobFitStage } from './JobFitStage'
import { CtaNote, Guardline, KitRows, ManualTargetFields, NextSteps, PreflightChecklist, Sec } from './jobFitQxKit'
import { JOB_FIT_NEXT_STEPS, type JobFitStepTarget } from './jobFitResultSpec'
import type { JobFitExits } from './JobFitQxStates'

export function renderJobFitInteractive(p: {
  result: JobFitResponse | null
  hosting: { enabled: boolean }
  navigate: (to: string, opts?: { state?: unknown }) => void
  taskId: string | undefined
  accessToken: string | undefined
  exits: JobFitExits
  printing: boolean
  handlePrint: () => void
  handleAnalyze: () => void
  navbar: ReactNode
  resumeName: string
  isAnonymous: boolean
  anonymousConsentActive: boolean
  revokingConsent: boolean
  handleRevokeConsent: () => void
  notice: string | null
  error: string | null
  showAnonymousConsent: boolean
  analyzing: boolean
  consentError: string | null
  handleCancelAnonymousConsent: () => void
  handleConfirmAnonymousConsent: () => void
  showMemberConsent: boolean
  memberConsentBusy: boolean
  handleCancelMemberConsent: () => void
  handleConfirmMemberConsent: () => void
  setTab: Dispatch<SetStateAction<'pick' | 'manual'>>
  tab: 'pick' | 'manual'
  mode: 'pick' | 'manual'
  keyword: string
  setKeyword: (value: string) => void
  jobsLoading: boolean
  jobsError: boolean
  jobs: ExternalJobDTO[]
  selectedJob: ExternalJobDTO | null
  setSelectedJob: (job: ExternalJobDTO | null) => void
  manualTitle: string
  manualReq: string
  setManualTitle: (value: string) => void
  setManualReq: (value: string) => void
  memberConsentRequired: boolean
  setShowMemberConsent: (open: boolean) => void
}): ReactNode {
  const {
    result, hosting, navigate, taskId, accessToken, exits, printing, handlePrint, handleAnalyze, navbar,
    resumeName, isAnonymous, anonymousConsentActive, revokingConsent, handleRevokeConsent,
    notice, error, showAnonymousConsent, analyzing, consentError,
    handleCancelAnonymousConsent, handleConfirmAnonymousConsent,
    showMemberConsent, memberConsentBusy, handleCancelMemberConsent, handleConfirmMemberConsent,
    setTab, tab, mode, keyword, setKeyword, jobsLoading, jobsError, jobs,
    selectedJob, setSelectedJob, manualTitle, manualReq, setManualTitle, setManualReq,
    memberConsentRequired, setShowMemberConsent,
  } = p
  // ── 结果视图 ──────────────────────────────────────────────────────────────
  if (result) {
    /**
     * 行动页入口只在**真有内容**时出现。
     * 计数是确定性逻辑（数组长度相加），不是 AI 判断 —— 因此不标 E3。
     */
    const gapActionCount =
      (result.gapPoints ?? []).length + (result.targetedSuggestions ?? []).length
    // 系统内岗位的来源与「查看岗位」只在招聘内容托管打开时出现；关着时岗位页本来就进不去。
    const showSource = hosting.enabled && Boolean(result.job?.sourceName)
    const goStep = (target: JobFitStepTarget) => {
      if (target === 'actions') { navigate('/resume/job-fit/actions', { state: { taskId, accessToken } }); return }
      if (target === 'optimize') { exits.optimize(); return }
      navigate('/resume/materials')
    }
    return (
      <JobFitStage>
        <QxPageFrame
          title="简历对照"
          status={{ tone: 'ok', label: '对照结果已返回' }}
          back={{ label: '返回简历服务', onBack: exits.resumeHub }}
          navbar={navbar}
          ctabar={
            <DecisionCta>
              <CtaNote>对照只说明简历里写到了什么，不代表企业的真实评价。</CtaNote>
              <button type="button" className="qx-btn" data-variant="ghost" disabled={printing} onClick={() => void handlePrint()}>
                <PrinterIcon size={22} aria-hidden="true" />
                {printing ? '生成中' : '打印报告'}
              </button>
              {hosting.enabled && result.job?.id ? (
                <button type="button" className="qx-btn" data-variant="teal" onClick={() => { if (result.job?.id) navigate(`/jobs/${result.job.id}`) }}>
                  <BriefcaseIcon size={22} aria-hidden="true" />
                  查看岗位
                </button>
              ) : (
                <button type="button" className="qx-btn" data-variant="teal" onClick={exits.backToPick}>
                  换个岗位分析
                </button>
              )}
              <button type="button" className="qx-btn" data-variant="primary" onClick={exits.optimize}>
                优化简历
              </button>
            </DecisionCta>
          }
        >
          <DecisionHero
            eyebrow="简历对照"
            title={emphasizeTitle('写到了哪些，还缺哪些。')}
            copy="按你写下的要求，逐条列出简历里已经写到的和还没体现的；不分档、不打分，也不判断能否录用。"
          />
          <main
            className="qx-scroll"
            data-kiosk-domain="resume"
            data-kiosk-screen="resume-job-fit"
            data-state="result"
            data-testid="resume-job-fit-state-result"
          >
            <p className="jfq-sec-copy" data-testid="job-fit-resume-name">正在用：{resumeName}</p>
            <Sec title="对照概要" hint="仅供本人准备使用">
              <DecisionSummaryBar
                jobTitle={result.job?.title ?? '目标岗位'}
                company={result.job?.company}
                summary={result.summary}
              />
              <Guardline
                head="只对照，不打分"
                body="不分档、不给分数或通过率，也不等于录用结论；结果只供本人准备，不提供给企业。"
              />
            </Sec>

            {isAnonymous && anonymousConsentActive && (
              <AnonymousJobFitConsentCard busy={revokingConsent} onRevoke={() => void handleRevokeConsent()} />
            )}

            <FitSkillMap
              matchPoints={result.matchPoints ?? []}
              gapPoints={result.gapPoints ?? []}
              keywordCoverage={result.decisionSupport?.keywordCoverage}
            />

            {/*
              「怎么办」已拆到 `/resume/job-fit/actions`（S2-2，矩阵 §3.5）：
              本页专心做「差在哪」（已写到 / 还没体现两栏 + 关键词命中），
              行动页专心做「怎么补」（差距项 + 定向改写 + 打印/改简历/备材料）。
              原先两块同屏，27 寸竖屏上要一边读比对一边找按钮，两件事互相打断。
            */}
            {gapActionCount > 0 && (
              <Sec title="下一步建议" hint="都是本机既有流程">
                <p className="jfq-sec-copy">
                  这次一共列出 {gapActionCount} 条可以着手补的地方。补什么、怎么补、本机能不能补，单独放在一屏里。
                </p>
                <NextSteps items={JOB_FIT_NEXT_STEPS.map((step) => ({
                  title: step.title,
                  desc: step.desc,
                  onClick: () => goStep(step.target),
                }))} />
              </Sec>
            )}

            {showSource && (
              <Sec title="岗位来源" hint="以来源平台公示为准">
                <div className="qx-card jfq-consent-card">
                  <p>
                    岗位来源：{result.job?.sourceName}{result.job?.externalId ? ` · 外部ID ${result.job.externalId}` : ''}
                  </p>
                  <p>准备好之后，请前往来源平台完成投递。</p>
                  {error && <p className="jfq-alert" role="alert">{error}</p>}
                </div>
              </Sec>
            )}

            {notice && <p className="jfq-notice" aria-live="polite">{notice}</p>}
            {error && !showSource && <p className="jfq-alert" role="alert">{error}</p>}
          </main>
        </QxPageFrame>
      </JobFitStage>
    )
  }

  // ── 选择视图 ──────────────────────────────────────────────────────────────
  // 托管关闭时手填是唯一的路：之前在岗位列表里点过的岗位不再算进「目标岗位」。
  const pickedJob = hosting.enabled ? selectedJob : null
  // 检查单跟着当前这条路走：切到手填后，之前点过的岗位不算目标（「开始比对」也只认手填的名称）。
  const target = mode === 'pick' ? pickedJob?.title : manualTitle.trim()
  return (
    <JobFitStage>
      <QxPageFrame
        title="简历对照"
        status={{ tone: 'unknown', label: '对照前请选好简历并确认授权' }}
        back={{ label: '返回简历服务', onBack: exits.resumeHub }}
        navbar={navbar}
        ctabar={
          <DecisionCta>
            <CtaNote>对照结果不代表录用判断，也不会提供给企业；本平台不提供投递功能。</CtaNote>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={exits.resumeHub}>
              返回简历服务
            </button>
            <span className="qx-ai-declaration-slot">
              <button type="button" className="qx-btn" data-variant="primary" disabled={analyzing} aria-busy={analyzing} onClick={() => void handleAnalyze()}>
                继续并确认授权
              </button>
              <AiDeclarationNote />
            </span>
          </DecisionCta>
        }
      >
        <DecisionHero
          eyebrow="简历对照"
          title={emphasizeTitle('先把目标说清，再决定下一步。')}
          copy="对照结果只给本人看，不分档、不打分。请核对简历和岗位要求后再开始。"
        />
        {showAnonymousConsent && (
          <AnonymousJobFitConsentDialog
            busy={analyzing}
            error={consentError}
            onCancel={handleCancelAnonymousConsent}
            onConfirm={() => void handleConfirmAnonymousConsent()}
          />
        )}
        {/*
          会员就地授权（S2-2 / 问题 F2）。复用岗位域的同一个弹窗与同一段法律文案 ——
          同一个 scope `job_ai` 不能有两份说法。
        */}
        <JobAiConsentModal
          open={showMemberConsent}
          loading={memberConsentBusy}
          error={consentError}
          onCancel={handleCancelMemberConsent}
          onConfirm={() => void handleConfirmMemberConsent()}
        />
        <main
          className="qx-scroll"
          data-kiosk-domain="resume"
          data-kiosk-screen="resume-job-fit"
          data-state="pick"
          data-testid="resume-job-fit-state-pick"
        >
          <p className="jfq-sec-copy" data-testid="job-fit-resume-name">正在用：{resumeName}</p>
          <Sec no="01" title={hosting.enabled ? '选择目标岗位' : '填一份岗位要求'} hint={hosting.enabled ? '系统岗位或手填目标，二选一' : 'AI 对照你的简历，只供本人分析'}>
            {hosting.enabled ? (<div className="jfq-choices">
              <button
                type="button"
                className="jfq-choice"
                onClick={() => setTab('pick')}
                aria-pressed={tab === 'pick'}
              >
                <h3>从已发布岗位中选择</h3>
                <p>这里只展示已发布岗位的标题、来源与详情。</p>
                <span>按来源数据选择</span>
              </button>
              <button
                type="button"
                className="jfq-choice"
                onClick={() => setTab('manual')}
                aria-pressed={tab === 'manual'}
              >
                <h3>手填目标岗位</h3>
                <p>只填写目标名称与要求，不会把内容提供给企业，也不替你操作。</p>
                <span>只供本人分析</span>
              </button>
            </div>) : null}

            {mode === 'pick' ? (
              <div className="jfq-field">
                <small>目标岗位</small>
                <div style={{ position: 'relative' }}>
                  <SearchIcon size={22} aria-hidden="true" style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--qx-ink-3)' }} />
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="搜索岗位名称 / 公司"
                    aria-label="搜索岗位名称或公司"
                    className="jfq-input"
                    style={{ paddingLeft: 52 }}
                  />
                </div>
                <div className="jfq-joblist" aria-busy={jobsLoading} aria-live="polite">
                  {jobsLoading ? (
                    <p className="jfq-sec-copy" role="status">正在加载岗位…</p>
                  ) : jobsError ? (
                    <p className="jfq-alert" role="alert">
                      岗位列表这次没取回来（不是没有岗位）。可以稍后重试，或直接切到「手填目标岗位」——
                      手填不依赖岗位库，照常能做简历对照。
                    </p>
                  ) : jobs.length === 0 ? (
                    <p className="jfq-sec-copy">没有找到岗位，可切换「手填目标岗位」</p>
                  ) : (
                    jobs.map((j) => {
                      const active = selectedJob?.id === j.id
                      return (
                        <button
                          key={j.id}
                          type="button"
                          className="jfq-job"
                          onClick={() => setSelectedJob(j)}
                          aria-pressed={active}
                          aria-label={`${j.title}，${j.company}，${active ? '已选择' : '未选择'}`}
                        >
                          <span className="jfq-job-tx">
                            <b>{j.title}</b>
                            <small>{j.company} · 来源：{j.sourceName}</small>
                          </span>
                          {active && <CheckCircle2Icon size={24} aria-hidden="true" />}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            ) : (
              <ManualTargetFields
                title={manualTitle}
                requirement={manualReq}
                onTitleChange={setManualTitle}
                onRequirementChange={setManualReq}
              />
            )}
          </Sec>

          <Sec no="02" title="分析前检查" hint="三项齐备才启动">
            <PreflightChecklist
              targetLabel={target || '尚未选择'}
              hasTarget={Boolean(target)}
              consentConfirmed={isAnonymous && anonymousConsentActive}
              manualOnly={!hosting.enabled}
            />
            {error && <p className="jfq-alert" role="alert">{error}</p>}
            {notice && <p className="jfq-notice" aria-live="polite">{notice}</p>}
            {memberConsentRequired && (
              <MemberJobFitConsentCard
                busy={memberConsentBusy}
                onAuthorize={() => setShowMemberConsent(true)}
              />
            )}
            {isAnonymous && anonymousConsentActive && (
              <AnonymousJobFitConsentCard busy={revokingConsent} onRevoke={() => void handleRevokeConsent()} />
            )}
          </Sec>

          <Sec no="03" title="不做 AI 分析，也能先推进" hint="都是既有流程">
            <KitRows items={[
              { icon: <PrinterIcon size={22} />, title: '打印现有简历', desc: '已有电子稿或纸质件，直接走打印流程', onClick: exits.printHub },
              ...(exits.jobs ? [{ icon: <ListIcon size={22} />, title: '看来源岗位要求', desc: '直接浏览来源平台的岗位信息，自己比对', onClick: exits.jobs }] : []),
              { icon: <HelpCircleIcon size={22} />, title: '问 AI 顾问怎么定目标', desc: '还没想清楚方向时，先把想法说出来', onClick: exits.assistant },
            ]} />
          </Sec>
        </main>
      </QxPageFrame>
    </JobFitStage>
  )}
