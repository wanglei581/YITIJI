// ============================================================
// AI 简历生成 - 引导式表单(阶段2A)
//
// 合规红线:
//   - AI 只润色用户提供的信息,不编造学历/证书/公司/项目;缺失内容提示补充,不代填。
//   - 公共一体机:表单仅存本次会话内存，离页可续填，清场或刷新即丢失;
//     生成结果走后端 AiResumeResult TTL 清理,不长期保留。
// ============================================================

import { useMemo, useState } from 'react'
import { useResumeGenerateDraftField } from './resumeGenerateDraft'
import { useNavigate } from 'react-router-dom'
import { maskEmail, maskPhone } from '../../utils/maskPii'
import { ResumeHelpLine } from './touch/ResumeHelpLine'
import { ResumeStepPreview } from './touch/ResumeStepPreview'
import { ResumeTouchFrame } from './touch/ResumeTouchFrame'
import { unattendedReason } from './touch/unattendedReason'
import type {
  GeneratedResume,
  ResumeGenEducation,
  ResumeGenExperience,
  ResumeGenProject,
  ResumeGenerateInput,
  ResumeGenerateResponse,
} from '@ai-job-print/shared'
import { EDUCATION_LEVEL_OPTIONS } from '@ai-job-print/shared'
import { AiTaskRegion, useAiTask, isAiOutage, type AiAvailability, type AiTaskFallback } from '../../ai'
import { AiDeclarationNote } from '../../ai/AiDeclarationNote'
import { aiDeclarationDeclineMessage, isAiDeclarationUserText } from '../../ai/aiDeclarationErrors'
import {
  GraduationCapIcon,
  BriefcaseIcon,
  FolderGitIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  UserRoundIcon,
  WrenchIcon,
} from 'lucide-react'
import { exportResumeDraft, submitResumeGenerate } from '../../services/api'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { useResumeAiConsent } from './resumeAiConsent'
import { ResumeAiConsentDialog } from './components/ResumeAiConsentDialog'
import { ResumeGenerateAdvisor } from './components/ResumeGenerateQxChrome'
import { ASKS } from './touch/resumeAsks'
import { ResumeGenerateReview } from './components/ResumeGenerateReview'
import { ResumeVoiceInputButton } from './components/ResumeVoiceInputButton'
import { useStartPrintHandoff } from '../print/usePrintHandoff'
import './resume-generate-qx.css'
import './resume-generate-flow-qx.css'

const STEPS = [
  { title: '基本信息', description: '姓名与联系方式', ask: '先留下能联系上你的方式', doing: '这一步只有姓名必填。城市和联系方式可以空着。' },
  { title: '求职意向', description: '目标岗位', ask: '你想找什么方向的工作？', doing: '这一步只有目标岗位必填。' },
  { title: '教育经历', description: '学校与专业', ask: '把上过的学校说清楚', doing: '学校、专业和学历由你填写，整理时这些事实一个字都不会改。' },
  { title: '工作经历', description: '实习 / 工作', ask: '把做过的事说清楚', doing: '公司和职务由你填写。描述可以直接说，不用打字。' },
  { title: '项目经历', description: '可选', ask: '有项目就写一段', doing: '没有项目可以跳过。有的话，项目名由你填写。' },
  { title: '技能证书', description: '技能与自我评价', ask: '还有会什么，和怎么做事', doing: '技能和证书只填你真有的。自我评价写一两句，整理时帮你顺一下。' },
] as const

const inputCls = 'qx-rd-field'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="qx-rd-label">
      <span>
        {label}
        {required && <span className="ml-0.5 text-error-fg">*</span>}
      </span>
      {children}
    </label>
  )
}

