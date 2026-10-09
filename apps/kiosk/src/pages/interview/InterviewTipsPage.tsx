// ============================================================
// 面试技巧 — 面试前准备工具页（2C）。
//
// 按青序流光 2.0 稿 29 的 tips 态排：准备清单（可勾选，仅本页内存态）、STAR 三步、
// 高频问题（点开看思路）与自我介绍时长、页尾说明。无任何"保过/通过率"类承诺文案。
//
// 2026-09-20：本页是 serviceHubModel.OFFLINE_CAPABLE_ROUTES 里唯一带「出口按钮」的一条。
// 那张白名单说的是「不联网也能**读**这一页」——本页四块内容全是编译进包的常量，
// 这一点没变、也不该变。但底部「开始模拟面试」不是阅读，它要 POST /mock-interviews
// 创建会话。在线服务不可用时，面试服务台已经把「模拟练习」那张卡 fail-closed 掉了，
// 用户却能从同一个服务台点「先看技巧」进到本页，再从这里一路走进 setup ——
// 服务台那条判据就这么被绕过去了，最后停在一个填完表才报错的设置页。
// 所以这里按同一条口径给出口设闸：checking 与 unavailable 都不放行（「还不知道」
// 不构成放行理由），本地技巧内容一字不减。
// ============================================================

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxAiHelp, QxStepActions } from '../../components/qingxu/QxAiHelp'
import { useApiReadiness } from '../../hooks/useApiReadiness'
import { InterviewShell } from './InterviewShell'
import { InterviewCardHead, InterviewNotice, InterviewRail, InterviewSteps } from './interviewQxParts'
import { INTERVIEW_STAGE_COPY, emphasizedTitle, type InterviewStage } from './interviewWorkbenchModel'
import { patchInterviewWorkbenchSession } from './interviewWorkbenchSession'
import './interview-service-desk.css'
import './styles/interview-workbench-qx.css'
import './styles/interview-qx2.css'
import './styles/interview-tips-qx2.css'

// 稿 29 tips 态：一张可勾选的准备清单、一张 STAR 三步、一张高频问题（折叠）加自我介绍时长。
// 全部是编译进包的公开内容，不联网也能读；不根据任何人的简历生成。
const CHECKLIST = [
  '背景调研与岗位关键词',
  '准备真实经历与细节',
  '练习 1 分钟自我介绍',
  '核对材料、时间和路线',
  '确认线上设备与网络',
  '把问题写成 STAR 结构',
]

const STAR_STEPS: Array<[string, string, string]> = [
  ['S / T', '说清背景和任务', '交代情境、目标和你承担的角色。'],
  ['A', '说明你的行动', '聚焦本人做了什么，不只讲团队。'],
  ['R', '核对真实结果', '数字和成果由本人核实，不用编造。'],
]

