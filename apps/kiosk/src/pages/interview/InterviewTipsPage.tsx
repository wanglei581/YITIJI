// ============================================================
// 面试技巧 — 面试前准备工具页（2C）。
//
// 内容结构参考旧版（准备要点 / 高频问题 / STAR），按正式 Kiosk 设计系统重做：
// checklist 可勾选（仅本页内存态，引导逐项过一遍）、高频问题卡可展开、
// STAR 完整说明（不截断）、自我介绍结构、底部 CTA 进入模拟面试。
// 无任何"保过/通过率"类承诺文案。
// ============================================================

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import {
  CheckSquareIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  HelpCircleIcon,
  LightbulbIcon,
  MicIcon,
} from 'lucide-react'
import { InterviewTopbar } from './InterviewTopbar'
import './interview-service-desk.css'

const CHECKLIST: Array<{ title: string; desc: string }> = [
  { title: '背景调研', desc: '了解公司核心业务、近期动态、企业文化，并在面试中自然地表达出来' },
  { title: '岗位匹配', desc: '提取岗位 JD（职位描述）中的关键词，对应准备你的经历故事' },
  { title: '基础演练', desc: '准备 1 分钟 / 3 分钟自我介绍，回顾简历上每段经历的细节（不能有被问住的空白）' },
  { title: '形象着装', desc: '根据公司性质（互联网偏休闲，金融/国企偏正装）选择合适着装，保持整洁精神' },
  { title: '面试材料', desc: '简历、作品集、证件、纸质材料按需备齐（可在本终端打印简历）' },
  { title: '面试安排', desc: '确认时间、地点、交通路线；线上面试提前测试设备与网络' },
]

const FAQS: Array<{ q: string; examine: string; structure: string; mistake: string; tip: string }> = [
  {
    q: '请简单自我介绍一下？',
    examine: '表达能力、重点提炼能力、与岗位的初步匹配度',
    structure: '控制在 2-3 分钟：我是谁 + 我做过什么（核心成绩）+ 我为什么适合这个岗位',
    mistake: '背诵简历逐条复述；讲到童年成长经历；超过 5 分钟',
    tip: '结尾落到"所以我希望在这个岗位上…"，把话题引向岗位',
  },
  {
    q: '你为什么想应聘这个岗位？',
    examine: '求职动机的真实性、对岗位的理解程度',
    structure: '岗位职责的理解 + 自己能力的对应点 + 想在岗位上解决/达成什么',
    mistake: '只说"想找份工作""离家近"；对岗位职责一无所知',
    tip: '提前读 3 遍岗位 JD，至少能说出两条核心职责',
  },
  {
    q: '你最大的优势是什么？',
    examine: '自我认知 + 优势与岗位的关联度',
    structure: '一个明确优势 + 一个具体事例支撑 + 与岗位的关联',
    mistake: '罗列五六个空泛形容词（认真、负责、能吃苦）没有事例',
    tip: '优势只讲一两个，但配上能讲细节的真实例子',
  },
  {
    q: '你最大的不足是什么？',
    examine: '自我认知的诚实度、改进意识',
    structure: '一个真实的、非致命的不足 + 正在采取的改进行动',
    mistake: '说"我太追求完美"这类包装答案；说出岗位核心能力上的硬伤',
    tip: '重点在"我正在怎么改"，给出具体行动',
  },
  {
    q: '讲一个你解决困难或挫折的经历。',
    examine: '问题分析、行动力、复盘能力',
    structure: '用 STAR：背景 → 你的任务 → 具体行动 → 量化结果与收获',
    mistake: '只抱怨困难本身；说不清自己在其中做了什么',
    tip: '突出"我"做了什么，而不是"我们团队"做了什么',
  },
  {
    q: '你为什么想来我们公司？',
    examine: '求职诚意、对公司的了解程度',
    structure: '公司行业地位/业务方向 + 个人职业规划的契合点',
    mistake: '说"贵公司是大公司/工资高"；明显没做任何了解',
    tip: '至少了解公司主营业务和一条近期动态',
  },
  {
    q: '你对薪资有什么期待？',
    examine: '自我定位是否客观、沟通方式',
    structure: '给出有依据的区间 + 表达对综合发展的关注 + 留出协商空间',
    mistake: '一口咬死具体数字；完全不敢谈，说"随便都行"',
    tip: '提前查同城市同岗位的大致水平，区间上下浮动 15% 左右',
  },
  {
    q: '你还有什么想问我们的？',
    examine: '求职意愿、思考深度（这几乎是必问的收尾题）',
    structure: '准备 2-3 个问题：岗位的工作内容细节 / 团队情况 / 入职后的成长路径',
    mistake: '说"没有问题了"；上来就问加班和假期',
    tip: '问"这个岗位前三个月最重要的目标是什么"是稳妥的好问题',
  },
]

