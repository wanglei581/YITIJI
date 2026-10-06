import type { ResumeGenEducation, ResumeGenExperience, ResumeGenProject } from '@ai-job-print/shared'
import { ALLOW_FIXTURES } from '../../../utils/buildMode'

/** 与 services/api ResumeGenerateRequestDto 的 ArrayMaxSize 一致，前端不得放得更宽。 */
export const LIMITS = { education: 6, experience: 8, projects: 6, skills: 20, certificates: 15 } as const

/**
 * 所在城市 / 意向城市的候选。
 * 试点在青岛；换点位时改这里。
 */
export const PILOT_CITIES = ['青岛', '济南', '烟台', '潍坊', '威海', '日照'] as const

/** 普通求职者会写的说法，不照招聘海报的岗位名。 */
export const POSITION_CHIPS = ['仓储管理员', '客服', '行政文员', '门店导购', '物流专员', '前台接待'] as const
export const JOB_TYPE_CHIPS = ['全职', '实习', '兼职'] as const
export const SALARY_CHIPS = ['面议', '3-4k', '4-6k', '6-8k', '8k 以上'] as const
export const SKILL_CHIPS = ['Excel', 'Word', 'PPT', '收银', '客服沟通', '社群运营', '活动策划', '驾驶证 C1', '普通话二级'] as const
export const CERT_CHIPS = ['普通话二级甲等', '机动车驾驶证 C1', '计算机二级', '会计从业', '电工证', '育婴师'] as const

export type HistorySeg = 'edu' | 'exp' | 'proj'

export const STEPS = [
  { title: '基本信息', ask: '先留下能联系上你的方式', doing: '这一步只有姓名必填。城市和联系方式可以空着，也可以点候选词。' },
  { title: '求职意向', ask: '你想找什么方向的工作？', doing: '这一步只有目标岗位必填。城市、类型、薪资都能点选。' },
  { title: '经历', ask: '把做过的事说清楚', doing: '学校、公司、职务、时间由你填，整理时这些事实一个字都不会改。描述可以直接说。' },
  { title: '技能与自评', ask: '还有会什么，和怎么做事', doing: '技能和证书只填你真有的。自我评价写一两句，整理时帮你顺一下。' },
] as const

export const STEP_STATE = ['input-basic', 'input-intention', 'input-history', 'input-strengths'] as const

const FILL_STATES = new Set([
  'entry',
  'input-basic',
  'input-intention',
  'input-history',
  'input-strengths',
  'review',
  'validate-name',
  'validate-position',
])

export interface BasicForm { name: string; phone: string; email: string; city: string }
export interface IntentionForm { position: string; city: string; jobType: string; salary: string }

export interface GenerateFormSnapshot {
  basic: BasicForm
  intention: IntentionForm
  education: ResumeGenEducation[]
  experience: ResumeGenExperience[]
  projects: ResumeGenProject[]
  skillsText: string
  certsText: string
  selfIntro: string
}

/** 从预览页回来改、或别的页带已填内容进来。没有 form 时只指定落在哪一步。 */
export interface GenerateHandoff {
  step: number
  seg?: HistorySeg
  form?: GenerateFormSnapshot
}

export interface GenerateBoot extends GenerateFormSnapshot {
  phase: 'entry' | 'form'
  step: number
  seg: HistorySeg
  reviewing: boolean
  forcedState: string | null
}

export const EMPTY_EDU: ResumeGenEducation = { school: '', major: '', degree: '', period: '', description: '' }
export const EMPTY_EXP: ResumeGenExperience = { company: '', role: '', period: '', description: '' }
export const EMPTY_PROJ: ResumeGenProject = { name: '', role: '', description: '' }

export function emptyForm(): GenerateFormSnapshot {
  return {
    basic: { name: '', phone: '', email: '', city: '' },
    intention: { position: '', city: '', jobType: '', salary: '' },
    education: [{ ...EMPTY_EDU }],
    experience: [{ ...EMPTY_EXP }],
    projects: [],
    skillsText: '',
    certsText: '',
    selfIntro: '',
  }
}

