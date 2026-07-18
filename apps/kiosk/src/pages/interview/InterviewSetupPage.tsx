// ============================================================
// 模拟面试 — 场景设置（2C）。
//
// 触控优先：左侧配置、右侧摘要，底部固定主操作。
// 合规：仅供本人练习参考，不代表任何招聘结果承诺。
// ============================================================

import { useRef, useState, type ChangeEvent, type ElementType, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
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
  CheckCircle2Icon,
  ClockIcon,
  FileTextIcon,
  GraduationCapIcon,
  Loader2Icon,
  UserRoundCheckIcon,
  XIcon,
} from 'lucide-react'
import { createInterview, startInterview } from '../../services/api/interview'
import { kioskUploadFile } from '../../services/api/files'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { InterviewTopbar } from './InterviewTopbar'
import './interview-service-desk.css'

const INTERVIEWERS: Array<{ key: InterviewerType; label: string; desc: string }> = [
  { key: 'hr', label: 'HR 初筛', desc: '自我介绍 · 求职动机 · 稳定性 · 薪资沟通' },
  { key: 'manager', label: '业务主管', desc: '过往经历 · 岗位理解 · 协作与执行' },
  { key: 'tech', label: '技术面试官', desc: '专业技能 · 项目细节 · 问题解决' },
  { key: 'campus', label: '校招面试官', desc: '校园经历 · 学习能力 · 职业规划' },
  { key: 'final', label: '终面负责人', desc: '价值观 · 长期发展 · 综合判断' },
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

function labelOf<T extends string | number>(items: Array<{ key: T; label: string }>, key: T): string {
  return items.find((it) => it.key === key)?.label ?? String(key)
}

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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="interview-summary-row flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <span className="shrink-0">{label}</span>
      <span className="max-w-[13rem] text-right font-semibold">{value}</span>
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

  return (
    <div className="interview-flow interview-setup" data-visual-theme="service-desk" data-ux-density="touch">
      <InterviewTopbar />
      <PageHeader
        className="interview-pagehead"
        title="模拟面试"
        subtitle="模拟练习，仅供参考 · 配置本次练习场景，进入 AI 面试间"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>返回</Button>
        }
      />

      <div className="interview-flow__scroll min-h-0 flex-1 overflow-y-auto pb-28">
        <ComplianceBanner tone="info">
          本功能仅供本人面试练习与准备参考，不代表任何招聘结果承诺，不参与企业筛选、面试邀约或录用决策。
        </ComplianceBanner>

        <div className="interview-setup__layout mt-4 grid gap-4">
          <div className="interview-setup__form space-y-4">
            <Card className="interview-card interview-setup__job p-5">
              <SectionTitle icon={BriefcaseIcon} title="岗位与行业" desc="先确定目标岗位，后续题目会围绕这个方向展开。" />
              <div className="flex flex-wrap gap-2">
                {INDUSTRIES.map((name) => (
                  <OptionButton key={name} active={industry === name} onClick={() => setIndustry(name)}>{name}</OptionButton>
                ))}
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

            <Card className="interview-card p-5">
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
                <div className="flex items-center justify-between rounded-xl border px-4 py-3"
                  style={{ borderColor: 'rgba(122,90,134,.35)', background: 'var(--interview-plum-soft, #efe7f1)' }}>
                  <span className="truncate text-sm font-medium" style={{ color: 'var(--interview-plum-deep, #63466f)' }}>{resumeFile.name}</span>
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

          <aside className="interview-setup__summary">
            <Card className="interview-card interview-card--summary p-5">
              <div className="mb-4 flex items-center gap-2">
                <CheckCircle2Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
                <h2 className="text-base font-semibold text-neutral-900">本次练习摘要</h2>
              </div>
              <div className="rounded-xl border px-4" style={{ borderColor: 'var(--interview-line, #e2dccb)', background: 'var(--interview-paper, #f4f1e8)' }}>
                <SummaryRow label="面试官类型" value={interviewerLabel} />
                <SummaryRow label="行业" value={industry} />
                <SummaryRow label="目标岗位" value={positionReady ? position.trim() : '待填写'} />
                <SummaryRow label="经验" value={experienceLabel} />
                <SummaryRow label="难度" value={difficultyLabel} />
                <SummaryRow label="时长" value={durationLabel} />
                <SummaryRow label="使用简历" value={resumeFile ? resumeFile.name : '不使用简历'} />
              </div>
              {!positionReady && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning-bg bg-warning-bg px-4 py-3 text-sm text-warning-fg">
                  <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  请填写目标岗位后开始模拟面试。
                </div>
              )}
              <div className="mt-4 rounded-xl border border-neutral-100 px-4 py-3 text-xs leading-relaxed text-neutral-500">
                报告将基于你的问题回答、跳过记录和确认后的转写文本生成，仅供本人练习复盘。
              </div>
            </Card>
          </aside>
        </div>

        {error && (
          <p className="mt-4 rounded-xl bg-error-bg px-4 py-3 text-sm font-medium text-error-fg">{error}</p>
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
    </div>
  )
}