/** 列表分组卡(教育/经历/项目共用):新增/删除条目,触控友好。 */
function EntryList<T>({
  items,
  onAdd,
  onRemove,
  addLabel,
  maxItems,
  emptyHint,
  renderItem,
}: {
  items: T[]
  onAdd: () => void
  onRemove: (index: number) => void
  addLabel: string
  maxItems: number
  emptyHint: string
  renderItem: (item: T, index: number) => React.ReactNode
}) {
  return (
    <div className="space-y-4">
      {items.length === 0 && (
        <p className="qx-rd-empty">{emptyHint}</p>
      )}
      {items.map((item, i) => (
        <div key={i} className="qx-card qx-rd-entry">
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="qx-rd-remove"
            aria-label="删除该条"
          >
            <Trash2Icon className="h-5 w-5" />
          </button>
          <div className="pr-10">{renderItem(item, i)}</div>
        </div>
      ))}
      {items.length < maxItems && (
        <button
          type="button"
          onClick={onAdd}
          className="qx-rd-add"
        >
          <PlusIcon className="h-5 w-5" />
          {addLabel}
        </button>
      )}
    </div>
  )
}

const EMPTY_EDU: ResumeGenEducation = { school: '', major: '', degree: '', period: '' }
const EMPTY_EXP: ResumeGenExperience = { company: '', role: '', period: '', description: '' }
const EMPTY_PROJ: ResumeGenProject = { name: '', role: '', description: '' }

function appendVoiceText(current: string | undefined, transcript: string): string {
  return [current?.trim(), transcript.trim()].filter(Boolean).join('\n')
}