const FAQS: Array<{ q: string; structure: string; examine: string; mistake: string; tip: string }> = [
  {
    q: '请简单自我介绍一下？',
    structure: '我是谁 + 我做过什么 + 一个真实核心成绩 + 为什么适合目标岗位。不要逐条背诵简历或编造经历。',
    examine: '表达能力、提炼重点的能力、与岗位的初步匹配度。',
    mistake: '逐条复述简历；讲到童年成长经历；超过 5 分钟。',
    tip: '结尾落到「所以我希望在这个岗位上……」，把话题引回岗位。',
  },
  {
    q: '你为什么想应聘这个岗位？',
    structure: '说明岗位理解、自己的对应能力和希望解决的问题，避免只说「想找一份工作」。',
    examine: '求职动机是否真实、对岗位理解有多深。',
    mistake: '只说「离家近」「想找份工作」；对岗位职责说不出来。',
    tip: '提前读三遍岗位描述，至少能说出两条核心职责。',
  },
  {
    q: '你最大的优势是什么？',
    structure: '一个明确优势 + 一个具体事例支撑 + 与岗位的关联。',
    examine: '自我认知，以及优势和岗位的关联。',
    mistake: '罗列五六个空泛形容词（认真、负责、能吃苦），没有事例。',
    tip: '优势只讲一两个，但配上能讲出细节的真实例子。',
  },
  {
    q: '你最大的不足是什么？',
    structure: '一个真实、不致命的不足 + 正在采取的改进行动。',
    examine: '是否诚实面对自己、有没有改进意识。',
    mistake: '说「我太追求完美」这类包装答案；说出岗位核心能力上的硬伤。',
    tip: '重点讲「我正在怎么改」，给出具体行动。',
  },
  {
    q: '讲一个你解决困难或挫折的经历。',
    structure: '按 STAR：背景 → 你的任务 → 具体行动 → 结果与收获。',
    examine: '分析问题、动手解决和复盘的能力。',
    mistake: '只抱怨困难本身；说不清自己在其中做了什么。',
    tip: '突出「我」做了什么，而不是「我们团队」做了什么。',
  },
  {
    q: '你为什么想来我们公司？',
    structure: '公司的业务方向或行业位置 + 和自己职业规划的契合点。',
    examine: '求职诚意、对公司的了解程度。',
    mistake: '只说「贵公司是大公司」「工资高」；明显没做任何了解。',
    tip: '至少了解公司的主营业务和一条近期动态。',
  },
  {
    q: '你对薪资有什么期待？',
    structure: '给出有依据的区间 + 表达对综合发展的关注 + 留出商量空间。',
    examine: '自我定位是否客观、沟通方式是否得体。',
    mistake: '一口咬死具体数字；完全不敢谈，说「随便都行」。',
    tip: '提前查同城市同岗位的大致水平，区间上下浮动 15% 左右。',
  },
  {
    q: '你还有什么想问我们的？',
    structure: '准备 2–3 个问题：岗位的工作内容、团队情况、入职后的成长路径。',
    examine: '求职意愿和思考深度，这几乎是必问的收尾题。',
    mistake: '说「没有问题了」；一上来就问加班和假期。',
    tip: '问「这个岗位前三个月最重要的目标是什么」是稳妥的好问题。',
  },
]

const INTRO_LENGTHS: Array<[string, string]> = [
  ['30 秒', '身份、核心优势、岗位动机。'],
  ['1 分钟', '加上一段真实经历和成果。'],
  ['3 分钟', '补充两三段经历与发展方向。'],
]

/**
 * 出口闸门的三种结论。判据与 `serviceHubModel.unavailableReason` / 服务台提示条同源：
 * `useApiReadiness` 判的是 `/health` 可达性，`checking` 与 `unavailable` **都**不放行。
 *
 * 话术刻意和服务台对齐（「在线服务当前不可用」/「正在确认在线服务」）：用户是从
 * 面试服务台点「先看技巧」过来的，同一件事在两页上换个说法只会让人以为是两回事。
 */
function startGate(status: 'checking' | 'ready' | 'unavailable'): { reason: string; code: string } | null {
  if (status === 'unavailable') {
    return {
      reason: '在线服务当前不可用，模拟面试需要联网才能开始；本页的准备清单、高频问题和 STAR 说明不依赖联网，可以继续看。',
      code: 'api:unavailable',
    }
  }
  if (status === 'checking') {
    return {
      reason: '正在确认在线服务，确认完成前不开始这场练习；本页的准备内容不依赖联网，可以继续看。',
      code: 'api:checking',
    }
  }
  return null
}

