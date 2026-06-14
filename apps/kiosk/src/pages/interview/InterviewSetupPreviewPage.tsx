// ============================================================
// 模拟面试设置页 — 布局预览版。
//
// 用于和用户确认新版排版，不调用后端创建面试。
// ============================================================

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  BriefcaseIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  ClockIcon,
  FileTextIcon,
  GraduationCapIcon,
  InfoIcon,
  UserRoundCheckIcon,
} from 'lucide-react'

const INTERVIEWERS = [
  { key: 'hr', label: 'HR 初筛', desc: '自我介绍 · 求职动机 · 稳定性' },
  { key: 'tech', label: '技术面试官', desc: '专业技能 · 项目细节 · 问题解决' },
  { key: 'manager', label: '业务主管', desc: '岗位理解 · 协作执行 · 复盘' },
  { key: 'campus', label: '校招面试官', desc: '校园经历 · 学习能力 · 职业规划' },
  { key: 'final', label: '终面负责人', desc: '价值观 · 长期发展 · 综合判断' },
]

const INDUSTRIES = ['互联网 / AI', '制造业', '教育培训', '医疗健康', '金融服务', '政务 / 国企', '零售 / 服务业', '其他']
const POSITIONS = ['前端开发工程师', '行政专员', '市场运营', '机械工程师', '会计', '销售代表']
const EXPERIENCES = ['应届生', '1 年以内', '1-3 年', '3-5 年', '5 年以上', '转行求职']
const DIFFICULTIES = [
  { key: 'easy', label: '轻松练习', desc: '基础问题' },
  { key: 'standard', label: '标准面试', desc: '真实节奏' },
  { key: 'pressure', label: '压力面试', desc: '连续追问' },
]
const DURATIONS = [
  { key: '3 分钟', desc: '约 3-4 题' },
  { key: '5 分钟', desc: '约 4-6 题' },
  { key: '8 分钟', desc: '约 6-8 题' },
]

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

function SectionHeader({
  index,
  icon: Icon,
  title,
  desc,
}: {
  index: string
  icon: typeof UserRoundCheckIcon
  title: string
  desc: string
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">{index}</span>
          <h2 className="text-base font-semibold text-gray-950">{title}</h2>
        </div>
        <p className="mt-1 text-xs text-gray-500">{desc}</p>
      </div>
    </div>
  )
}

function ChoiceCard({
  active,
  label,
  desc,
  onClick,
}: {
  active: boolean
  label: string
  desc?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'min-h-[64px] rounded-lg border px-4 py-3 text-left transition-colors',
        active
          ? 'border-primary-500 bg-primary-50 text-primary-800 shadow-sm'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50',
      )}
    >
      <span className="block text-sm font-semibold">{label}</span>
      {desc && <span className="mt-1 block text-xs leading-relaxed text-gray-500">{desc}</span>}
    </button>
  )
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'min-h-[44px] rounded-full border px-4 text-sm font-semibold transition-colors',
        active
          ? 'border-primary-500 bg-primary-50 text-primary-700 shadow-sm'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300',
      )}
    >
      {label}
    </button>
  )
}

function SummaryRow({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-gray-100 py-3 last:border-b-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={cx('max-w-[13rem] truncate text-right text-sm font-semibold', warning ? 'text-orange-700' : 'text-gray-950')}>
        {value}
      </span>
    </div>
  )
}

