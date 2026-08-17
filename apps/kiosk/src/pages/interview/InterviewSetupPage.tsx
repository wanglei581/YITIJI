// ============================================================
// 模拟面试 — 场景设置（2C）。
//
// 触控优先：纵向编排岗位行业、面试官难度与其他配置，底部固定主操作。
// 合规：仅供本人练习参考，不代表任何招聘结果承诺。
// ============================================================

import { useRef, useState, type ChangeEvent, type ElementType, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AiDriverBanner } from '../../components/AiDriverBanner'
import { KioskFilterPickerModal } from '../../components/KioskFilterPickerModal'
import { Button, Card, ComplianceBanner, KioskPageHeader } from '@ai-job-print/ui'
import {
  DEFAULT_EMPLOYMENT_INDUSTRY,
  EMPLOYMENT_INDUSTRY_SECTORS,
  type CreateInterviewInput,
  type InterviewDifficulty,
  type InterviewDuration,
  type InterviewExperience,
  type InterviewerType,
} from '@ai-job-print/shared'
import {
  BriefcaseIcon,
  ClockIcon,
  FileTextIcon,
  GraduationCapIcon,
  ListFilterIcon,
  Loader2Icon,
  NotebookPenIcon,
  UserRoundCheckIcon,
  XIcon,
} from 'lucide-react'
import { makePrintParams } from '@ai-job-print/shared'
import {
  AiTaskRegion,
  useAiTask,
  aiErrorMessageOf,
  isAiOutage,
  type AiAvailability,
  type AiTaskFallback,
} from '../../ai'
import { createInterview, printInterviewPracticeSheet, startInterview } from '../../services/api/interview'
import { kioskUploadFile } from '../../services/api/files'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { InterviewShell } from './InterviewShell'
import './interview-service-desk.css'

const INTERVIEWERS: Array<{ key: InterviewerType; label: string; desc: string }> = [
  { key: 'hr', label: 'HR 初筛', desc: '自我介绍 · 求职动机 · 稳定性 · 薪资沟通' },
  { key: 'manager', label: '业务主管', desc: '过往经历 · 岗位理解 · 协作与执行' },
  { key: 'tech', label: '技术面试官', desc: '专业技能 · 项目细节 · 问题解决' },
  { key: 'campus', label: '校招面试官', desc: '校园经历 · 学习能力 · 职业规划' },
  { key: 'final', label: '终面负责人', desc: '价值观 · 长期发展 · 综合判断' },
]

const POPULAR_INDUSTRY_CODES = new Set(['I', 'C', 'P', 'Q', 'J', 'S'])
const POPULAR_INDUSTRIES = EMPLOYMENT_INDUSTRY_SECTORS
  .filter((item) => POPULAR_INDUSTRY_CODES.has(item.code))
  .map<string>((item) => item.label)

const EXPERIENCES: Array<{ key: InterviewExperience; label: string }> = [
  { key: 'fresh', label: '应届生' },
  { key: 'lt1', label: '1 年以内' },
  { key: 'y1_3', label: '1-3 年' },
  { key: 'y3_5', label: '3-5 年' },
  { key: 'gt5', label: '5 年以上' },
  { key: 'switch', label: '转行求职' },
]

const DIFFICULTIES: Array<{ key: InterviewDifficulty; label: string; desc: string }> = [
  { key: 'easy', label: '轻松练习', desc: '适合第一次练习，问题更基础' },
  { key: 'standard', label: '标准面试', desc: '接近真实面试节奏' },
  { key: 'pressure', label: '压力面试', desc: '更多追问与细节验证' },
]

const DURATIONS: Array<{ key: InterviewDuration; label: string; desc: string }> = [
  { key: 3, label: '3 分钟', desc: '快速练习 · 约 3-4 题' },
  { key: 5, label: '5 分钟', desc: '标准练习 · 约 4-6 题' },
  { key: 8, label: '8 分钟', desc: '深度练习 · 约 6-8 题' },
]

const POSITION_EXAMPLES = ['前端开发工程师', '行政专员', '市场运营', '机械工程师', '会计', '销售代表']