export function ResumeGeneratePage() {
  const navigate = useNavigate()
  const startPrint = useStartPrintHandoff()
  const { getToken } = useAuth()
  const consent = useResumeAiConsent()
  const [showConsent, setShowConsent] = useState(false)
  const [step, setStep] = useResumeGenerateDraftField('step', 0)
  const [reviewing, setReviewing] = useResumeGenerateDraftField('reviewing', false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** AI 能力级不可用的**真实原因**（原样透出后端 message）；null 表示未观测到不可用。 */
  const [aiOutage, setAiOutage] = useState<string | null>(null)
  /** 已完成过一次真实往返 —— 没探到之前一律 fail-closed（aiOutage.ts 的口径）。 */
  const [probed, setProbed] = useState(false)
  /** 原样草稿导出中（不经过 AI，只是服务端排版 + 上传）。 */
  const [exportingDraft, setExportingDraft] = useState(false)

  // 只保留本次会话内存，退出/换人/待机统一清场；不落浏览器存储或 history。
  const [basic, setBasic] = useResumeGenerateDraftField('basic', { name: '', phone: '', email: '', city: '' })
  const [intention, setIntention] = useResumeGenerateDraftField('intention', { position: '', city: '', jobType: '', salary: '' })
  const [education, setEducation] = useResumeGenerateDraftField('education', [{ ...EMPTY_EDU }])
  const [experience, setExperience] = useResumeGenerateDraftField('experience', [{ ...EMPTY_EXP }])
  const [projects, setProjects] = useResumeGenerateDraftField('projects', [])
  const [skillsText, setSkillsText] = useResumeGenerateDraftField('skillsText', '')
  const [certsText, setCertsText] = useResumeGenerateDraftField('certsText', '')
  const [selfIntro, setSelfIntro] = useResumeGenerateDraftField('selfIntro', '')

  // 生成期间豁免待机宣传屏(打断会丢表单)。导出草稿同样豁免：那一步正在把用户
  // 填的内容变成一张能带走的纸，被待机屏打断等于把它又弄丢一次。
  useBusyLock(generating || exportingDraft)

  const canNext = useMemo(() => {
    if (step === 0) return basic.name.trim().length > 0
    if (step === 1) return intention.position.trim().length > 0
    return true
  }, [step, basic.name, intention.position])

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
    // 只提交填了关键字段的条目(学校/公司+职务/项目名),半空条目不提交
    education: education
      .filter((e) => e.school.trim())
      .map((e) => ({
        school: e.school.trim(),
        major: e.major?.trim() || undefined,
        degree: e.degree?.trim() || undefined,
        period: e.period?.trim() || undefined,
        description: e.description?.trim() || undefined,
      })),
    experience: experience
      .filter((e) => e.company.trim() && e.role.trim())
      .map((e) => ({
        company: e.company.trim(),
        role: e.role.trim(),
        period: e.period?.trim() || undefined,
        description: e.description.trim(),
      })),
    projects: projects
      .filter((p) => p.name.trim())
      .map((p) => ({ name: p.name.trim(), role: p.role?.trim() || undefined, description: p.description.trim() })),
    skills: skillsText.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 20),
    certificates: certsText.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 15),
    selfIntro: selfIntro.trim() || undefined,
  })

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
      // 拿到结构化响应就算一次真实往返 —— 账户级 / 模型名问题除外，那种每次都会失败。
      setProbed(true)
      if (result.status !== 'completed' || !result.resume) {
        setError(unattendedReason(result.failReason, 'AI 简历生成失败，请稍后重试'))
        return
      }
      // 连同本次填的内容一起交给预览页：它要拿填写的原话和模型的输出对照，找出「AI 新写进去的数和职责词」让本人确认；
      // 不带 input，用户自己写过的词（如「负责」）也会被当成新写进去的（走查 I-21）。
      navigate('/resume/generate/preview', { state: { result, input } })
    } catch (err) {
      const declined = aiDeclarationDeclineMessage(err)
      if (declined) {
        setError(declined)
        return
      }
      const message = unattendedReason(userMessageOf(err, 'AI 简历生成失败，请稍后重试'), 'AI 简历生成失败，请稍后重试')
      setError(message)
      // 只有能力级故障才判成「AI 不可用」；限流 / 参数错误等只是本次失败，
      // 那些必须保留重试入口，不许拿去把能力说成挂了（aiOutage.ts 口径）。
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
   * 原样草稿：把用户**已经填好的内容**逐字导出成 PDF，进既有打印链路。
   *
   * 这条路径不经过任何模型 —— 服务端 `/resume/generate/export` 只做 pdfkit 排版，
   * 所以 AI 挂掉时它照常可用。它**不是** AI 润色的等价替代：拿到的就是自己写的原话，
   * 页面与产物元数据都如实标成「未经 AI 润色」，不冒充成品。
   *
   * 口径来源：docs/design/kiosk-ai-os-v3-2026-08/10-resume-interview.html 的 ai-down 支线
   * （:394「现在可以把已答的部分导出成草稿带走」/ :523「草稿 ≠ 成文简历」）。
   */
  const handleExportDraft = async () => {
    if (exportingDraft) return
    setExportingDraft(true)
    setError(null)
    const input = buildInput()
    const draft: GeneratedResume = {
      basic: input.basic,
      intention: input.intention,
      // AI 不介入时不替用户写个人简介：他自己填了什么就是什么，没填就留空。
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
      setError(unattendedReason(userMessageOf(err, '草稿导出失败，请稍后重试'), '草稿导出失败，请稍后重试'))
    } finally {
      setExportingDraft(false)
    }
  }

  /**
   * 降级处置只用 `blocked`，不用 `manual`：
   * 「导出原样草稿」拿到的**不是**同一份结果（没有润色、没有缺失提示），
   * 套 manual 等于宣称有一条等价的手动路径，那是伪造能力（CLAUDE.md §9）。
   * 它是 `stillAvailable` 里如实说明的「仍然拿得到的东西」，并挂成可用动作。
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
        // 上次请求确认不可用；主动再检查仍由服务端判定，不自动调用或承诺恢复。
        mode: 'blocked',
        reason: aiOutage,
        blockedActionLabel: 'AI 润色成文',
        stillAvailable: STILL_AVAILABLE,
        action: draftAction,
      }
    : {
        // 模型跑了但这一次没出可用结果：**不是**能力不可用。
        // 这里若也用 blocked，就会出现「灰按钮说不可用」和「底部生成按钮仍可点」自相矛盾。
        mode: 'result-unavailable',
        reason: error ?? '本次没能生成简历。',
        retryHint: `这不是你的操作问题，AI 服务本身是通的。可以直接再点一次「让 AI 整理成新简历」；不想等的话，${STILL_AVAILABLE}`,
        action: draftAction,
      }

  const stepIcon = [UserRoundIcon, BriefcaseIcon, GraduationCapIcon, BriefcaseIcon, FolderGitIcon, WrenchIcon][step]
  const StepIcon = stepIcon

  const openReview = () => setReviewing(true)
  const editStep = (next: number) => {
    setReviewing(false)
    setStep(next)
  }
  const ctabar = (
    <>
      <button
        type="button"
        className="qx-btn"
        data-variant="ghost"
        disabled={generating}
        onClick={() => {
          if (reviewing) {
            setReviewing(false)
            return
          }
          if (step === 0) navigate('/resume/source')
          else setStep((s) => s - 1)
        }}
      >
        {reviewing || step > 0 ? '上一步' : '返回简历服务'}
      </button>
      {reviewing ? (
        <span className="qx-ai-declaration-slot">
          <button
            type="button"
            className="qx-btn"
            data-variant="primary"
            disabled={generating || exportingDraft}
            onClick={() => { void handleGenerate() }}
          >
            <SparklesIcon className="h-5 w-5" aria-hidden="true" />
            {generating ? '正在整理…' : aiOutage ? '重新检查并整理' : '让 AI 整理成新简历'}
          </button>
          <AiDeclarationNote />
        </span>
      ) : step < STEPS.length - 1 ? (
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          disabled={!canNext}
          aria-describedby={step === 0 && !canNext ? 'resume-generate-name-reason' : undefined}
          onClick={() => setStep((s) => s + 1)}
        >
          下一步：{STEPS[step + 1].title}
        </button>
      ) : (
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          disabled={generating}
          onClick={openReview}
        >
          去核对
        </button>
      )}
    </>
  )
  // 底栏「问小青」：每一步一句自己的问题（稿 scratch / scratch-1，第 3–6 步按同一写法补）；整理中、AI 停了、失败各有各的。
  const stepAsks = [ASKS.genBasic, ASKS.genIntention, ASKS.genEducation, ASKS.genExperience, ASKS.genProjects, ASKS.genSkills]
  const askSpec = generating || exportingDraft ? ASKS.genBusy : aiOutage ? ASKS.genDown : error ? ASKS.genFailed : reviewing ? ASKS.genReview : stepAsks[step]

  return (
    <ResumeTouchFrame
      eyebrow="改简历"
      rail={reviewing ? undefined : { labels: STEPS.map((item) => item.title), now: step }}
      title="从零生成简历"
      subtitle="分步问完，一次整理。只整理你说的，不替你编。"
      status={{
        tone: aiOutage || error ? 'bad' : generating || exportingDraft ? 'warn' : reviewing ? 'ok' : 'unknown',
        label: generating
          ? '正在整理你的资料'
          : exportingDraft
            ? '正在把你填的内容排成 PDF'
            : aiOutage
              ? '整理暂时不可用'
              : error
                ? '这次没整理出来'
                : reviewing
                  ? '核对 · 准备提交一次'
                  : `第 ${step + 1} 步 / 共 ${STEPS.length} 步 · ${STEPS[step].title}`,
      }}
      back={{ label: '返回简历服务', onBack: () => navigate('/resume/source') }}
      ctabar={ctabar}
      ask={{ ...askSpec, testId: 'resume-generate-ai-help' }}
    >
    <section data-kiosk-domain="resume" data-kiosk-screen="resume-generate" className="qx-resume-generate qx-scroll">
      <ResumeGenerateAdvisor
        eyebrow="AI 简历生成"
        ask={reviewing ? <>提交前<em>你先核一遍</em></> : STEPS[step].ask}
        doing={reviewing ? '先核对资料，再让小青整理成新简历。信息不完整的经历可点开补充。' : STEPS[step].doing}
      />
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
          onEdit={editStep}
        />
      ) : (
      <div className="qx-rd-work">
        <div className="qx-rd-main">
            <div className="qx-card qx-rg-card" key={step}>
              <div className="qx-rd-heading">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
                  <StepIcon className="h-5 w-5 text-primary-600" aria-hidden="true" />
                </span>
                <b>{STEPS[step].title}</b>
              </div>

          {step === 0 && (
            <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="姓名" required>
                <input className={inputCls} value={basic.name} onChange={(e) => setBasic((b) => ({ ...b, name: e.target.value }))} />
              </Field>
              <Field label="所在城市">
                <input className={inputCls} value={basic.city} onChange={(e) => setBasic((b) => ({ ...b, city: e.target.value }))} />
              </Field>
              <Field label="联系电话">
                <input className={inputCls} inputMode="tel" placeholder="用于简历上的联系方式" value={basic.phone} onChange={(e) => setBasic((b) => ({ ...b, phone: e.target.value }))} />
              </Field>
              <Field label="邮箱">
                <input className={inputCls} inputMode="email" value={basic.email} onChange={(e) => setBasic((b) => ({ ...b, email: e.target.value }))} />
              </Field>
            </div>
            <ResumeStepPreview
              kicker="简历顶部会这样显示"
              title={basic.name.trim() || '必填'}
              need={!basic.name.trim()}
              lines={[
                [basic.city.trim() || '城市未填', basic.phone.trim() ? maskPhone(basic.phone) : '电话未填'].join(' · '),
                basic.email.trim() ? maskEmail(basic.email) : '邮箱未填',
              ]}
              note="公共屏上打码显示，导出的简历里是完整的"
            />
            </>
          )}

          {step === 1 && (
            <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="目标岗位" required>
                <input className={inputCls} placeholder="如 前端开发工程师" value={intention.position} onChange={(e) => setIntention((v) => ({ ...v, position: e.target.value }))} />
              </Field>
              <Field label="意向城市">
                <input className={inputCls} value={intention.city} onChange={(e) => setIntention((v) => ({ ...v, city: e.target.value }))} />
              </Field>
              <Field label="工作类型">
                <select className={inputCls} value={intention.jobType} onChange={(e) => setIntention((v) => ({ ...v, jobType: e.target.value }))}>
                  <option value="">不填写</option>
                  <option value="全职">全职</option>
                  <option value="实习">实习</option>
                  <option value="兼职">兼职</option>
                </select>
              </Field>
              <Field label="期望薪资">
                <input className={inputCls} placeholder="如 8k-12k(可不填)" value={intention.salary} onChange={(e) => setIntention((v) => ({ ...v, salary: e.target.value }))} />
              </Field>
            </div>
            <ResumeStepPreview
              kicker="简历顶部会这样显示"
              title={intention.position.trim() || '必填'}
              need={!intention.position.trim()}
              lines={[
                [intention.city.trim() || '意向城市未填', intention.salary.trim() || '期望薪资未填'].join(' · '),
                `工作类型：${intention.jobType.trim() || '不填写'}`,
              ]}
            />
            </>
          )}

          {step === 2 && (
            <>
            <EntryList
              items={education}
              maxItems={6}
              addLabel="添加一段教育经历"
              emptyHint="暂未填写教育经历(可跳过,生成后会提示补充)"
              onAdd={() => setEducation((list) => [...list, { ...EMPTY_EDU }])}
              onRemove={(i) => setEducation((list) => list.filter((_, idx) => idx !== i))}
              renderItem={(e, i) => (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="学校" required>
                    <input className={inputCls} value={e.school} onChange={(ev) => setEducation((list) => list.map((x, idx) => idx === i ? { ...x, school: ev.target.value } : x))} />
                  </Field>
                  <Field label="专业">
                    <input className={inputCls} value={e.major ?? ''} onChange={(ev) => setEducation((list) => list.map((x, idx) => idx === i ? { ...x, major: ev.target.value } : x))} />
                  </Field>
                  <Field label="学历">
                    <select className={inputCls} value={e.degree ?? ''} onChange={(ev) => setEducation((list) => list.map((x, idx) => idx === i ? { ...x, degree: ev.target.value } : x))}>
                      <option value="">不填写</option>
                      {EDUCATION_LEVEL_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </Field>
                  <Field label="起止时间">
                    <input className={inputCls} placeholder="如 2021.09 - 2025.06" value={e.period ?? ''} onChange={(ev) => setEducation((list) => list.map((x, idx) => idx === i ? { ...x, period: ev.target.value } : x))} />
                  </Field>
                  <div className="md:col-span-2">
                    <Field label="在校情况(选填,AI 会帮你润色)">
                      <textarea className={`${inputCls} h-20 resize-none`} placeholder="如 主修课程、成绩排名、获奖情况" value={e.description ?? ''} onChange={(ev) => setEducation((list) => list.map((x, idx) => idx === i ? { ...x, description: ev.target.value } : x))} />
                      <div className="mt-2 flex justify-end">
                        <ResumeVoiceInputButton
                          label="在校情况"
                          className="qx-rd-voice"
                          disabled={generating}
                          onConfirm={(text) => setEducation((list) => list.map((x, idx) => idx === i ? { ...x, description: appendVoiceText(x.description, text) } : x))}
                        />
                      </div>
                    </Field>
                  </div>
                </div>
              )}
            />
            <ResumeStepPreview
              kicker="这一步已经填上的"
              title={education.find((item) => item.school.trim())?.school.trim() || '教育经历还没填'}
              need={!education.some((item) => item.school.trim())}
              lines={education.some((item) => item.school.trim() || (item.major ?? '').trim())
                ? education.map((item) => [item.school.trim(), (item.major ?? '').trim(), (item.degree ?? '').trim()].filter(Boolean).join(' · ') || '这一段还空着')
                : ['可以先跳过，生成后会提示补充']}
            />
            </>
          )}

          {step === 3 && (
            <>
            <EntryList
              items={experience}
              maxItems={8}
              addLabel="添加一段实习 / 工作经历"
              emptyHint="暂未填写经历(可跳过,生成后会提示补充)"
              onAdd={() => setExperience((list) => [...list, { ...EMPTY_EXP }])}
              onRemove={(i) => setExperience((list) => list.filter((_, idx) => idx !== i))}
              renderItem={(e, i) => (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="公司 / 单位" required>
                    <input className={inputCls} value={e.company} onChange={(ev) => setExperience((list) => list.map((x, idx) => idx === i ? { ...x, company: ev.target.value } : x))} />
                  </Field>
                  <Field label="职位" required>
                    <input className={inputCls} value={e.role} onChange={(ev) => setExperience((list) => list.map((x, idx) => idx === i ? { ...x, role: ev.target.value } : x))} />
                  </Field>
                  <div className="md:col-span-2">
                    <Field label="起止时间">
                      <input className={inputCls} placeholder="如 2024.07 - 2025.03" value={e.period ?? ''} onChange={(ev) => setExperience((list) => list.map((x, idx) => idx === i ? { ...x, period: ev.target.value } : x))} />
                    </Field>
                  </div>
                  <div className="md:col-span-2">
                    <Field label="做了什么(写真实内容,AI 会帮你润色)">
                      <textarea className={`${inputCls} h-24 resize-none`} placeholder="如 负责的工作内容、用到的工具、取得的成果(有数字写数字)" value={e.description} onChange={(ev) => setExperience((list) => list.map((x, idx) => idx === i ? { ...x, description: ev.target.value } : x))} />
                      <div className="mt-2 flex justify-end">
                        <ResumeVoiceInputButton
                          label="工作内容"
                          className="qx-rd-voice"
                          disabled={generating}
                          onConfirm={(text) => setExperience((list) => list.map((x, idx) => idx === i ? { ...x, description: appendVoiceText(x.description, text) } : x))}
                        />
                      </div>
                    </Field>
                  </div>
                </div>
              )}
            />
            <ResumeStepPreview
              kicker="这一步已经填上的"
              title={experience.find((item) => item.company.trim())?.company.trim() || '工作经历还没填'}
              need={!experience.some((item) => item.company.trim())}
              lines={experience.some((item) => item.company.trim() || item.role.trim())
                ? experience.map((item) => [item.company.trim(), item.role.trim(), (item.period ?? '').trim()].filter(Boolean).join(' · ') || '这一段还空着')
                : ['可以先跳过，生成后会提示补充']}
            />
            </>
          )}

          {step === 4 && (
            <>
            <EntryList
              items={projects}
              maxItems={6}
              addLabel="添加一个项目经历"
              emptyHint="项目经历为选填,没有可直接下一步"
              onAdd={() => setProjects((list) => [...list, { ...EMPTY_PROJ }])}
              onRemove={(i) => setProjects((list) => list.filter((_, idx) => idx !== i))}
              renderItem={(p, i) => (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="项目名称" required>
                    <input className={inputCls} value={p.name} onChange={(ev) => setProjects((list) => list.map((x, idx) => idx === i ? { ...x, name: ev.target.value } : x))} />
                  </Field>
                  <Field label="担任角色">
                    <input className={inputCls} value={p.role ?? ''} onChange={(ev) => setProjects((list) => list.map((x, idx) => idx === i ? { ...x, role: ev.target.value } : x))} />
                  </Field>
                  <div className="md:col-span-2">
                    <Field label="项目内容(写真实内容,AI 会帮你润色)">
                      <textarea className={`${inputCls} h-24 resize-none`} value={p.description} onChange={(ev) => setProjects((list) => list.map((x, idx) => idx === i ? { ...x, description: ev.target.value } : x))} />
                      <div className="mt-2 flex justify-end">
                        <ResumeVoiceInputButton
                          label="项目内容"
                          className="qx-rd-voice"
                          disabled={generating}
                          onConfirm={(text) => setProjects((list) => list.map((x, idx) => idx === i ? { ...x, description: appendVoiceText(x.description, text) } : x))}
                        />
                      </div>
                    </Field>
                  </div>
                </div>
              )}
            />
            <ResumeStepPreview
              kicker="这一步已经填上的"
              title={projects.find((item) => item.name.trim())?.name.trim() || '项目经历还没填'}
              need={!projects.some((item) => item.name.trim())}
              lines={projects.some((item) => item.name.trim() || (item.role ?? '').trim())
                ? projects.map((item) => [item.name.trim(), (item.role ?? '').trim()].filter(Boolean).join(' · ') || '这一段还空着')
                : ['项目经历可以不填，没有就直接下一步']}
            />
            </>
          )}

          {step === 5 && (
            <>
            <div className="space-y-4">
              <Field label="技能(用逗号或换行分隔)">
                <textarea className={`${inputCls} h-20 resize-none`} placeholder="如 JavaScript, Excel, 英语六级" value={skillsText} onChange={(e) => setSkillsText(e.target.value)} />
                <div className="mt-2 flex justify-end">
                  <ResumeVoiceInputButton className="qx-rd-voice" label="技能" disabled={generating} onConfirm={(text) => setSkillsText((current) => appendVoiceText(current, text))} />
                </div>
              </Field>
              <Field label="证书 / 资质(用逗号或换行分隔;只填真实持有的)">
                <textarea className={`${inputCls} h-20 resize-none`} placeholder="如 普通话二级甲等, 机动车驾驶证 C1" value={certsText} onChange={(e) => setCertsText(e.target.value)} />
                <div className="mt-2 flex justify-end">
                  <ResumeVoiceInputButton className="qx-rd-voice" label="证书资质" disabled={generating} onConfirm={(text) => setCertsText((current) => appendVoiceText(current, text))} />
                </div>
              </Field>
              <Field label="自我评价草稿(选填,AI 会基于它润色个人简介)">
                <textarea className={`${inputCls} h-24 resize-none`} value={selfIntro} onChange={(e) => setSelfIntro(e.target.value)} />
                <div className="mt-2 flex justify-end">
                  <ResumeVoiceInputButton className="qx-rd-voice" label="自我评价" disabled={generating} onConfirm={(text) => setSelfIntro((current) => appendVoiceText(current, text))} />
                </div>
              </Field>
            </div>
            <ResumeStepPreview
              kicker="这一步已经填上的"
              title="技能与证书"
              lines={[
                `技能：${skillsText.trim() || '未填'}`,
                `证书：${certsText.trim() || '未填'}`,
                `自我评价：${selfIntro.trim() || '未填'}`,
              ]}
            />
            </>
          )}
            </div>
        </div>
      </div>
      )}
      {(reviewing || step === 0) && (
        <ResumeHelpLine
          lead={reviewing ? '可以慢慢核对，准备好后再点生成。' : '姓名、手机号这两项建议自己核对一遍。'}
          onHelp={() => navigate('/help')}
        />
      )}
      {!reviewing && step === 0 && !basic.name.trim() && (
        <p className="qx-rg-reason" id="resume-generate-name-reason">
          姓名还没填，填完才能进下一步。其余三项可以空着。
        </p>
      )}
      {/*
        失败态不再只剩一行红字。红字保留（它是原因），下面挂上不依赖 AI 的出路：
        内容没丢 + 可以把已填内容原样导出打印带走。AiTaskRegion 的 fallback 是
        必填 prop，由类型系统保证这条支线不会在后续改动里被悄悄摘掉。
      */}
      {error && (
        <p className="qx-rd-error" role="alert">{error}</p>
      )}
      <AiTaskRegion
        className="resume-generate-fallback"
        task={aiTask}
        label="AI 简历润色成文"
        fallback={fallback}
      />
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
    </ResumeTouchFrame>
  )
}