export function InterviewSetupPreviewPage() {
  const navigate = useNavigate()
  const [interviewer, setInterviewer] = useState(INTERVIEWERS[0])
  const [industry, setIndustry] = useState(INDUSTRIES[0])
  const [position, setPosition] = useState('')
  const [experience, setExperience] = useState(EXPERIENCES[0])
  const [difficulty, setDifficulty] = useState(DIFFICULTIES[1])
  const [duration, setDuration] = useState(DURATIONS[1])
  const [useResume, setUseResume] = useState(false)

  const positionReady = position.trim().length > 0

  return (
    <div className="min-h-screen bg-[#f5f7fa] px-6 py-5 text-gray-950">
      <PageHeader
        title="模拟面试"
        subtitle="选择场景后进入 AI 数字人面试间"
        className="pb-3"
        actions={<Button size="sm" variant="secondary" onClick={() => navigate('/interview/setup')}>返回正式页</Button>}
      />

      <div className="mt-3 flex min-h-[44px] items-center gap-3 rounded-lg border border-primary-100 bg-primary-50 px-4 text-sm font-medium text-primary-700">
        <InfoIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        仅供本人练习与准备参考，不代表招聘结果，不参与企业筛选或录用决策。
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_390px]">
        <main className="grid gap-4">
          <Card className="p-4">
            <SectionHeader
              index="01"
              icon={UserRoundCheckIcon}
              title="选择面试官"
              desc="先确定面试官身份，系统会按场景组织问题。"
            />
            <div className="grid gap-3 lg:grid-cols-5">
              {INTERVIEWERS.map((item) => (
                <ChoiceCard
                  key={item.key}
                  active={interviewer.key === item.key}
                  label={item.label}
                  desc={item.desc}
                  onClick={() => setInterviewer(item)}
                />
              ))}
            </div>
          </Card>

          <Card className="border-orange-100 p-4 shadow-sm">
            <SectionHeader
              index="02"
              icon={BriefcaseIcon}
              title="岗位与行业"
              desc="这是必填项，会直接影响本次提问方向。"
            />
            <div className="flex flex-wrap gap-2">
              {INDUSTRIES.map((item) => (
                <Chip key={item} active={industry === item} label={item} onClick={() => setIndustry(item)} />
              ))}
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <label htmlFor="position-preview" className="mb-2 block text-sm font-semibold text-gray-800">
                  目标岗位 <span className="text-orange-600">*</span>
                </label>
                <input
                  id="position-preview"
                  value={position}
                  onChange={(event) => setPosition(event.target.value)}
                  maxLength={50}
                  placeholder="请输入目标岗位，如：前端开发工程师"
                  className={cx(
                    'h-14 w-full rounded-lg border px-4 text-base outline-none transition-colors focus:ring-2',
                    positionReady
                      ? 'border-gray-200 bg-white focus:border-primary-500 focus:ring-primary-100'
                      : 'border-orange-200 bg-orange-50/50 focus:border-orange-400 focus:ring-orange-100',
                  )}
                />
              </div>
              <div className="flex items-end">
                <div className="rounded-lg border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-700">
                  {positionReady ? '岗位已填写' : '填写后才能开始'}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {POSITIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPosition(item)}
                  className="min-h-[40px] rounded-full bg-gray-100 px-4 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200"
                >
                  {item}
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <SectionHeader
              index="03"
              icon={GraduationCapIcon}
              title="练习参数"
              desc="把经验、难度、时长收在一组，减少页面滚动。"
            />
            <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-800">经验</p>
                <div className="grid grid-cols-2 gap-2">
                  {EXPERIENCES.map((item) => (
                    <Chip key={item} active={experience === item} label={item} onClick={() => setExperience(item)} />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-800">难度</p>
                <div className="grid gap-2">
                  {DIFFICULTIES.map((item) => (
                    <ChoiceCard
                      key={item.key}
                      active={difficulty.key === item.key}
                      label={item.label}
                      desc={item.desc}
                      onClick={() => setDifficulty(item)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-800">时长</p>
                <div className="grid gap-2">
                  {DURATIONS.map((item) => (
                    <ChoiceCard
                      key={item.key}
                      active={duration.key === item.key}
                      label={item.key}
                      desc={item.desc}
                      onClick={() => setDuration(item)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <SectionHeader
              index="04"
              icon={FileTextIcon}
              title="简历（可选）"
              desc="上传后可结合经历追问，不上传也可以按通用问题练习。"
            />
            <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
              <Button
                variant={useResume ? 'primary' : 'secondary'}
                className="h-12 text-base"
                onClick={() => setUseResume((value) => !value)}
              >
                {useResume ? '已选择示例简历' : '选择 / 上传简历'}
              </Button>
              <div className="flex min-h-[48px] items-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 text-sm text-gray-500">
                {useResume ? '示例：前端开发工程师-简历.pdf' : '不上传也可以开始练习，报告仍会基于你的回答生成。'}
              </div>
            </div>
          </Card>
        </main>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-gray-100 p-5">
              <div className="flex items-center gap-2">
                <CheckCircle2Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
                <h2 className="text-base font-semibold text-gray-950">本次练习摘要</h2>
              </div>
              <p className="mt-1 text-xs text-gray-500">确认场景无误后进入面试间</p>
            </div>
            <div className="p-5">
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-4">
                <SummaryRow label="面试官类型" value={interviewer.label} />
                <SummaryRow label="行业" value={industry} />
                <SummaryRow label="目标岗位" value={positionReady ? position.trim() : '待填写'} warning={!positionReady} />
                <SummaryRow label="经验" value={experience} />
                <SummaryRow label="难度" value={difficulty.label} />
                <SummaryRow label="时长" value={duration.key} />
                <SummaryRow label="使用简历" value={useResume ? '使用示例简历' : '不使用简历'} />
              </div>

              {!positionReady && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-700">
                  <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  请填写目标岗位后开始模拟面试。
                </div>
              )}

              <Button
                size="lg"
                className="mt-4 h-14 w-full text-base"
                disabled={!positionReady}
                onClick={() => undefined}
              >
                {positionReady ? (
                  <>
                    开始模拟面试
                    <ChevronRightIcon className="ml-2 h-5 w-5" aria-hidden="true" />
                  </>
                ) : '填写目标岗位后开始'}
              </Button>

              <div className="mt-4 grid gap-2 rounded-lg border border-gray-100 p-4 text-xs leading-relaxed text-gray-500">
                <div className="flex items-center gap-2 font-semibold text-gray-700">
                  <ClockIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
                  预计 {duration.key} 完成
                </div>
                <p>报告仅供本人复盘，不记录企业筛选结果，不代表录用或面试邀约。</p>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}