export function InterviewTipsPage({ onGoStage }: { onGoStage?: (stage: InterviewStage) => void } = {}) {
  const navigate = useNavigate()
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const { status: apiStatus, retry: retryApi } = useApiReadiness()
  const gate = startGate(apiStatus)

  const toggleCheck = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const copy = INTERVIEW_STAGE_COPY.tips
  const titleParts = emphasizedTitle(copy)
  const goSetup = () => {
    // 闸门在这里再挡一次，不只在渲染层。aria-disabled 的按钮仍然能被程序化点击，
    // 「看起来点不动」和「点了不会发生」必须是同一件事。
    if (gate) return
    patchInterviewWorkbenchSession({ stage: 'setup' })
    if (onGoStage) onGoStage('setup')
    else navigate('/interview/setup')
  }

  return (
    <InterviewShell
      title={<>{titleParts.before}<em>{titleParts.em}</em>{titleParts.after}</>}
      subtitle={copy.subtitle}
      // 顶栏胶囊跟着一起说。默认档是 InterviewShell 的「模拟练习」，
      // 而此刻这台机器恰恰练不了 —— 不出声等于让胶囊替在线服务作保。
      status={
        apiStatus === 'unavailable'
          ? { tone: 'bad', label: '在线服务不可用' }
          : apiStatus === 'checking'
            ? { tone: 'unknown', label: '正在确认在线服务' }
            : undefined
      }
      ctabar={
        <div className="interview-qx-cta">
          <QxStepActions>
            <QxAiHelp label="问小青：面试前先准备什么" draft="我想准备一场面试。请根据公开的准备方法告诉我先做哪几步，不要假装已经看过我的简历。" />
          </QxStepActions>
          {gate ? (
            <>
              <p className="why" id="interview-tips-start-why">{gate.reason}</p>
              {apiStatus === 'unavailable' ? (
                <button
                  type="button"
                  className="qx-btn"
                  data-variant="ghost"
                  data-testid="interview-tips-recheck"
                  onClick={retryApi}
                >
                  重新检测
                </button>
              ) : null}
            </>
          ) : null}
          <div className="iv-cta-row">
            {gate ? (
              <button
                type="button"
                className="qx-btn"
                data-variant="primary"
                aria-disabled="true"
                aria-describedby="interview-tips-start-why"
                data-disabled-reason={gate.code}
                data-testid="interview-primary"
                onClick={goSetup}
              >
                设置一场练习
              </button>
            ) : (
              <button type="button" className="qx-btn" data-variant="primary" data-testid="interview-primary" onClick={goSetup}>
                设置一场练习<em aria-hidden="true">→</em>
              </button>
            )}
            <button
              type="button"
              className="qx-btn"
              data-variant="ghost"
              data-testid="interview-ai-advisor"
              onClick={() => navigate('/assistant')}
            >
              AI 顾问
            </button>
          </div>
        </div>
      }
    >
    <div data-kiosk-domain="interview" data-kiosk-screen="interview-tips" data-qx-interview="" className="interview-flow interview-tips" data-visual-theme="service-desk" data-ux-density="touch">

      <div className="interview-flow__scroll">
        <section className="iv-card" aria-labelledby="iv-tips-checklist">
          <div className="iv-head">
            <h2 id="iv-tips-checklist">面试前准备清单</h2>
            <span aria-live="polite">{checked.size} / {CHECKLIST.length} 已完成</span>
          </div>
          <div className="iv-checklist">
            {CHECKLIST.map((item, i) => {
              const done = checked.has(i)
              return (
                <button key={item} type="button" className="iv-check" aria-pressed={done} onClick={() => toggleCheck(i)}>
                  <i aria-hidden="true">{done ? '✓' : ''}</i>
                  {item}
                </button>
              )
            })}
          </div>
        </section>

        <section className="iv-card" aria-labelledby="iv-tips-star">
          <InterviewCardHead as="h2" id="iv-tips-star" title="回答一题的基本结构" hint="STAR 练习法" />
          <InterviewSteps rows={STAR_STEPS} />
        </section>

        <section className="iv-card" aria-labelledby="iv-tips-faq">
          <InterviewCardHead as="h2" id="iv-tips-faq" title="高频问题应对" hint="点开看回答思路" />
          {FAQS.map((f, i) => {
            const open = openFaq === i
            const answerId = `iv-tips-faq-${i}`
            return (
              <div key={f.q} className="iv-faq-row">
                <button type="button" aria-expanded={open} aria-controls={answerId} onClick={() => setOpenFaq(open ? null : i)}>
                  {f.q}
                  <span aria-hidden="true">{open ? '－' : '＋'}</span>
                </button>
                <div id={answerId} hidden={!open}>
                  <p><b>回答结构：</b>{f.structure}</p>
                  <p><b>考察什么：</b>{f.examine}</p>
                  <p><b>别这样答：</b>{f.mistake}</p>
                  <p><b>建议：</b>{f.tip}</p>
                </div>
              </div>
            )
          })}
          <h3 className="iv-subhead">自我介绍结构建议</h3>
          <div className="iv-mini-list">
            {INTRO_LENGTHS.map(([length, points]) => (
              <div key={length}>
                <small>{length}</small>
                <p>{points}</p>
              </div>
            ))}
          </div>
        </section>

        <InterviewNotice>
          这份技巧是公开的准备方法，不是根据你的材料生成的建议。想让 AI 按你的材料陪练，先设置一场练习。
        </InterviewNotice>
        <InterviewRail />
      </div>
    </div>
    </InterviewShell>
  )
}
