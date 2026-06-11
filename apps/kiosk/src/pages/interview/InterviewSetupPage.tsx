// ============================================================
// 模拟面试 — 场景设置（2C）。
//
// 触控优先：大按钮选项卡（≥48px），单屏单任务，配置完成 → 创建会话 → 进入对话页。
// 合规：页面明示「仅供本人练习参考，不代表任何招聘结果承诺」。
// 简历可选：真实上传（复用 kiosk 上传链路）或不使用；提取失败如实报错。
// ============================================================

import { useRef, useState } from 'react'
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
  BriefcaseIcon,
  ClockIcon,
  FileTextIcon,
  GaugeIcon,
  GraduationCapIcon,
  Loader2Icon,
  UserRoundCheckIcon,
  XIcon,
} from 'lucide-react'
import { createInterview, startInterview } from '../../services/api/interview'
import { kioskUploadFile } from '../../services/api/files'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'

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

function OptionButton({ active, onClick, children, className = '' }: { active: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'min-h-[48px] rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors',
        active ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function SectionTitle({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-primary-600" aria-hidden="true" />
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
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

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      setError('请填写目标岗位，例如：前端开发工程师、行政专员')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const input: CreateInterviewInput = {
        interviewerType, industry, position: pos, experience, difficulty, durationMin: duration,
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
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title="模拟面试"
        subtitle="配置练习场景，AI 面试官将进行几分钟对话式练习"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>返回首页</Button>
        }
      />

      <div className="mt-4 flex-1 overflow-y-auto pb-32">
        <ComplianceBanner tone="info">
          本功能仅供本人面试练习与准备参考，不代表任何招聘结果承诺，不参与企业筛选、面试邀约或录用决策。
        </ComplianceBanner>

        <Card className="mt-4 p-5">
          <SectionTitle icon={UserRoundCheckIcon} title="面试官类型" />
          <div className="flex flex-col gap-2">
            {INTERVIEWERS.map((it) => (
              <OptionButton key={it.key} active={interviewerType === it.key} onClick={() => setInterviewerType(it.key)} className="text-left">
                <span className="block font-semibold">{it.label}</span>
                <span className="mt-0.5 block text-xs font-normal text-gray-500">{it.desc}</span>
              </OptionButton>
            ))}
          </div>
        </Card>

        <Card className="mt-4 p-5">
          <SectionTitle icon={BriefcaseIcon} title="目标行业与岗位" />
          <div className="flex flex-wrap gap-2">
            {INDUSTRIES.map((name) => (
              <OptionButton key={name} active={industry === name} onClick={() => setIndustry(name)}>{name}</OptionButton>
            ))}
          </div>
          <input
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            maxLength={50}
            placeholder="输入目标岗位，如：前端开发工程师"
            className="mt-3 min-h-[52px] w-full rounded-xl border border-gray-200 px-4 text-base focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {POSITION_EXAMPLES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPosition(p)}
                className="min-h-[36px] rounded-full bg-gray-100 px-3 text-xs text-gray-600 hover:bg-gray-200"
              >
                {p}
              </button>
            ))}
          </div>
        </Card>

        <Card className="mt-4 p-5">
          <SectionTitle icon={GraduationCapIcon} title="求职经验" />
          <div className="flex flex-wrap gap-2">
            {EXPERIENCES.map((e) => (
              <OptionButton key={e.key} active={experience === e.key} onClick={() => setExperience(e.key)}>{e.label}</OptionButton>
            ))}
          </div>
        </Card>

        <Card className="mt-4 p-5">
          <SectionTitle icon={GaugeIcon} title="面试难度" />
          <div className="grid grid-cols-3 gap-2">
            {DIFFICULTIES.map((d) => (
              <OptionButton key={d.key} active={difficulty === d.key} onClick={() => setDifficulty(d.key)} className="text-center">
                <span className="block font-semibold">{d.label}</span>
                <span className="mt-0.5 block text-[11px] font-normal leading-tight text-gray-500">{d.desc}</span>
              </OptionButton>
            ))}
          </div>
        </Card>

        <Card className="mt-4 p-5">
          <SectionTitle icon={ClockIcon} title="练习时长" />
          <div className="grid grid-cols-3 gap-2">
            {DURATIONS.map((d) => (
              <OptionButton key={d.key} active={duration === d.key} onClick={() => setDuration(d.key)} className="text-center">
                <span className="block font-semibold">{d.label}</span>
                <span className="mt-0.5 block text-[11px] font-normal text-gray-500">{d.desc}</span>
              </OptionButton>
            ))}
          </div>
        </Card>

        <Card className="mt-4 p-5">
          <SectionTitle icon={FileTextIcon} title="简历（可选）" />
          <p className="mb-3 text-xs text-gray-500">
            提供简历后，面试官会结合你的经历提问；仅本次练习使用，按既有文件策略短期自动清理。
          </p>
          {resumeFile ? (
            <div className="flex items-center justify-between rounded-xl bg-primary-50 px-4 py-3">
              <span className="truncate text-sm font-medium text-primary-700">{resumeFile.name}</span>
              <button
                type="button"
                onClick={() => setResumeFile(null)}
                aria-label="移除简历"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-white"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="secondary" className="min-h-[52px] flex-1" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                {uploading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : '上传简历'}
              </Button>
              <div className="flex min-h-[52px] flex-1 items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-400">
                不上传则按通用问题练习
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

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
        )}
      </div>

      {/* 底部主操作（固定，触控 ≥56px） */}
      <div className="absolute inset-x-0 bottom-0 border-t border-gray-100 bg-white/95 px-6 py-4 backdrop-blur">
        <Button size="lg" className="h-14 w-full text-base" disabled={creating || uploading} onClick={() => void handleStart()}>
          {creating ? '正在为你准备面试官…' : '开始模拟面试'}
        </Button>
      </div>
    </div>
  )
}
