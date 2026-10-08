// ============================================================
// AI 简历生成 - 第 0 屏 + 四步填写（基本 / 意向 / 经历 / 技能与自评）
//
// 合规红线:
//   - AI 只润色用户提供的信息,不编造学历/证书/公司/项目;缺失内容提示补充,不代填。
//   - 公共一体机:表单只在这次访问的内存里。刷新、返回或待机即丢失。
//     预览页回来改资料时,用本次跳转自带的内容还原,不另写一份留在机器上。
//     生成结果走后端 AiResumeResult TTL 清理,不长期保留。
// ============================================================

import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SparklesIcon } from 'lucide-react'
import type { GeneratedResume, ResumeGenerateInput, ResumeGenerateResponse } from '@ai-job-print/shared'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { AiTaskRegion, useAiTask, isAiOutage, type AiAvailability, type AiTaskFallback } from '../../ai'
import { AiDeclarationNote } from '../../ai/AiDeclarationNote'
import { aiDeclarationDeclineMessage, isAiDeclarationUserText } from '../../ai/aiDeclarationErrors'
import { exportResumeDraft, submitResumeGenerate } from '../../services/api'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { useResumeAiConsent } from './resumeAiConsent'
import { ResumeAiConsentDialog } from './components/ResumeAiConsentDialog'
import { ResumeGenerateAdvisor, ResumeGenerateAiRow } from './components/ResumeGenerateQxChrome'
import { ResumeGenerateReview } from './components/ResumeGenerateReview'
import { ResumeVoiceInputButton } from './components/ResumeVoiceInputButton'
import { ResumeGenerateEntry } from './components/ResumeGenerateEntry'
import { ResumeGenerateBasicStep } from './components/ResumeGenerateBasicStep'
import { ResumeGenerateIntentionStep } from './components/ResumeGenerateIntentionStep'
import { ResumeGenerateHistoryStep } from './components/ResumeGenerateHistoryStep'
import { ResumeGenerateStrengthsStep } from './components/ResumeGenerateStrengthsStep'
import { GenerateHelper, GenerateProgress } from './components/ResumeGenerateShell'
import {
  LIMITS,
  STEPS,
  STEP_STATE,
  TEXT_LIMITS,
  bootGenerate,
  clampListText,
  clampText,
  splitList,
  type GenerateFormSnapshot,
  type HistorySeg,
} from './components/resumeGenerateModel'
import { useStartPrintHandoff } from '../print/usePrintHandoff'
import './resume-generate-qx.css'
import './resume-generate-flow-qx.css'

function appendVoiceText(current: string | undefined, transcript: string): string {
  return [current?.trim(), transcript.trim()].filter(Boolean).join('\n')
}

const HELP_TEXT = [
  '姓名、手机号这两项建议自己核对一遍，简历印出来就是这个。',
  '岗位写具体一点，整理时才知道往哪个方向顺你的经历。写「工作」不如写「仓储管理员」。',
  '一段经历不知道怎么讲？先问一句再写，比对着空框发呆快。',
  '证书这一栏别写没拿到的。简历上写了对方就会问，整理时也不会替你圆。',
]

