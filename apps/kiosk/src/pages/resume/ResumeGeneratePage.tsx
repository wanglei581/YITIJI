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
import { Button, Card, PageHeader, Stepper } from '@ai-job-print/ui'
import type {
  ResumeGenEducation,
  ResumeGenExperience,
  ResumeGenProject,
  ResumeGenerateInput,
  ResumeGenerateResponse,
} from '@ai-job-print/shared'
import {
  GraduationCapIcon,
  BriefcaseIcon,
  CheckIcon,
  FolderGitIcon,
  PlusIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
  UserRoundIcon,
  WrenchIcon,
} from 'lucide-react'
import { submitResumeGenerate } from '../../services/api'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { ResumeVoiceInputButton } from './components/ResumeVoiceInputButton'
import './resume-authoring-lightflow.css'
import './resume-fusion-youth.css'

const STEPS = [
  { title: '基本信息', description: '姓名与联系方式' },
  { title: '求职意向', description: '目标岗位' },
  { title: '教育经历', description: '学校与专业' },
  { title: '工作经历', description: '实习 / 工作' },
  { title: '项目经历', description: '可选' },
  { title: '技能证书', description: '技能与自我评价' },
] as const

/** 右侧进度侧栏——展示6个填写阶段的完成状态 */
function ProgressSidebar({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex w-[330px] flex-none flex-col gap-4">
      <div className="resume-lightflow__work-card rounded-2xl border p-5">
        <p className="mb-4 font-serif text-xl font-bold tracking-wide text-neutral-900">填写进度</p>
        <div className="flex flex-col gap-2">
          {STEPS.map((s, idx) => {
            const done = idx < currentStep
            const now = idx === currentStep
            return (
              <div
                key={idx}
                className={[
                  'flex min-h-[52px] items-center gap-3 rounded-xl border px-4 transition-colors',
                  now ? 'border-primary-300 bg-primary-50' : done ? 'border-neutral-100 bg-white' : 'border-neutral-100 bg-white',
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-9 w-9 flex-none items-center justify-center rounded-full border-2 text-sm font-bold',
                    done ? 'border-primary-600 bg-primary-600 text-white' : now ? 'border-primary-600 bg-white text-primary-600' : 'border-neutral-200 bg-white text-neutral-400',
                  ].join(' ')}
                >
                  {done ? <CheckIcon className="h-4 w-4" /> : idx + 1}
                </span>
                <span className={['text-base font-semibold', done || now ? 'text-neutral-900' : 'text-neutral-400'].join(' ')}>
                  {s.title}
                </span>
                <span className="ml-auto text-sm text-neutral-400">
                  {done ? '已填' : now ? '填写中' : s.description}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="resume-lightflow__work-card rounded-2xl border p-5">
        <p className="mb-3 font-serif text-xl font-bold tracking-wide text-neutral-900">生成说明</p>
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 rounded-xl border border-primary-100 bg-primary-50 px-3 py-3 text-xs leading-relaxed text-primary-800">
            <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            AI 只润色你填写的真实信息，不会替你编造学历、证书、公司或项目经历；没填的内容会提示你补充。
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-3 text-xs leading-relaxed text-neutral-600">
            <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
            本机为公共设备：填写内容仅用于本次生成，离开页面即清除；生成结果与导出文件短期保留后自动清理。
          </div>
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'resume-lightflow__field w-full rounded-xl border border-neutral-200 bg-white px-4 py-3.5 text-base text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="resume-lightflow__field-label block">
      <span className="mb-1.5 block text-sm font-medium text-neutral-700">
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
        <Card key={i} className="resume-lightflow__entry-card relative p-4">
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="resume-lightflow__entry-remove absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-lg text-neutral-300 hover:bg-error-bg hover:text-error-fg"
            aria-label="删除该条"
          >
            <Trash2Icon className="h-5 w-5" />
          </button>
          <div className="pr-10">{renderItem(item, i)}</div>
        </Card>
      ))}
      {items.length < maxItems && (
        <button
          type="button"
          onClick={onAdd}
          className="resume-lightflow__add-entry flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 text-base font-medium text-neutral-500 hover:border-primary-300 hover:text-primary-600"
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
  const [step, setStep] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 表单数据只在组件内存(公共设备隐私):刷新/待机即丢失,不写任何本地存储。
  const [basic, setBasic] = useState({ name: '', phone: '', email: '', city: '' })
  const [intention, setIntention] = useState({ position: '', city: '', jobType: '', salary: '' })
  const [education, setEducation] = useState<ResumeGenEducation[]>([{ ...EMPTY_EDU }])
  const [experience, setExperience] = useState<ResumeGenExperience[]>([{ ...EMPTY_EXP }])
  const [projects, setProjects] = useState<ResumeGenProject[]>([])
  const [skillsText, setSkillsText] = useState('')
  const [certsText, setCertsText] = useState('')
  const [selfIntro, setSelfIntro] = useState('')

  // 生成期间豁免待机宣传屏(打断会丢表单)
  useBusyLock(generating)

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

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    const input = buildInput()
    try {
      const result: ResumeGenerateResponse = await submitResumeGenerate(input, getToken())
      if (result.status !== 'completed' || !result.resume) {
        setError(result.failReason ?? 'AI 简历生成失败，请稍后重试')
        return
      }
      navigate('/resume/generate/preview', { state: { result, input } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 简历生成失败，请稍后重试')
    } finally {
      setGenerating(false)
    }
  }

  const stepIcon = [UserRoundIcon, BriefcaseIcon, GraduationCapIcon, BriefcaseIcon, FolderGitIcon, WrenchIcon][step]
  const StepIcon = stepIcon

  return (
    <div className="resume-lightflow resume-generate-lightflow flex h-full flex-col">
      <div className="resume-lightflow__header px-6 pt-6">
        <PageHeader
          title="AI 简历生成"
          subtitle="填写你的真实信息，AI 帮你润色成一份结构化简历"
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/resume/source')}>
              返回简历服务
            </Button>
          }
        />
        <div className="resume-lightflow__stepper mt-4">
          <Stepper steps={[...STEPS]} currentIndex={step} />
        </div>
      </div>

      <div className="resume-lightflow__content mt-4 flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        <div className="flex min-h-full gap-5">
          {/* 左：当前步骤表单 */}
          <div className="flex flex-1 min-w-0 flex-col gap-4">
            <Card className="resume-lightflow__work-card p-5">
              <div className="resume-lightflow__section-heading mb-4 flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
                  <StepIcon className="h-5 w-5 text-primary-600" aria-hidden="true" />
                </span>
                <p className="text-lg font-semibold text-neutral-900">{STEPS[step].title}</p>
              </div>

          {step === 0 && (
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
                      {['高中', '中专', '大专', '本科', '硕士', '博士'].map((d) => <option key={d} value={d}>{d}</option>)}
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
        </Card>

            {error && (
              <p className="mt-3 rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg">{error}</p>
            )}
          </div>

          {/* 右：填写进度 + 生成说明 */}
          <ProgressSidebar currentStep={step} />

        </div>
      </div>

      {/* 底部操作条 */}
      <div className="resume-lightflow__action-bar border-t border-neutral-100 px-6 pb-6 pt-3">
        <div className="flex gap-3">
          <Button
            size="lg"
            variant="secondary"
            className="flex-1"
            disabled={generating}
            onClick={() => (step === 0 ? navigate('/resume/source') : setStep((s) => s - 1))}
          >
            {step === 0 ? '返回' : '上一步'}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button size="lg" className="flex-[2]" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              下一步：{STEPS[step + 1].title}
            </Button>
          ) : (
            <Button size="lg" className="flex flex-[2] items-center justify-center gap-2" disabled={generating} onClick={() => void handleGenerate()}>
              <SparklesIcon className="h-5 w-5" />
              {generating ? 'AI 生成中…' : '生成我的简历'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