const STAR: Array<{ k: string; name: string; desc: string }> = [
  { k: 'S', name: '情境 Situation', desc: '简述事件发生的背景，遇到了什么问题或挑战。' },
  { k: 'T', name: '任务 Task', desc: '明确你在这个情境中需要完成的目标或承担的角色。' },
  { k: 'A', name: '行动 Action', desc: '详细描述你为了达成目标采取了哪些具体的行动步骤（重点突出你的能力）。' },
  { k: 'R', name: '结果 Result', desc: '说明最终取得了什么成果，尽量用数据量化：例如提升转化率、缩短周期、降低成本、服务人数、完成数量等。' },
]

const INTRO_STRUCTURES: Array<{ duration: string; points: string[] }> = [
  { duration: '30 秒', points: ['我是谁（姓名 + 当前身份）', '一句话核心优势', '我为什么来应聘这个岗位'] },
  { duration: '1 分钟', points: ['我是谁', '我做过什么（1 个核心成绩）', '我为什么适合这个岗位'] },
  { duration: '3 分钟', points: ['我是谁', '我做过什么（2-3 段经历 + 量化成绩）', '我为什么适合这个岗位', '我希望在这个岗位解决什么问题'] },
]

export function InterviewTipsPage() {
  const navigate = useNavigate()
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const toggleCheck = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div className="interview-flow interview-tips" data-visual-theme="service-desk" data-ux-density="touch">
      <InterviewTopbar />
      <PageHeader
        className="interview-pagehead"
        title="面试技巧"
        subtitle="面试前准备工具：清单逐项过一遍，再开始模拟练习（通用建议，仅供参考）"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>返回</Button>
        }
      />

      <div className="interview-flow__scroll flex-1 overflow-y-auto pb-32">
        <ComplianceBanner tone="info">
          面试是展示自我、与企业双向选择的过程。以下内容为通用准备建议，仅供参考。
        </ComplianceBanner>

        {/* 2 列并排（原型 41：左: 准备清单+STAR，右: 高频问题+自我介绍结构）*/}
        <div className="interview-tips__cols">

          {/* ── 左列 ── */}
          <div className="interview-tips__col">

            {/* 1. 面试前准备清单（可勾选） */}
            <Card className="interview-card interview-tips__checklist p-5">
              <div className="interview-tips__checklist-head card-head-row mb-3 flex items-center justify-between">
                <div className="interview-section-title mb-0 flex items-center gap-4">
                  <ClipboardListIcon aria-hidden="true" />
                  <h2 className="font-semibold">面试前准备清单</h2>
                </div>
                <span className="interview-tips__ck-count">{checked.size}/{CHECKLIST.length} 已完成</span>
              </div>
              <div className="interview-tips__progress" aria-hidden="true">
                <span style={{ width: `${Math.round((checked.size / CHECKLIST.length) * 100)}%` }} />
              </div>
              <div className="flex flex-col gap-1.5">
                {CHECKLIST.map((item, i) => {
                  const done = checked.has(i)
                  return (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => toggleCheck(i)}
                      aria-pressed={done}
                      className="interview-tips__ck-item"
                    >
                      <span className="interview-tips__ck-box" aria-hidden="true">
                        {done && <CheckSquareIcon />}
                      </span>
                      <span>
                        <span className="interview-tips__ck-title">{item.title}</span>
                        <span className="interview-tips__ck-desc">{item.desc}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </Card>

            {/* 3. STAR 法则（完整版） */}
            <Card className="interview-card p-5">
              <div className="interview-section-title mb-3 flex items-center gap-4">
                <LightbulbIcon aria-hidden="true" />
                <div>
                  <h2 className="font-semibold">行为面试技巧（STAR 法则）</h2>
                  <p className="mt-1 text-sm">讲经历时四步说清，比泛泛而谈更有说服力</p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {STAR.map((s) => (
                  <div key={s.k} className="interview-tips__star-row">
                    <span className="interview-tips__star-key">{s.k}</span>
                    <div>
                      <p className="interview-tips__star-name">{s.name}</p>
                      <p className="interview-tips__star-desc">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* ── 右列 ── */}
          <div className="interview-tips__col">

            {/* 2. 高频问题（手风琴） */}
            <Card className="interview-card p-5">
              <div className="interview-section-title mb-3 flex items-center gap-4">
                <HelpCircleIcon aria-hidden="true" />
                <div>
                  <h2 className="font-semibold">高频问题应对</h2>
                  <p className="mt-1 text-sm">点击展开查看回答思路</p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {FAQS.map((f, i) => {
                  const open = openFaq === i
                  return (
                    <div key={f.q} className="interview-tips__faq">
                      <button
                        type="button"
                        onClick={() => setOpenFaq(open ? null : i)}
                        aria-expanded={open}
                        className="interview-tips__faq-q"
                      >
                        <span>「{f.q}」</span>
                        <ChevronDownIcon
                          className={['interview-tips__faq-arrow', open ? 'is-open' : ''].filter(Boolean).join(' ')}
                          aria-hidden="true"
                        />
                      </button>
                      {open && (
                        <div className="interview-tips__faq-a">
                          <p><b>考察什么：</b>{f.examine}</p>
                          <p><b>回答结构：</b>{f.structure}</p>
                          <p><b className="interview-tips__faq-warn">常见错误：</b>{f.mistake}</p>
                          <p><b className="interview-tips__faq-tip">建议：</b>{f.tip}</p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>

            {/* 4. 自我介绍结构 */}
            <Card className="interview-card p-5">
              <div className="interview-section-title mb-3 flex items-center gap-4">
                <MicIcon aria-hidden="true" />
                <div>
                  <h2 className="font-semibold">自我介绍结构建议</h2>
                </div>
              </div>
              <div className="interview-tips__intro-grid">
                {INTRO_STRUCTURES.map((it) => (
                  <div key={it.duration} className="interview-tips__intro">
                    <b>{it.duration}版</b>
                    <ol>
                      {it.points.map((p, idx) => (
                        <li key={p}>
                          <i>{idx + 1}.</i>
                          {p}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* 底部 CTA */}
      <div className="interview-flow__action-bar absolute inset-x-0 bottom-0 border-t border-neutral-100 bg-white/95 px-6 py-4 backdrop-blur">
        <div className="flex justify-center">
          <Button size="lg" className="h-14 w-full max-w-[680px] text-base" onClick={() => navigate('/interview/setup')}>
            开始模拟面试
          </Button>
        </div>
        {/* 打印准备清单：完成模拟面试后报告自带准备清单且可打印，此处不放未接线的死按钮 */}
        <p className="mt-2 text-center text-[11px] text-neutral-400">完成一次模拟面试后，练习报告将附带个性化准备清单，可直接打印</p>
      </div>
    </div>
  )
}
