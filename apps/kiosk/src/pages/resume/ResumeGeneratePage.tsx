// ============================================================
// AI 简历生成 - 引导式表单(阶段2A)
//
// 合规红线:
//   - AI 只润色用户提供的信息,不编造学历/证书/公司/项目;缺失内容提示补充,不代填。
//   - 公共一体机:表单数据只在组件内存,离开页面/进入待机即丢失;
//     生成结果走后端 AiResumeResult TTL 清理,不长期保留。
// ============================================================

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Stepper } from '@ai-job-print/ui'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import type {
  GeneratedResume,
  ResumeGenEducation,
  ResumeGenExperience,
  ResumeGenProject,
  ResumeGenerateInput,
  ResumeGenerateResponse,
} from '@ai-job-print/shared'
import { EDUCATION_LEVEL_OPTIONS, makePrintParams } from '@ai-job-print/shared'
import { AiTaskRegion, useAiTask, isAiOutage, type AiAvailability, type AiTaskFallback } from '../../ai'
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
import { ResumeVoiceInputButton } from './components/ResumeVoiceInputButton'
import './resume-generate-qx.css'

const STEPS = [
  { title: '基本信息', description: '姓名与联系方式' },
  { title: '求职意向', description: '目标岗位' },
  { title: '教育经历', description: '学校与专业' },
  { title: '工作经历', description: '实习 / 工作' },
  { title: '项目经历', description: '可选' },
  { title: '技能证书', description: '技能与自我评价' },
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
        <p className="rounded-xl bg-neutral-50 py-6 text-center text-sm text-neutral-400">{emptyHint}</p>
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
  const { getToken } = useAuth()
  const consent = useResumeAiConsent()
  const [showConsent, setShowConsent] = useState(false)
  const [step, setStep] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** AI 能力级不可用的**真实原因**（原样透出后端 message）；null 表示未观测到不可用。 */
  const [aiOutage, setAiOutage] = useState<string | null>(null)
  /** 已完成过一次真实往返 —— 没探到之前一律 fail-closed（aiOutage.ts 的口径）。 */
  const [probed, setProbed] = useState(false)
  /** 原样草稿导出中（不经过 AI，只是服务端排版 + 上传）。 */
  const [exportingDraft, setExportingDraft] = useState(false)

  // 表单数据只在组件内存(公共设备隐私):刷新/待机即丢失,不写任何本地存储。
  const [basic, setBasic] = useState({ name: '', phone: '', email: '', city: '' })
  const [intention, setIntention] = useState({ position: '', city: '', jobType: '', salary: '' })
  const [education, setEducation] = useState<ResumeGenEducation[]>([{ ...EMPTY_EDU }])
  const [experience, setExperience] = useState<ResumeGenExperience[]>([{ ...EMPTY_EXP }])
  const [projects, setProjects] = useState<ResumeGenProject[]>([])
  const [skillsText, setSkillsText] = useState('')
  const [certsText, setCertsText] = useState('')
  const [selfIntro, setSelfIntro] = useState('')

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
      // 拿到结构化响应就算一次真实往返 —— 即便 status 是 failed，服务本身是通的。
      setProbed(true)
      if (result.status !== 'completed' || !result.resume) {
        setError(result.failReason ?? 'AI 简历生成失败，请稍后重试')
        return
      }
      // 只传 result：预览页的 LocationState 虽然声明了 input，但从未解引用过。
      navigate('/resume/generate/preview', { state: { result } })
    } catch (err) {
      const message = userMessageOf(err, 'AI 简历生成失败，请稍后重试')
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
      navigate('/print/confirm', {
        state: {
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
          params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
        },
      })
    } catch (err) {
      setError(userMessageOf(err, '草稿导出失败，请稍后重试'))
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
  const fallback: AiTaskFallback = aiOutage
    ? {
        // 能力级不可用：底部「生成我的简历」这次按了也没用，置灰它并写清原因。
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
        retryHint: `这不是你的操作问题，AI 服务本身是通的。可以直接再点一次「生成我的简历」；不想等的话，${STILL_AVAILABLE}`,
        action: draftAction,
      }

  const stepIcon = [UserRoundIcon, BriefcaseIcon, GraduationCapIcon, BriefcaseIcon, FolderGitIcon, WrenchIcon][step]
  const StepIcon = stepIcon

  const ctabar = (
    <>
      <button
        type="button"
        className="qx-btn"
        data-variant="ghost"
        disabled={generating}
        onClick={() => (step === 0 ? navigate('/resume/source') : setStep((s) => s - 1))}
      >
        {step === 0 ? '返回' : '上一步'}
      </button>
      {step < STEPS.length - 1 ? (
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          disabled={!canNext}
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
          onClick={() => void handleGenerate()}
        >
          <SparklesIcon className="h-5 w-5" />
          {generating ? 'AI 生成中…' : '生成我的简历'}
        </button>
      )}
    </>
  )

  return (
    <QxPageFrame
      title="AI 简历生成"
      subtitle="填写你的真实信息，AI 帮你润色成一份结构化简历"
      back={{ label: '返回简历服务', onBack: () => navigate('/resume/source') }}
      navbar={<QxAppNavbar onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />}
      ctabar={ctabar}
    >
    <section data-kiosk-domain="resume" data-kiosk-screen="resume-generate" className="qx-resume-generate">
      <div className="qx-rd-work">
        <div className="qx-rd-steps">
          <Stepper steps={[...STEPS]} currentIndex={step} />
        </div>
        <div className="qx-rd-main">
            <div className="qx-card">
              <div className="qx-rd-heading">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
                  <StepIcon className="h-5 w-5 text-primary-600" aria-hidden="true" />
                </span>
                <b>{STEPS[step].title}</b>
              </div>

          {step === 0 && (
            <>
            {/*
              这一步在说什么（2026-09-09 第 5 条并排比对补齐）：
              设计稿 24-resume-generate 的 input-basic 态，正文之外还有一张说明卡、
              两张「为什么要填」卡和一条底部自查行；正是它们把 1080×1920 竖屏填满。
              删掉稿里没有的右侧「填写进度」面板之后，这些必须补上，否则下半屏是空的。
            */}
            <div className="qx-rd-lead">
              <b>先留下能联系上你的方式</b>
              <p>这一步只有<em>姓名必填</em>，其余三项可以空着，生成后会提示你回来补。</p>
            </div>
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
            <div className="qx-rd-notes">
              <div className="qx-card">
                <b>这几项印在最上面</b>
                <p>姓名和联系方式是对方找到你的唯一入口。写错一个数字，后面全白做 —— 这一栏值得你自己核一遍。</p>
              </div>
              <div className="qx-card">
                <b>除了姓名都能空着</b>
                <p>城市、手机号、邮箱空着也能往下走。空着的话，生成之后会算一条提示让你回来补，AI 不会替你编一个。</p>
              </div>
            </div>
            <p className="qx-rd-selfcheck">
              姓名、手机号这两项建议自己核对一遍，简历印出来就是这个。需要帮忙可以找现场工作人员，或问 AI 顾问。
            </p>
            </>
          )}

          {step === 1 && (
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
          )}

          {step === 2 && (
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
                          disabled={generating}
                          onConfirm={(text) => setEducation((list) => list.map((x, idx) => idx === i ? { ...x, description: appendVoiceText(x.description, text) } : x))}
                        />
                      </div>
                    </Field>
                  </div>
                </div>
              )}
            />
          )}

          {step === 3 && (
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
                          disabled={generating}
                          onConfirm={(text) => setExperience((list) => list.map((x, idx) => idx === i ? { ...x, description: appendVoiceText(x.description, text) } : x))}
                        />
                      </div>
                    </Field>
                  </div>
                </div>
              )}
            />
          )}

          {step === 4 && (
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
                          disabled={generating}
                          onConfirm={(text) => setProjects((list) => list.map((x, idx) => idx === i ? { ...x, description: appendVoiceText(x.description, text) } : x))}
                        />
                      </div>
                    </Field>
                  </div>
                </div>
              )}
            />
          )}

          {step === 5 && (
            <div className="space-y-4">
              <Field label="技能(用逗号或换行分隔)">
                <textarea className={`${inputCls} h-20 resize-none`} placeholder="如 JavaScript, Excel, 英语六级" value={skillsText} onChange={(e) => setSkillsText(e.target.value)} />
                <div className="mt-2 flex justify-end">
                  <ResumeVoiceInputButton label="技能" disabled={generating} onConfirm={(text) => setSkillsText((current) => appendVoiceText(current, text))} />
                </div>
              </Field>
              <Field label="证书 / 资质(用逗号或换行分隔;只填真实持有的)">
                <textarea className={`${inputCls} h-20 resize-none`} placeholder="如 普通话二级甲等, 机动车驾驶证 C1" value={certsText} onChange={(e) => setCertsText(e.target.value)} />
                <div className="mt-2 flex justify-end">
                  <ResumeVoiceInputButton label="证书资质" disabled={generating} onConfirm={(text) => setCertsText((current) => appendVoiceText(current, text))} />
                </div>
              </Field>
              <Field label="自我评价草稿(选填,AI 会基于它润色个人简介)">
                <textarea className={`${inputCls} h-24 resize-none`} value={selfIntro} onChange={(e) => setSelfIntro(e.target.value)} />
                <div className="mt-2 flex justify-end">
                  <ResumeVoiceInputButton label="自我评价" disabled={generating} onConfirm={(text) => setSelfIntro((current) => appendVoiceText(current, text))} />
                </div>
              </Field>
            </div>
          )}
            </div>

            {/*
              失败态不再只剩一行红字。红字保留（它是原因），下面挂上不依赖 AI 的出路：
              内容没丢 + 可以把已填内容原样导出打印带走。AiTaskRegion 的 fallback 是
              必填 prop，由类型系统保证这条支线不会在后续改动里被悄悄摘掉。
            */}
            {error && (
              <p className="qx-rd-error" role="alert">{error}</p>
            )}
            <AiTaskRegion
              className="resume-generate-fallback mt-3"
              task={aiTask}
              label="AI 简历润色成文"
              fallback={fallback}
            />
        </div>
      </div>
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
