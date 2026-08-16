// ============================================================
// AdvisorTools — AI 专项工具入口区（Approach B 页面卡片 + Approach A URL intent）
//
// 从 AssistantPage.tsx 拆出。这 8 张卡都通向 `/assistant?intent=<skill>`，
// 落地后是一段**只能由模型产出**的会话（自我介绍稿、求职信、面试题…），
// 所以它们属于「AI 是唯一产出源、有入口按钮」这一类，
// AI 不可用时的处置是 S1 原语的 ② `blocked`：**按钮置灰 + 写清原因**。
//
// 为什么不是直接套 `AiTaskRegion` 的 blocked 视图：
// `AiTaskFallbackBlocked` 渲染的是**一颗**置灰按钮，套上去会把 8 个具名入口
// 收成一颗，用户读不到「具体哪几件事现在办不了」。原型 `25-advisor.html:220-222`
// 的 `.cap--ai` 也是**就地置灰**而不是折叠。所以这里就地置灰，
// 但规则与原语逐条一致：
//   · 一律 `aria-disabled`，**不用原生 disabled**（触屏无 hover；原生 disabled
//     会把按钮踢出 Tab 序、读屏直接跳过，用户永远读不到为什么灰）
//   · 原因常驻可见（不是 tooltip、不是 title），并由 `aria-describedby` 指向
//   · 状态标签复用原语的 `AiCapabilityChip`，不另造一套说法
// ============================================================

import type { ComponentType } from 'react'
import { useId } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2Icon,
  CrosshairIcon,
  HelpCircleIcon,
  ListChecksIcon,
  MailIcon,
  Mic2Icon,
  RouteIcon,
  ScanSearchIcon,
} from 'lucide-react'
import { AiCapabilityChip } from '../../ai'
import type { ToolboxAssistantSkill } from './advisorScenes'

/** AI 专项工具入口数据（Approach B 页面卡片 + Approach A URL intent） */
interface AiTool {
  id: Extract<
    ToolboxAssistantSkill,
    | 'self_intro_gen' | 'material_checklist' | 'jd_analysis'
    | 'interview_questions' | 'career_explore'
    | 'cover_letter_gen' | 'resume_jd_match' | 'company_research'
  >
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  accent: 'teal' | 'clay' | 'slate' | 'plum' | 'wheat'
}

const AI_TOOLS: readonly AiTool[] = [
  {
    id: 'self_intro_gen',
    icon: Mic2Icon,
    title: 'AI 自我介绍生成',
    description: '描述经历，生成1/3分钟可打印文稿',
    accent: 'teal',
  },
  {
    id: 'cover_letter_gen',
    icon: MailIcon,
    title: 'AI 求职信生成',
    description: '描述公司岗位和经历，生成可打印求职信',
    accent: 'clay',
  },
  {
    id: 'material_checklist',
    icon: ListChecksIcon,
    title: 'AI 材料准备清单',
    description: '面试/招聘会前，生成个性化可打印清单',
    accent: 'slate',
  },
  {
    id: 'resume_jd_match',
    icon: CrosshairIcon,
    title: 'AI 简历 JD 匹配',
    description: '简历与岗位对比，找出差距和加分建议',
    accent: 'plum',
  },
  {
    id: 'jd_analysis',
    icon: ScanSearchIcon,
    title: 'AI 岗位 JD 解读',
    description: '拆解招聘要求，区分门槛与加分项',
    accent: 'wheat',
  },
  {
    id: 'interview_questions',
    icon: HelpCircleIcon,
    title: 'AI 面试题预测',
    description: '预测高频题目与回答思路，可打印带走',
    accent: 'teal',
  },
  {
    id: 'company_research',
    icon: Building2Icon,
    title: 'AI 企业面试速查',
    description: '面试前5分钟了解企业风格和考察方向',
    accent: 'clay',
  },
  {
    id: 'career_explore',
    icon: RouteIcon,
    title: 'AI 求职方向探索',
    description: '不知道做什么？对话梳理方向和行动路径',
    accent: 'plum',
  },
] as const

export interface AiToolSectionProps {
  /** 真值来自 `/assistant/chat` 实测到的 providerLabel，不得写死。 */
  degraded: boolean
  /** 为什么置灰。degraded 为真时必须给，且常驻可见。 */
  degradedReason: string
}

export function AiToolSection({ degraded, degradedReason }: AiToolSectionProps) {
  const navigate = useNavigate()
  const reasonId = useId()

  return (
    <section className="assistant-ai-tools" aria-labelledby="ai-tools-heading" data-ai-tools-degraded={degraded || undefined}>
      <div className="assistant-ai-tools-header">
        <h2 id="ai-tools-heading">AI 专项工具</h2>
        {degraded ? <AiCapabilityChip tone="degraded" /> : <span>直接进入专项 AI 会话</span>}
      </div>

      {/* 原因常驻可见：置灰的按钮自己说不出话，这一行就是它们的解释。 */}
      {degraded && (
        <p className="assistant-ai-tools-reason" id={reasonId}>
          {degradedReason}
        </p>
      )}

      <div className="assistant-ai-tools-grid">
        {AI_TOOLS.map((tool) => {
          const Icon = tool.icon
          return (
            <button
              key={tool.id}
              type="button"
              className={`assistant-ai-tool-card adv-tool--${tool.accent}`}
              // 置灰但保持可聚焦、可读；不绑 onClick，按下去不会有任何副作用。
              aria-disabled={degraded || undefined}
              aria-describedby={degraded ? reasonId : undefined}
              onClick={degraded ? undefined : () => navigate(`/assistant?intent=${tool.id}`)}
            >
              <span className="aat-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="aat-body">
                <strong>{tool.title}</strong>
                <small>{tool.description}</small>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