export function ResumeGeneratePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const startPrint = useStartPrintHandoff()
  const { getToken } = useAuth()
  const consent = useResumeAiConsent()
  const [boot] = useState(() => bootGenerate(location.search, location.state))
  const [phase, setPhase] = useState(boot.phase)
  const [step, setStep] = useState(boot.step)
  const [seg, setSeg] = useState(boot.seg)
  const [reviewing, setReviewing] = useState(boot.reviewing)
  const [showConsent, setShowConsent] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** AI 能力级不可用的人话；null 表示未观测到不可用。 */
  const [aiOutage, setAiOutage] = useState<string | null>(null)
  /** 已完成过一次真实往返 —— 没探到之前一律 fail-closed（aiOutage.ts 的口径）。 */
  const [probed, setProbed] = useState(false)
  /** 原样草稿导出中（不经过 AI，只是服务端排版 + 上传）。 */
  const [exportingDraft, setExportingDraft] = useState(false)
  const [basic, setBasic] = useState(boot.basic)
  const [intention, setIntention] = useState(boot.intention)
  const [education, setEducation] = useState(boot.education)
  const [experience, setExperience] = useState(boot.experience)
  const [projects, setProjects] = useState(boot.projects)
  const [skillsText, setSkillsText] = useState(boot.skillsText)
  const [certsText, setCertsText] = useState(boot.certsText)
  const [selfIntro, setSelfIntro] = useState(boot.selfIntro)

  // 生成期间豁免待机宣传屏(打断会丢表单)。导出草稿同样豁免。
  useBusyLock(generating || exportingDraft)

  const canNext = useMemo(() => {
    if (step === 0) return basic.name.trim().length > 0
    if (step === 1) return intention.position.trim().length > 0
    return true
  }, [step, basic.name, intention.position])

  const snapshot = (): GenerateFormSnapshot => ({
    basic, intention, education, experience, projects, skillsText, certsText, selfIntro,
  })

  const buildInput = (): ResumeGenerateInput => ({
    basic: {
      name: basic.name.trim(),
      phone: basic.phone.trim() || undefined,
      email: basic.email.trim() || undefined,
      city: basic.city.trim() || undefined,
    },
    intention: {
      position: intention.position.trim(),
      city: intention.city.trim() || undefined,
      jobType: intention.jobType.trim() || undefined,
      salary: intention.salary.trim() || undefined,
    },
    education: education
      .filter((item) => item.school.trim())
      .map((item) => ({
        school: item.school.trim(),
        major: item.major?.trim() || undefined,
        degree: item.degree?.trim() || undefined,
        period: item.period?.trim() || undefined,
        description: item.description?.trim() || undefined,
      })),
    experience: experience
      .filter((item) => item.company.trim() && item.role.trim())
      .map((item) => ({
        company: item.company.trim(),
        role: item.role.trim(),
        period: item.period?.trim() || undefined,
        description: item.description.trim(),
      })),
    projects: projects
      .filter((item) => item.name.trim())
      .map((item) => ({ name: item.name.trim(), role: item.role?.trim() || undefined, description: item.description.trim() })),
    skills: splitList(skillsText, LIMITS.skills).map((item) => clampText(item, TEXT_LIMITS.skill)),
    certificates: splitList(certsText, LIMITS.certificates).map((item) => clampText(item, TEXT_LIMITS.certificate)),
    selfIntro: clampText(selfIntro.trim(), TEXT_LIMITS.selfIntro) || undefined,
  })

  const openStep = (next: number) => {
    setPhase('form')
    setReviewing(false)
    setStep(next)
  }
  const editFromReview = (next: number, nextSeg?: HistorySeg) => {
    setReviewing(false)
    setPhase('form')
    setStep(next)
    if (nextSeg) setSeg(nextSeg)
  }

  const runGenerate = async () => {
    setGenerating(true)
    setError(null)
    setAiOutage(null)
    const input = buildInput()
    try {
      const result: ResumeGenerateResponse = await submitResumeGenerate(input, getToken())
      if (result.failCode && isAiOutage({ code: result.failCode })) {
        setAiOutage('AI 暂时不可用，你可以先导出并打印已填的内容')
        return
      }
      setProbed(true)
      if (result.status !== 'completed' || !result.resume) {
        setError(result.failReason ?? 'AI 简历生成失败，请稍后重试')
        return
      }
      navigate('/resume/generate/preview', {
        state: { result, generateHandoff: { step: 0, seg, form: snapshot() } },
      })
    } catch (err) {
      const declined = aiDeclarationDeclineMessage(err)
      if (declined) {
        setError(declined)
        return
      }
      const message = userMessageOf(err, 'AI 简历生成失败，请稍后重试')
      setError(message)
      if (isAiOutage(err)) setAiOutage(message)
      else setProbed(true)
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerate = async () => {
    if (consent.checking) return
    if (!consent.ready) {
      setShowConsent(true)
      return
    }
    await runGenerate()
  }

  /**
   * 原样草稿：把用户已经填好的内容逐字导出成 PDF，进既有打印链路。
   * 不经过模型。它不是 AI 润色的等价替代，页面如实标成「未经 AI 润色」。
   */
  const handleExportDraft = async () => {
    if (exportingDraft) return
    setExportingDraft(true)
    setError(null)
    const input = buildInput()
    const draft: GeneratedResume = {
      basic: input.basic,
      intention: input.intention,
      summary: input.selfIntro ?? '',
      education: input.education,
      experience: input.experience,
      projects: input.projects,
      skills: input.skills,
      certificates: input.certificates,
    }
    try {
      const file = await exportResumeDraft(draft, getToken())
      if (!file.printFileUrl) throw new Error('打印链接未就绪，请稍后重试')
      startPrint({
        origin: 'resume_generate',
        returnPath: window.location.pathname,
        file: {
          name: file.filename,
          size: file.sizeBytes >= 1024 * 1024
            ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB`
            : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`,
          pages: file.pageCount,
          fileId: file.fileId,
          fileUrl: file.printFileUrl,
          mimeType: 'application/pdf',
        },
      })
    } catch (err) {
      setError(userMessageOf(err, '草稿导出失败，请稍后重试'))
    } finally {
      setExportingDraft(false)
    }
  }

  /**
   * 降级只用 blocked，不用 manual：原样草稿不是同一份润色结果。
   * 它挂在 stillAvailable 里，说明「仍然拿得到的东西」。
   */
  const availability: AiAvailability = aiOutage ? 'unavailable' : probed ? 'available' : 'unknown'
  const aiTask = useAiTask({
    availability,
    pending: generating,
    failed: Boolean(error) || Boolean(aiOutage),
    hasResult: false,
  })
  const draftAction = {
    label: exportingDraft ? '正在导出草稿…' : '导出并打印我填的内容（未经 AI 润色）',
    onClick: () => void handleExportDraft(),
  }
  const STILL_AVAILABLE =
    '你填的内容还留在这一页上，没有丢 —— 上下翻页、继续补充都照常。'
    + '导出与打印不经过 AI：下面这条可以把你填的原话直接排成 A4 PDF 打印带走（未经润色，也没有缺失提示）。'
  const personalDecline = error != null && isAiDeclarationUserText(error)
  const fallback: AiTaskFallback = personalDecline
    ? {
        mode: 'result-unavailable',
        reason: error,
        retryHint: '这次没有调用 AI。不想用 AI 的话，可以把已填内容原样导出打印。',
        action: draftAction,
      }
    : aiOutage
      ? {
          mode: 'blocked',
          reason: aiOutage,
          blockedActionLabel: 'AI 润色成文',
          stillAvailable: STILL_AVAILABLE,
          action: draftAction,
        }
      : {
          mode: 'result-unavailable',
          reason: error ?? '本次没能生成简历。',
          retryHint: `这不是你的操作问题，AI 服务本身是通的。可以直接再点一次「让 AI 整理成新简历」；不想等的话，${STILL_AVAILABLE}`,
          action: draftAction,
        }

  const viewState = boot.forcedState ?? (phase === 'entry' ? 'entry' : reviewing ? 'review' : STEP_STATE[step])
  const helpDraft = reviewing
    ? '我在核对从零填写的简历，帮我看看还有哪一项没填。'
    : `我在填简历第 ${step + 1} 步，帮我看看这一步怎么填`
  const nameBlocked = phase === 'form' && !reviewing && step === 0 && !canNext
  const positionBlocked = phase === 'form' && !reviewing && step === 1 && !canNext
  const statusLabel = generating
    ? '正在整理你的资料'
    : exportingDraft
      ? '正在把你填的内容排成 PDF'
      : aiOutage
        ? '整理暂时不可用'
        : error
          ? '这次没整理出来'
          : phase === 'entry'
            ? '从零生成 · 先看要问什么'
            : reviewing
              ? '核对 · 准备提交一次'
              : `第 ${step + 1} 步 / 共 4 步 · ${STEPS[step].title}`

  const ctabar = (
    <>
      {phase === 'entry' ? (
        <button type="button" className="qx-btn" data-variant="primary" data-testid="resume-generate-primary" onClick={() => openStep(0)}>
          开始填写（第 1 步）
        </button>
      ) : (
        <button
          type="button"
          className="qx-btn"
          data-variant="ghost"
          disabled={generating}
          onClick={() => {
            if (reviewing) { setReviewing(false); return }
            if (step === 0) navigate('/resume/source')
            else setStep((current) => current - 1)
          }}
        >
          {reviewing || step > 0 ? '上一步' : '返回简历服务'}
        </button>
      )}
      {phase !== 'entry' && (reviewing ? (
        <span className="qx-ai-declaration-slot">
          <button
            type="button"
            className="qx-btn"
            data-variant="primary"
            data-testid="resume-generate-primary"
            disabled={generating || Boolean(aiOutage)}
            onClick={() => { if (!aiOutage) void handleGenerate() }}
          >
            <SparklesIcon className="h-5 w-5" aria-hidden="true" />
            {generating ? '正在整理…' : '让 AI 整理成新简历'}
          </button>
          <AiDeclarationNote />
        </span>
      ) : step < 3 ? (
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          data-testid="resume-generate-primary"
          disabled={!canNext}
          aria-describedby={nameBlocked ? 'resume-generate-name-reason' : positionBlocked ? 'resume-generate-position-reason' : undefined}
          onClick={() => setStep((current) => current + 1)}
        >
          下一步：{STEPS[step + 1].title}
        </button>
      ) : (
        <button type="button" className="qx-btn" data-variant="primary" data-testid="resume-generate-primary" disabled={generating} onClick={() => setReviewing(true)}>
          去核对
        </button>
      ))}
      <ResumeGenerateAiRow />
    </>
  )

  return (
    <QxPageFrame
      title="从零生成简历"
      subtitle="分步问完，一次整理。只整理你说的，不替你编。"
      status={{
        tone: aiOutage || error ? 'bad' : generating || exportingDraft ? 'warn' : reviewing ? 'ok' : 'unknown',
        label: statusLabel,
      }}
      back={{ label: '返回简历服务', onBack: () => navigate('/resume/source') }}
      navbar={<QxAppNavbar onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />}
      ctabar={ctabar}
    >
      <section
        data-kiosk-domain="resume"
        data-kiosk-screen="resume-generate"
        data-generate-state={viewState}
        className="qx-resume-generate qx-scroll"
      >
        <ResumeGenerateAdvisor
          eyebrow="AI 简历生成"
          ask={phase === 'entry' ? '从零写一份简历？' : reviewing ? <>提交前<em>你先核一遍</em></> : STEPS[step].ask}
          doing={phase === 'entry' ? <>我分四步问你，问完<b>一次生成</b>。AI 只整理你说的，不替你编。</> : reviewing ? '先核对资料，再让小青整理成新简历。信息不完整的经历可点开补充。' : STEPS[step].doing}
        />
        {phase === 'entry' ? <ResumeGenerateEntry onOpen={openStep} /> : (
          <>
            {!reviewing && <GenerateProgress step={step} />}
            {reviewing ? (
              <ResumeGenerateReview
                basic={basic}
                intention={intention}
                education={education}
                experience={experience}
                projects={projects}
                skillsText={skillsText}
                certsText={certsText}
                selfIntro={selfIntro}
                onEdit={editFromReview}
              />
            ) : (
              <div className="qx-rd-work">
                <div className="qx-rd-main">
                  <div className="qx-card qx-rg-card">
                    {step === 0 && <ResumeGenerateBasicStep basic={basic} invalidName={boot.forcedState === 'validate-name'} onChange={setBasic} />}
                    {step === 1 && <ResumeGenerateIntentionStep intention={intention} invalidPosition={boot.forcedState === 'validate-position'} onChange={setIntention} />}
                    {step === 2 && (
                      <ResumeGenerateHistoryStep
                        seg={seg}
                        onSeg={setSeg}
                        education={education}
                        experience={experience}
                        projects={projects}
                        onEducation={setEducation}
                        onExperience={setExperience}
                        onProjects={setProjects}
                        educationVoice={(index) => (
                          <ResumeVoiceInputButton
                            label="在校情况"
                            className="qx-rd-voice"
                            disabled={generating}
                            onConfirm={(text) => setEducation((list) => list.map((row, idx) => idx === index ? { ...row, description: appendVoiceText(row.description, text) } : row))}
                          />
                        )}
                        experienceVoice={(index) => (
                          <ResumeVoiceInputButton
                            label="工作内容"
                            className="qx-rd-voice"
                            disabled={generating}
                            onConfirm={(text) => setExperience((list) => list.map((row, idx) => idx === index ? { ...row, description: appendVoiceText(row.description, text) } : row))}
                          />
                        )}
                        projectVoice={(index) => (
                          <ResumeVoiceInputButton
                            label="项目内容"
                            className="qx-rd-voice"
                            disabled={generating}
                            onConfirm={(text) => setProjects((list) => list.map((row, idx) => idx === index ? { ...row, description: appendVoiceText(row.description, text) } : row))}
                          />
                        )}
                      />
                    )}
                    {step === 3 && (
                      <ResumeGenerateStrengthsStep
                        skillsText={skillsText}
                        certsText={certsText}
                        selfIntro={selfIntro}
                        onSkills={(next) => setSkillsText(clampListText(next, TEXT_LIMITS.skill))}
                        onCerts={(next) => setCertsText(clampListText(next, TEXT_LIMITS.certificate))}
                        onIntro={(next) => setSelfIntro(clampText(next, TEXT_LIMITS.selfIntro))}
                        skillsVoice={<ResumeVoiceInputButton className="qx-rd-voice" label="技能" disabled={generating} onConfirm={(text) => setSkillsText((current) => clampListText(appendVoiceText(current, text), TEXT_LIMITS.skill))} />}
                        certsVoice={<ResumeVoiceInputButton className="qx-rd-voice" label="证书资质" disabled={generating} onConfirm={(text) => setCertsText((current) => clampListText(appendVoiceText(current, text), TEXT_LIMITS.certificate))} />}
                        introVoice={<ResumeVoiceInputButton className="qx-rd-voice" label="自我评价" disabled={generating} onConfirm={(text) => setSelfIntro((current) => clampText(appendVoiceText(current, text), TEXT_LIMITS.selfIntro))} />}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
            <GenerateHelper text={reviewing ? '可以慢慢核对，准备好后再点生成。' : HELP_TEXT[step]} draft={helpDraft} />
          </>
        )}
        {nameBlocked && (
          <p className="qx-rg-reason" id="resume-generate-name-reason">
            姓名还没填，填完才能进下一步。其余三项可以空着。
          </p>
        )}
        {positionBlocked && (
          <p className="qx-rg-reason" id="resume-generate-position-reason">
            目标岗位还没填，填完才能进下一步。城市、类型、薪资都可以空着。
          </p>
        )}
        {error && <p className="qx-rd-error" role="alert">{error}</p>}
        <AiTaskRegion className="resume-generate-fallback" task={aiTask} label="AI 简历润色成文" fallback={fallback} />
        <p className="rg-truth">AI 只整理你提供的描述；学校、公司和时间请本人核对。</p>
      </section>
      {showConsent && (
        <ResumeAiConsentDialog
          busy={consent.busy}
          error={consent.error}
          guest={!getToken()}
          onCancel={() => setShowConsent(false)}
          onConfirm={() => {
            void consent.confirm().then((ok) => {
              if (!ok) return
              setShowConsent(false)
              void runGenerate()
            })
          }}
        />
      )}
    </QxPageFrame>
  )
}