function OptionButton({ active, onClick, children, className = '' }: { active: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'interview-option min-h-[52px] rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors',
        active ? 'border-primary-500 bg-primary-50 text-primary-700 shadow-sm' : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function SectionTitle({ icon: Icon, title, desc }: { icon: ElementType; title: string; desc?: string }) {
  return (
    <div className="interview-section-title mb-4 flex items-start gap-4">
      {/* icon box — CSS (.interview-section-title svg) 已处理 56px/plum 配色，不加 text-* 避免冲突 */}
      <Icon aria-hidden="true" />
      <div>
        <h2 className="font-semibold">{title}</h2>
        {desc && <p className="mt-1">{desc}</p>}
      </div>
    </div>
  )
}

export function InterviewSetupPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [interviewerType, setInterviewerType] = useState<InterviewerType>('hr')
  const [industry, setIndustry] = useState(DEFAULT_EMPLOYMENT_INDUSTRY)
  const [showIndustryPicker, setShowIndustryPicker] = useState(false)
  const [position, setPosition] = useState('')
  const [experience, setExperience] = useState<InterviewExperience>('fresh')
  const [difficulty, setDifficulty] = useState<InterviewDifficulty>('standard')
  const [duration, setDuration] = useState<InterviewDuration>(5)
  const [resumeFile, setResumeFile] = useState<{ fileId: string; name: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * `POST /mock-interviews` 建会话时**不调模型**（写一行配置就返回），
   * 真正调 LLM 的是紧随其后的 `/start`。所以 start 503 之后这个 sessionId 仍然有效 ——
   * 它是通用题目单唯一的落点（题目单端点要凭它做归属校验并取本场配置）。
   */
  const [pendingSession, setPendingSession] = useState<{ sessionId: string; accessToken?: string } | null>(null)
  /** AI 能力级不可用的真实原因；null 表示未观测到不可用。 */
  const [aiOutage, setAiOutage] = useState<string | null>(null)
  /** 已完成过一次真实往返 —— 没探到之前一律 fail-closed（aiOutage.ts 口径）。 */
  const [probed, setProbed] = useState(false)
  /** 通用题目单生成中（不经过模型，只是服务端排版 + 上传）。 */
  const [printingSheet, setPrintingSheet] = useState(false)
  /**
   * 「进面试间」这一步真的失败过。
   *
   * 不能直接用 `error` 判：本页的 `error` 也承载「请先填写目标岗位」这类**表单校验**提示，
   * 拿它去点亮 ai-down 降级区，等于把用户少填一个字说成 AI 挂了 —— 那是另一种伪造。
   */
  const [startFailed, setStartFailed] = useState(false)

  useBusyLock(creating || uploading || printingSheet)

  const positionReady = position.trim().length > 0
  const visibleIndustries = POPULAR_INDUSTRIES.includes(industry)
    ? POPULAR_INDUSTRIES
    : [...POPULAR_INDUSTRIES.slice(0, 5), industry]

  const handleFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const uploaded = await kioskUploadFile(file, 'resume_upload', getToken())
      setResumeFile({ fileId: uploaded.fileId, name: uploaded.filename })
    } catch (err) {
      setError(err instanceof Error ? err.message : '简历上传失败，请重试')
    } finally {
      setUploading(false)
    }
  }

  const handleStart = async () => {
    const pos = position.trim()
    if (!pos) {
      setError('请先填写目标岗位，例如：前端开发工程师、行政专员')
      return
    }
    setCreating(true)
    setError(null)
    setAiOutage(null)
    setStartFailed(false)
    try {
      const input: CreateInterviewInput = {
        interviewerType,
        industry,
        position: pos,
        experience,
        difficulty,
        durationMin: duration,
        ...(resumeFile ? { resumeFileId: resumeFile.fileId } : {}),
      }
      const token = getToken()
      const created = await createInterview(input, { token })
      // 先记下来再 start：start 一旦 503，这个 sessionId 就是通用题目单的落点。
      setPendingSession({ sessionId: created.sessionId, accessToken: created.accessToken })
      const first = await startInterview(created.sessionId, { token, accessToken: created.accessToken })
      setProbed(true)
      navigate('/interview/session', {
        state: {
          sessionId: created.sessionId,
          accessToken: created.accessToken,
          questionTarget: created.questionTarget,
          durationMin: duration,
          interviewerType,
          position: pos,
          firstQuestion: first.question,
          // 不传 firstQType：会话页读的是 firstQuestion / questionTarget 等键，
          // 从未读过 qType。类型里声明过不等于有人消费。
        },
      })
    } catch (err) {
      const message = aiErrorMessageOf(err, '创建练习失败，请稍后重试')
      setError(message)
      setStartFailed(true)
      // 只有能力级故障才判成「AI 不可用」；限流 / 参数错误只是本次失败，保留重试入口。
      if (isAiOutage(err)) setAiOutage(message)
      else setProbed(true)
    } finally {
      setCreating(false)
    }
  }

  /**
   * 通用题目与答案单：AI 挂掉时唯一不经过模型的出纸路径。
   *
   * 为什么不是「重试 start」：`/start` 第一步就调 LLM 出题
   * （`mock-interview.service.ts` 的 `start` → `llm.nextQuestion`），模型不可用时
   * 会话永远停在 configured，既没有 turn 也没有报告 —— `/report/print` 只会 404。
   *
   * 口径来源：docs/design/kiosk-ai-os-v3-2026-08/20-interview-pod.html 的 ai-down 支线
   * （:497「AI 不可用 · 只能用通用题库」/ :1137「生成题目与答案单」/ :1894「本单不含点评」）。
   */
  const handlePracticeSheet = async () => {
    if (!pendingSession || printingSheet) return
    setPrintingSheet(true)
    setError(null)
    try {
      const file = await printInterviewPracticeSheet(pendingSession.sessionId, {
        token: getToken(),
        accessToken: pendingSession.accessToken,
      })
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
      setError(aiErrorMessageOf(err, '题目单生成失败，请稍后重试'))
    } finally {
      setPrintingSheet(false)
    }
  }

  /**
   * 降级处置用 `blocked`：AI 面试官是这条能力的唯一产出源，页面上有明确的入口按钮。
   * 刻意**不用** `manual` —— 通用题目单不是模拟面试的等价替代（没有追问、没有点评），
   * 套 manual 等于宣称有一条等价手动路径，那是伪造能力（CLAUDE.md §9）。
   * 它作为 `stillAvailable` 如实写明，并挂成真正可点的动作。
   */
  const availability: AiAvailability = aiOutage ? 'unavailable' : probed ? 'available' : 'unknown'
  const aiTask = useAiTask({
    availability,
    pending: creating,
    failed: startFailed || Boolean(aiOutage),
    hasResult: false,
  })
  const STILL_AVAILABLE = pendingSession
    ? '题目本身不依赖 AI：本机有一份写死的通用题库，可以按你选的面试官身份印一张「题目与答案单」带走，用笔作答。'
      + '这张单子不含任何点评、评分或通过率 —— 点评依赖 AI，本次没有，也不会拿通用建议冒充。'
    : '本次连练习会话都没建起来，因此印不出按本场配置取题的题目单。面试准备要点是本机固定内容，不依赖 AI，现在照常可看。'
  const sheetAction = pendingSession
    ? {
        action: {
          label: printingSheet ? '正在生成题目单…' : '打印通用题目与答案单',
          onClick: () => void handlePracticeSheet(),
        },
      }
    : {}
  const fallback: AiTaskFallback = aiOutage
    ? {
        // 能力级不可用：底部「开始模拟面试」这次按了也没用，置灰它并写清原因。
        mode: 'blocked',
        reason: aiOutage,
        blockedActionLabel: '开始模拟面试（AI 面试官）',
        stillAvailable: STILL_AVAILABLE,
        ...sheetAction,
      }
    : {
        // 这一次失败但服务是通的（限流 / 参数等）：**不是**能力不可用。
        // 用 blocked 会和底部仍可点的「开始模拟面试」自相矛盾。
        mode: 'result-unavailable',
        reason: (startFailed ? error : null) ?? '本次没能进入 AI 面试间。',
        retryHint: `这不是你的操作问题，AI 服务本身是通的。可以直接再点一次「开始模拟面试」；不想等的话，${STILL_AVAILABLE}`,
        ...sheetAction,
      }

  return (
    <InterviewShell>
    <KioskFilterPickerModal
      open={showIndustryPicker}
      title="选择面试行业"
      description="覆盖 GB/T 4754-2017 的 20 个行业门类；用于调整模拟题目方向。"
      sections={[{
        id: 'industry',
        label: '行业门类',
        value: industry,
        allLabel: '全部行业',
        allowEmpty: false,
        options: EMPLOYMENT_INDUSTRY_SECTORS.map((item) => ({ value: item.label, label: item.label })),
      }]}
      onChange={(_, value) => setIndustry(value)}
      onClear={() => setIndustry(DEFAULT_EMPLOYMENT_INDUSTRY)}
      onClose={() => setShowIndustryPicker(false)}
    />
    <main data-kiosk-domain="interview" data-kiosk-screen="interview-setup" className="interview-flow interview-setup" data-visual-theme="service-desk" data-ux-density="touch">
      <KioskPageHeader
        className="interview-pagehead"
        title="模拟面试"
        description="模拟练习，仅供参考 · 配置本次练习场景，进入 AI 面试间"
        aside={
          <Button size="sm" variant="secondary" className="min-h-12" onClick={() => navigate('/')}>返回</Button>
        }
      />

      <AiDriverBanner feature="AI模拟面试反馈" description="面试后即时给出评分与改进建议" />

      <div className="interview-flow__scroll min-h-0 flex-1 overflow-y-auto pb-28">
        <ComplianceBanner tone="info">
          本功能仅供本人面试练习与准备参考，不代表任何招聘结果承诺，不参与企业筛选、面试邀约或录用决策。
        </ComplianceBanner>

        <div className="interview-setup__stack mt-4">
            <Card className="interview-card interview-setup__job p-5">
              <SectionTitle icon={BriefcaseIcon} title="岗位与行业" desc="先确定目标岗位，后续题目会围绕这个方向展开。" />
              <div className="flex flex-wrap gap-2">
                {visibleIndustries.map((name) => (
                  <OptionButton key={name} active={industry === name} onClick={() => setIndustry(name)}>{name}</OptionButton>
                ))}
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => setShowIndustryPicker(true)}
                  className="interview-option inline-flex min-h-[52px] items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 hover:border-neutral-300"
                >
                  <ListFilterIcon className="h-4 w-4" aria-hidden="true" />
                  选择行业 ({EMPLOYMENT_INDUSTRY_SECTORS.length})
                </button>
              </div>
              <input
                value={position}
                onChange={(e) => {
                  setPosition(e.target.value)
                  if (error?.includes('目标岗位')) setError(null)
                }}
                maxLength={50}
                placeholder="输入目标岗位，如：前端开发工程师"
                className={[
                  'mt-4 min-h-[56px] w-full rounded-xl border px-4 text-base focus:outline-none focus:ring-2',
                  positionReady
                    ? 'border-neutral-200 focus:border-primary-500 focus:ring-primary-100'
                    : 'border-warning/30 bg-warning-bg/40 focus:border-warning focus:ring-warning-bg',
                ].join(' ')}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {POSITION_EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => { setPosition(example); setError(null) }}
                    className="min-h-[48px] rounded-full bg-neutral-100 px-4 text-sm text-neutral-600 hover:bg-neutral-200"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </Card>

            <Card className="interview-card interview-setup__interviewer p-5">
              <SectionTitle icon={UserRoundCheckIcon} title="面试官与难度" desc="先选择面试官身份，再选择练习压力。" />
              <div className="grid gap-2 lg:grid-cols-2">
                {INTERVIEWERS.map((it) => (
                  <OptionButton key={it.key} active={interviewerType === it.key} onClick={() => setInterviewerType(it.key)} className="text-left">
                    <span className="block font-semibold">{it.label}</span>
                    <span className="mt-0.5 block text-xs font-normal leading-relaxed text-neutral-500">{it.desc}</span>
                  </OptionButton>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {DIFFICULTIES.map((d) => (
                  <OptionButton key={d.key} active={difficulty === d.key} onClick={() => setDifficulty(d.key)} className="text-center">
                    <span className="block font-semibold">{d.label}</span>
                    <span className="mt-0.5 block text-[11px] font-normal leading-tight text-neutral-500">{d.desc}</span>
                  </OptionButton>
                ))}
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="interview-card interview-setup__experience p-5">
                <SectionTitle icon={GraduationCapIcon} title="经验" />
                <div className="grid grid-cols-3 gap-2">
                  {EXPERIENCES.map((e) => (
                    <OptionButton key={e.key} active={experience === e.key} onClick={() => setExperience(e.key)}>{e.label}</OptionButton>
                  ))}
                </div>
              </Card>

              <Card className="interview-card interview-setup__duration p-5">
                <SectionTitle icon={ClockIcon} title="时长" />
                <div className="grid grid-cols-3 gap-2">
                  {DURATIONS.map((d) => (
                    <OptionButton key={d.key} active={duration === d.key} onClick={() => setDuration(d.key)} className="text-center">
                      <span className="block font-semibold">{d.label}</span>
                      <span className="mt-0.5 block text-xs font-normal text-neutral-500">{d.desc}</span>
                    </OptionButton>
                  ))}
                </div>
              </Card>
            </div>

            <Card className="interview-card p-5">
              <SectionTitle icon={FileTextIcon} title="简历（可选）" desc="上传后面试官会结合经历提问；不上传则按通用问题练习。" />
              {resumeFile ? (
                <div className="interview-resume-chip flex items-center justify-between rounded-xl border px-4 py-3">
                  <span className="truncate text-sm font-medium">{resumeFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setResumeFile(null)}
                    aria-label="移除简历"
                    className="flex h-12 w-12 items-center justify-center rounded-xl text-neutral-400 hover:bg-white"
                  >
                    <XIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                  <Button variant="secondary" className="min-h-[56px] text-base" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                    {uploading ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : <FileTextIcon className="mr-2 h-4 w-4" aria-hidden="true" />}
                    上传简历
                  </Button>
                  <div className="flex min-h-[56px] items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-4 text-sm text-neutral-500">
                    不上传也可以开始练习
                  </div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={handleFileChosen}
              />
            </Card>
        </div>

        {error && (
          <p className="mt-4 rounded-xl bg-error-bg px-4 py-3 text-sm font-medium text-error-fg" role="alert">{error}</p>
        )}

        {/*
          失败态不再只剩「创建练习失败」一行。红字保留（它是原因），下面挂上不依赖 AI 的出路。
          AiTaskRegion 的 fallback 是必填 prop，由类型系统保证这条支线不会被悄悄摘掉。
        */}
        <AiTaskRegion
          className="interview-setup-fallback mt-4"
          task={aiTask}
          label="AI 面试官出题与点评"
          fallback={fallback}
        />

        {aiTask.isFailed && (
          <Button
            variant="secondary"
            className="mt-3 flex min-h-[56px] w-full items-center justify-center gap-2 text-base"
            onClick={() => navigate('/interview/tips')}
          >
            <NotebookPenIcon className="h-5 w-5" aria-hidden="true" />
            查看面试准备要点（本机固定内容，不依赖 AI）
          </Button>
        )}
      </div>

      <div className="interview-flow__action-bar absolute inset-x-0 bottom-0 border-t border-neutral-100 bg-white/95 px-6 py-4 backdrop-blur">
        <Button size="lg" className="h-14 w-full text-base" disabled={creating || uploading} onClick={() => void handleStart()}>
          {creating ? (
            <>
              <Loader2Icon className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
              正在为你准备面试官…
            </>
          ) : positionReady ? '开始模拟面试' : '填写目标岗位后开始'}
        </Button>
      </div>
    </main>
    </InterviewShell>
  )
}
