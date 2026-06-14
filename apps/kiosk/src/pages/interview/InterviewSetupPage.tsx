// ============================================================
// 模拟面试 — 场景设置（2C）。
//
// 布局：左侧 4 个步骤（选择面试官 / 岗位与行业 / 练习参数 / 简历），
// 右侧固定「本次练习摘要」+ 开始按钮（CTA 收在摘要卡内，无底部悬浮遮挡）。
// 适配 21.5 寸横屏（1920×1080 首屏完整），窄屏自动单列堆叠。
// 合规：仅供本人练习参考，不代表任何招聘结果承诺。
// ============================================================

import { useRef, useState, type ChangeEvent, type ElementType, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import type {
  CreateInterviewInput,
  InterviewDifficulty,
  InterviewDuration,
  InterviewExperience,
  InterviewerType,
} from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  BriefcaseIcon,
  Building2Icon,
  CheckCircle2Icon,
  ChevronRightIcon,
  ClipboardListIcon,
  ClockIcon,
  CodeIcon,
  FileTextIcon,
  GaugeIcon,
  GraduationCapIcon,
  InfoIcon,
  Loader2Icon,
  ScaleIcon,
  ShieldCheckIcon,
  UploadIcon,
  UserRoundIcon,
  XIcon,
} from 'lucide-react'
import { createInterview, startInterview } from '../../services/api/interview'
import { kioskUploadFile } from '../../services/api/files'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'

const INTERVIEWERS: Array<{ key: InterviewerType; label: string; desc: string; icon: ElementType }> = [
  { key: 'hr', label: 'HR 初筛', desc: '自我介绍 · 求职动机 · 稳定性', icon: UserRoundIcon },
  { key: 'tech', label: '技术面试官', desc: '专业技能 · 项目细节 · 问题解决', icon: CodeIcon },
  { key: 'manager', label: '业务主管', desc: '过往经历 · 岗位理解 · 协作执行', icon: BriefcaseIcon },
  { key: 'campus', label: '校招面试官', desc: '校园经历 · 学习能力 · 职业规划', icon: GraduationCapIcon },
  { key: 'final', label: '终面负责人', desc: '价值观 · 长期发展 · 综合判断', icon: ScaleIcon },
]

const INDUSTRIES = ['互联网 / AI', '制造业', '教育培训', '医疗健康', '金融服务', '政务 / 国企', '零售 / 服务业', '其他']

const EXPERIENCES: Array<{ key: InterviewExperience; label: string }> = [
  { key: 'fresh', label: '应届生' },
  { key: 'lt1', label: '1 年以内' },
  { key: 'y1_3', label: '1-3 年' },
  { key: 'y3_5', label: '3-5 年' },
  { key: 'gt5', label: '5 年以上' },
  { key: 'switch', label: '转行求职' },
]

const DIFFICULTIES: Array<{ key: InterviewDifficulty; label: string; desc: string }> = [
  { key: 'easy', label: '轻松练习', desc: '适合第一次，问题更基础' },
  { key: 'standard', label: '标准面试', desc: '接近真实面试节奏' },
  { key: 'pressure', label: '压力面试', desc: '更多追问与细节验证' },
]

const DURATIONS: Array<{ key: InterviewDuration; label: string; desc: string }> = [
  { key: 3, label: '3 分钟', desc: '快速练习 · 约 3-4 题' },
  { key: 5, label: '5 分钟', desc: '标准练习 · 约 4-6 题' },
  { key: 8, label: '8 分钟', desc: '深度练习 · 约 6-8 题' },
]

const POSITION_EXAMPLES = ['前端开发工程师', '行政专员', '市场运营', '机械工程师', '会计', '销售代表']

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

function labelOf<T extends string | number>(items: Array<{ key: T; label: string }>, key: T): string {
  return items.find((it) => it.key === key)?.label ?? String(key)
}

function StepHeader({ step, title, desc }: { step: number; title: string; desc: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="flex h-8 w-8 shrink-0 translate-y-1 items-center justify-center rounded-full bg-primary-600 text-sm font-bold text-white">
        {step}
      </span>
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <p className="text-sm text-gray-400">{desc}</p>
    </div>
  )
}

function InterviewerCard({
  active,
  icon: Icon,
  label,
  desc,
  onClick,
}: {
  active: boolean
  icon: ElementType
  label: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'relative flex min-h-[128px] flex-col items-center justify-start gap-2 rounded-xl border px-3 py-4 text-center transition-colors',
        active ? 'border-primary-500 bg-primary-50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50',
      )}
    >
      {active && <CheckCircle2Icon className="absolute right-2 top-2 h-5 w-5 text-primary-600" aria-hidden="true" />}
      <span className={cx('flex h-11 w-11 items-center justify-center rounded-full', active ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500')}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className={cx('text-sm font-semibold', active ? 'text-primary-700' : 'text-gray-900')}>{label}</span>
      <span className="text-xs leading-relaxed text-gray-500">{desc}</span>
    </button>
  )
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'min-h-[44px] rounded-full border px-4 text-sm font-medium transition-colors',
        active ? 'border-primary-500 bg-primary-50 text-primary-700 shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300',
      )}
    >
      {label}
    </button>
  )
}

