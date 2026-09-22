import type { ElementType, ReactNode } from 'react'
import type { CareerPlanResponse } from '@ai-job-print/shared'
import { ArrowRightIcon, BotIcon, PencilLineIcon, TargetIcon } from 'lucide-react'
import { AiDisclaimerLine, AiTaskRegion, EvidenceBadge, type AiTaskFallback, type AiTaskStatus } from '../../../../ai'
import { Waiting } from '../../jobFit/jobFitQxKit'

/**
 * 求职方案的一栏（已有材料 / 目标与方向 / 尚需准备 / 执行计划，及其余说明栏）。
 * 青序流光版（稿 46 ?screen=career-plan），样式在 resume-decision-qx.css 的 .rdq-col。
 * `data-career-plan-column` 是失败隔离断言的稳定地标：材料栏读失败时其余三栏必须照常在。
 */
export function CareerPlanSection({
  title,
  Icon,
  column,
  children,
}: {
  title: string
  Icon: ElementType
  column?: string
  children: ReactNode
}) {
  return (
    <section className="rdq-col" data-career-plan-column={column}>
      <div className="rdq-col-head">
        <span className="rdq-col-ic" aria-hidden="true"><Icon /></span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  )
}

/**
 * 已落库规划的三栏正文（目标与方向 / 尚需准备 / 执行计划）。只摆服务端返回的字段：
 * AI 结论标 E3、简历原句标 E1；某栏为空就留空，不补默认条目。
 */
export function CareerPlanColumns({ plan }: { plan: CareerPlanResponse }) {
  return (
    <>
      <CareerPlanSection title="目标与方向" Icon={TargetIcon} column="directions">
        <div className="rdq-ai">
          <AiDisclaimerLine>下面每条结论都是 AI 从你的简历正文读出来的，下方原文是你自己写的那句话。</AiDisclaimerLine>
        </div>
        <ul className="rdq-items">
          {(plan.currentSnapshot ?? []).map((item) => (
            <li key={item.point} className="rdq-item">
              <b><EvidenceBadge level="E3" />{item.point}</b>
              <small><EvidenceBadge level="E1" compact /> 简历原文：{item.evidence}</small>
            </li>
          ))}
        </ul>
        {(plan.directions ?? []).map((direction, index) => (
          <div key={direction.title} className="rdq-direction">
            <span aria-hidden="true">{index + 1}</span>
            <div>
              <h3><EvidenceBadge level="E3" />{direction.title}</h3>
              <p>为什么适合：{direction.why}</p>
              <p><strong>第一步：</strong>{direction.firstStep}</p>
            </div>
          </div>
        ))}
        <p className="rdq-muted">不是建议你转，是列出来供你自己判断。</p>
      </CareerPlanSection>

      <CareerPlanSection title="尚需准备" Icon={PencilLineIcon} column="prepare">
        <ul className="rdq-items">
          {(plan.skillPlan ?? []).map((item) => (
            <li key={item.skill} className="rdq-item">
              <b><span className="rdq-item-tag">{item.timeframe}</span><EvidenceBadge level="E3" />{item.skill}</b>
              <p>{item.action}</p>
            </li>
          ))}
        </ul>
      </CareerPlanSection>

      <CareerPlanSection title="执行计划" Icon={ArrowRightIcon} column="actions">
        <ol className="rdq-checklist">
          {(plan.actionChecklist ?? []).map((item) => <li key={item}>{item}</li>)}
        </ol>
      </CareerPlanSection>
    </>
  )
}

/**
 * 22-career-plan.html 的 ai-down 支线：AI 挂了也有三件事是用户自己能做的。
 * 它**不是**职业规划的等价替代（原型自己写着「通用建议，不是针对你这份简历的」），
 * 所以单独成节，不冒充 manual 降级路径；页面只在**真的 ai-down**时挂它。
 */
export function CareerPlanSelfCheck() {
  return (
    <CareerPlanSection title="不靠 AI 也能自己看的三件事" Icon={PencilLineIcon}>
      <ol className="rdq-checklist">
        <li>技能栏里没有事例撑着的词，先删掉 ——「团队协作」「项目管理」这类，正文里找不到对应的事就是虚的。这个判断不用 AI，你自己对着简历看一遍就知道。</li>
        <li>每段经历问自己一句「结果是什么」—— 写了做什么、没写做成什么，是最常见的一处。有数字写数字，没数字写变化。</li>
        <li>会做但简历里没写的，去简历工作台补上 —— 本机读不到的能力不是你不会，是简历没写。</li>
      </ol>
      <p className="rdq-muted">这三条是通用建议，不是针对你这份简历的 —— 本机现在读不到它。AI 恢复后再来，能给出按你原文逐条对应的版本。</p>
    </CareerPlanSection>
  )
}

/**
 * 「生成求职方案」这一个 AI 任务面：按 data-aitask 四态渲染，下方挂生成这一跳的非能力级失败。
 * 还没有规划的四屏（guide / generating / ai-down / failed）用首次生成版，idle 态先讲清四栏各是什么；
 * 已有规划时用 `regenerate` 版，只治理「再生成一次」—— 规划正文是已落库的成品，渲染在这块之外。
 * 降级处置 `fallback` 由页面按真实故障派生后传进来，本件只负责摆放。
 */
export function CareerPlanGenerateRegion({ task, fallback, error, regenerate = false }: {
  task: AiTaskStatus
  fallback: AiTaskFallback
  /** 生成这一跳的非能力级失败（留在当前屏）。 */
  error: string | null
  regenerate?: boolean
}) {
  return (
    <div className="rdq-ai">
      <AiTaskRegion
        task={task}
        label={regenerate ? '重新生成求职方案' : 'AI 生成求职方案'}
        running={(
          <Waiting
            icon={<BotIcon size={34} />}
            title="生成请求已提交给服务端"
            desc="正在读你的简历，整理方向与缺口。进度由后端任务状态决定，本页不会自己把它走完。"
            tag="整体等待中，没有百分比"
          />
        )}
        fallback={fallback}
        idle={regenerate ? undefined : (
          <>
            <ul className="rdq-guide-list">
              <li>已有材料：来自你已保存的简历与文档，不经过模型。</li>
              <li>目标与方向：提供 1–3 个建议及可开始的第一步。</li>
              <li>尚需准备：按阶段整理技能缺口。</li>
              <li>执行计划：近期可动手的清单。</li>
            </ul>
            <AiDisclaimerLine>方向、缺口和行动清单都由 AI 判断，仅供参考；硬门槛（证书等）与「简历漏写」会分开写，不混成一句「你不行」。</AiDisclaimerLine>
            <p className="rdq-muted">岗位匹配或模拟面试已完成时，会在真实数据可用的范围内帮助建议更具体；没有也能直接生成。</p>
          </>
        )}
      >
        {regenerate ? <p className="rdq-muted">这份规划已经生成并存好，打印不依赖 AI；简历更新之后可以回来重新生成一次。</p> : null}
      </AiTaskRegion>
      {error ? <p className="jfq-alert" role="alert">{error}</p> : null}
    </div>
  )
}