/** 并排截图用的示例，不是任何真人的简历。 */
export function sampleForm(): GenerateFormSnapshot {
  return {
    basic: { name: '孙晓雯', phone: '13853201826', email: 'sunxiaowen@example.com', city: '青岛' },
    intention: { position: '仓储管理员', city: '青岛', jobType: '全职', salary: '面议' },
    education: [{
      school: '青岛职业技术学院',
      major: '物流管理',
      degree: '高职专科',
      period: '2023.09 - 2026.06',
      description: '2026 届。在校做过仓库理货实训，会按单拣货、点数和贴标。',
    }],
    experience: [{
      company: '青岛港联物流',
      role: '仓储实习',
      period: '2025.07 - 2025.08',
      description: '在成品仓理货和拣货，一天大约处理 80 单，按货位把货配齐再交给复核。',
    }],
    projects: [{
      name: '校园快递代收点',
      role: '值班',
      description: '和同学轮班收发快递，登记取件码，把滞留件单独放到一边。',
    }],
    skillsText: 'Excel、仓储理货、客服沟通',
    certsText: '普通话二级甲等',
    selfIntro: '想找仓储或客服的工作，做事按单核对，有问题会先问清楚再动手。',
  }
}

export function splitList(text: string, cap: number): string[] {
  return text.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean).slice(0, cap)
}

export function toggleSingle(current: string, chip: string): string {
  return current.trim() === chip ? '' : chip
}

export function toggleMulti(current: string, chip: string, cap: number): string {
  const parts = splitList(current, 999)
  const index = parts.indexOf(chip)
  const next = index >= 0 ? parts.filter((_, i) => i !== index) : [...parts, chip]
  return next.slice(0, cap).join('、')
}

export function chipOn(current: string, chip: string, multi: boolean): boolean {
  if (!multi) return current.trim() === chip
  return splitList(current, 999).includes(chip)
}

function isSeg(value: unknown): value is HistorySeg {
  return value === 'edu' || value === 'exp' || value === 'proj'
}

export function readHandoff(state: unknown): GenerateHandoff | null {
  if (!state || typeof state !== 'object' || !('generateHandoff' in state)) return null
  const handoff = (state as { generateHandoff?: GenerateHandoff }).generateHandoff
  if (!handoff || typeof handoff.step !== 'number') return null
  return handoff
}

function clampStep(step: number): number {
  if (step < 0) return 0
  if (step > 3) return 3
  return step
}

export function bootGenerate(search: string, locationState: unknown): GenerateBoot {
  const params = new URLSearchParams(search)
  const capture = ALLOW_FIXTURES && params.get('capture') === '1'
  const raw = capture ? params.get('state') : null
  const segParam = params.get('seg')
  const querySeg: HistorySeg = segParam === 'edu' || segParam === 'proj' ? segParam : 'exp'
  const handoff = readHandoff(locationState)
  const blank = emptyForm()

  if (raw && FILL_STATES.has(raw)) {
    const filled = raw === 'entry' ? blank : sampleForm()
    if (raw === 'validate-name') filled.basic.name = ''
    if (raw === 'validate-position') filled.intention.position = ''
    const step = raw === 'input-intention' || raw === 'validate-position' ? 1
      : raw === 'input-history' ? 2
        : raw === 'input-strengths' ? 3
          : 0
    return {
      ...filled,
      phase: raw === 'entry' ? 'entry' : 'form',
      step,
      seg: querySeg,
      reviewing: raw === 'review',
      forcedState: raw === 'validate-name' || raw === 'validate-position' ? raw : null,
    }
  }

  if (handoff) {
    const form = handoff.form ?? blank
    return {
      ...form,
      phase: 'form',
      step: clampStep(handoff.step),
      seg: isSeg(handoff.seg) ? handoff.seg : 'exp',
      reviewing: false,
      forcedState: null,
    }
  }

  return { ...blank, phase: 'entry', step: 0, seg: 'exp', reviewing: false, forcedState: null }
}