function PickCard({ active, label, desc, onClick }: { active: boolean; label: string; desc?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'min-h-[60px] rounded-xl border px-4 py-3 text-left transition-colors',
        active ? 'border-primary-500 bg-primary-50 text-primary-800 shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50',
      )}
    >
      <span className="block text-sm font-semibold">{label}</span>
      {desc && <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{desc}</span>}
    </button>
  )
}

function SummaryRow({ icon: Icon, label, value, warn = false }: { icon: ElementType; label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-3 last:border-b-0">
      <span className="flex items-center gap-2 text-sm text-gray-500">
        <Icon className="h-4 w-4 text-gray-400" aria-hidden="true" />
        {label}
      </span>
      <span className={cx('max-w-[58%] truncate text-right text-sm font-semibold', warn ? 'text-orange-600' : 'text-gray-900')}>{value}</span>
    </div>
  )
}

export function InterviewSetupPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [interviewerType, setInterviewerType] = useState<InterviewerType>('hr')
  const [industry, setIndustry] = useState(INDUSTRIES[0])
  const [position, setPosition] = useState('')
  const [experience, setExperience] = useState<InterviewExperience>('fresh')
  const [difficulty, setDifficulty] = useState<InterviewDifficulty>('standard')
  const [duration, setDuration] = useState<InterviewDuration>(5)
  const [resumeFile, setResumeFile] = useState<{ fileId: string; name: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBusyLock(creating || uploading)

  const interviewerLabel = labelOf(INTERVIEWERS, interviewerType)
  const experienceLabel = labelOf(EXPERIENCES, experience)
  const difficultyLabel = labelOf(DIFFICULTIES, difficulty)
  const durationLabel = labelOf(DURATIONS, duration)
  const positionReady = position.trim().length > 0

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
      const first = await startInterview(created.sessionId, { token, accessToken: created.accessToken })
      navigate('/interview/session', {
        state: {
          sessionId: created.sessionId,
          accessToken: created.accessToken,
          questionTarget: created.questionTarget,
          durationMin: duration,
          interviewerType,
          position: pos,
          firstQuestion: first.question,
          firstQType: first.qType,
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建练习失败，请稍后重试')
    } finally {
      setCreating(false)
    }
  }

  const ctaDisabled = !positionReady || creating || uploading

  return (
    <div className="min-h-screen bg-[#f5f7fa] px-6 py-5 text-gray-950">
      <PageHeader
        title="模拟面试"
        subtitle="选择场景后进入 AI 数字人面试间"
        className="pb-3"
        actions={<Button size="sm" variant="secondary" onClick={() => navigate('/')}>返回首页</Button>}
      />

      <div className="mt-3 flex min-h-[44px] items-center gap-3 rounded-xl border border-primary-100 bg-primary-50 px-4 text-sm font-medium text-primary-700">
        <InfoIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        仅供本人练习与准备参考，不代表招聘结果，不参与企业筛选或录用决策。
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <main className="grid gap-4">
          {/* 步骤 1：选择面试官 */}
          <Card className="p-5">
            <StepHeader step={1} title="选择面试官" desc="选择不同面试官，获得针对性面试体验" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {INTERVIEWERS.map((it) => (
                <InterviewerCard
                  key={it.key}
                  active={interviewerType === it.key}
                  icon={it.icon}
                  label={it.label}
                  desc={it.desc}
                  onClick={() => setInterviewerType(it.key)}
                />
              ))}
            </div>
          </Card>

          {/* 步骤 2：岗位与行业（必填） */}
          <Card className={cx('p-5', !positionReady && 'border-orange-200')}>
            <StepHeader step={2} title="岗位与行业" desc="选择行业并填写目标岗位（必填）" />
            <div className="flex flex-wrap gap-2">
              {INDUSTRIES.map((name) => (
                <Chip key={name} active={industry === name} label={name} onClick={() => setIndustry(name)} />
              ))}
            </div>
            <label htmlFor="interview-position" className="mb-2 mt-5 block text-sm font-semibold text-gray-800">
              目标岗位 <span className="text-orange-600">*</span>
            </label>
            <input
              id="interview-position"
              value={position}
              onChange={(e) => {
                setPosition(e.target.value)
                if (error?.includes('目标岗位')) setError(null)
              }}
              maxLength={50}
              placeholder="请输入目标岗位，如：前端开发工程师"
              className={cx(
                'min-h-[56px] w-full rounded-xl border px-4 text-base outline-none transition-colors focus:ring-2',
                positionReady
                  ? 'border-gray-200 bg-white focus:border-primary-500 focus:ring-primary-100'
                  : 'border-orange-200 bg-orange-50/50 focus:border-orange-400 focus:ring-orange-100',
              )}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-400">热门岗位（可点击填入）</span>
              {POSITION_EXAMPLES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => { setPosition(p); setError(null) }}
                  className="min-h-[44px] rounded-full bg-gray-100 px-4 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200"
                >
                  {p}
                </button>
              ))}
            </div>
          </Card>

          {/* 步骤 3：练习参数 */}
          <Card className="p-5">
            <StepHeader step={3} title="练习参数" desc="设置练习的经验、难度与时长" />
            <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr_1fr]">
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-800">经验</p>
                <div className="grid grid-cols-2 gap-2">
                  {EXPERIENCES.map((e) => (
                    <Chip key={e.key} active={experience === e.key} label={e.label} onClick={() => setExperience(e.key)} />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-800">难度</p>
                <div className="grid gap-2">
                  {DIFFICULTIES.map((d) => (
                    <PickCard key={d.key} active={difficulty === d.key} label={d.label} desc={d.desc} onClick={() => setDifficulty(d.key)} />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-800">时长</p>
                <div className="grid gap-2">
                  {DURATIONS.map((d) => (
                    <PickCard key={d.key} active={duration === d.key} label={d.label} desc={d.desc} onClick={() => setDuration(d.key)} />
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* 步骤 4：简历（可选） */}
          <Card className="p-5">
            <StepHeader step={4} title="简历（可选）" desc="上传简历可让 AI 更了解你的背景" />
            {resumeFile ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-primary-700">
                  <FileTextIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{resumeFile.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setResumeFile(null)}
                  aria-label="移除简历"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white hover:text-gray-600"
                >
                  <XIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
                <Button variant="secondary" className="min-h-[56px] text-base" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                  {uploading
                    ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    : <UploadIcon className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {uploading ? '正在上传…' : '上传简历'}
                </Button>
                <div className="flex min-h-[56px] flex-col justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 text-sm text-gray-500">
                  <span>不上传也可以开始练习，报告仍会基于你的回答生成。</span>
                  <span className="mt-0.5 text-xs text-gray-400">支持 PDF / Word / 图片简历</span>
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
        </main>

        {/* 右侧：本次练习摘要 + 开始按钮 */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card className="overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-gray-100 p-5">
              <ClipboardListIcon className="h-5 w-5 text-primary-600" aria-hidden="true" />
              <h2 className="text-base font-semibold text-gray-900">本次练习摘要</h2>
            </div>
            <div className="p-5">
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4">
                <SummaryRow icon={UserRoundIcon} label="面试官类型" value={interviewerLabel} />
                <SummaryRow icon={Building2Icon} label="行业" value={industry} />
                <SummaryRow icon={BriefcaseIcon} label="目标岗位" value={positionReady ? position.trim() : '待填写'} warn={!positionReady} />
                <SummaryRow icon={GraduationCapIcon} label="经验" value={experienceLabel} />
                <SummaryRow icon={GaugeIcon} label="难度" value={difficultyLabel} />
                <SummaryRow icon={ClockIcon} label="时长" value={durationLabel} />
                <SummaryRow icon={FileTextIcon} label="使用简历" value={resumeFile ? resumeFile.name : '不使用简历'} />
              </div>

              {!positionReady && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-700">
                  <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  请填写目标岗位后开始模拟面试。
                </div>
              )}

              <Button size="lg" className="mt-4 h-14 w-full text-base" disabled={ctaDisabled} onClick={() => void handleStart()}>
                {creating ? (
                  <>
                    <Loader2Icon className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                    正在为你准备面试官…
                  </>
                ) : positionReady ? (
                  <>
                    开始模拟面试
                    <ChevronRightIcon className="ml-2 h-5 w-5" aria-hidden="true" />
                  </>
                ) : '填写目标岗位后开始'}
              </Button>

              {error && (
                <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</p>
              )}

              <div className="mt-4 grid gap-2 rounded-xl border border-gray-100 p-4 text-xs leading-relaxed text-gray-500">
                <div className="flex items-center gap-2 font-semibold text-gray-700">
                  <ShieldCheckIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
                  报告仅供本人复盘
                </div>
                <p>报告将基于你的问题回答、跳过记录和确认后的转写文本生成，不记录企业筛选结果，不代表录用或面试邀约。</p>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}
