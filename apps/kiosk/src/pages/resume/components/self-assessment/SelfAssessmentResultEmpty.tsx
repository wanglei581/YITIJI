// 自我探索结果页：还没有完成结果时的三块说明，以及同一支上的等待 / 失败壳。
//
// 「还没有可查看的完成结果」「为什么会这样」「这次作答现在的状态」「不显示你打开的链接参数内容」
// 由 SelfAssessmentFlow.tsx 传入 —— 同意来源门禁只扫那个文件。
// 本文件的其余句子没被那条门禁钉住。临床词扫描不覆盖这里（名单在 services，本批不改）；
// 仓库根 verify-compliance-copy 扫整个 apps/kiosk/src。

import type { ReactNode } from 'react'
import { AiTaskRegion, type AiTaskFallback, type AiTaskStatus } from '../../../../ai'
import { SaCard, SaChips, SaFlow, SaFrame, SaPicks } from './SelfAssessmentQxKit'
import {
  SelfAssessmentNowCard,
  SelfAssessmentParamNotice,
  SelfAssessmentWhyCard,
  type SaExitItem,
} from './SelfAssessmentInterceptFacts'

type SaFrameBase = {
  title: string
  eyebrow: string
  rail: readonly string[]
  steps?: readonly { readonly n: string; readonly text: string }[]
}

function GhostButton({ label, route, onClick }: { label: string; route?: string; onClick: () => void }) {
  return (
    <button type="button" className="qx-btn" data-variant="ghost" data-route={route} onClick={onClick}>{label}</button>
  )
}

function PrimaryButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="qx-btn" data-variant="primary" data-testid="self-assessment-primary" onClick={onClick}>{label}</button>
  )
}

function ResultEmptyPanels({
  whyHead,
  nowHead,
  consented,
  done,
  total,
}: {
  whyHead: string
  nowHead: string
  consented: boolean
  done: number
  total: number
}) {
  return (
    <>
      <SelfAssessmentWhyCard
        head={whyHead}
        facts={[
          { key: 'f1', step: '事实 1', desc: `完成页只在本次 ${total} 题答满并明确提交后才显示。`, current: true },
          { key: 'f2', step: '事实 2', desc: '直接打开完成页的链接不会放行，也不会补一个结果给你看。' },
          { key: 'f3', step: '事实 3', desc: '之前的作答如果还在，可以接着答完再提交。' },
        ]}
      />
      <SelfAssessmentNowCard head={nowHead} consented={consented} done={done} total={total} submitted={false} />
      <SaCard head="答满并提交之后，这一页会列出" hint="现在没有这些内容，也不展示示例">
        <SaFlow items={[
          { key: 'cov', step: '会列出', title: '五个方向的强弱', current: true, desc: '按固定规则从你的选择算出，不经过 AI。现在没有作答，这里不显示数字。' },
          { key: 'read', step: '会列出', title: 'AI 解读', desc: '只在真的生成之后出现。这次没有提交，不会写一段看起来像结论的话。' },
          { key: 'print', step: '会列出', title: '打印与撤回', desc: '生成 PDF、送到打印工作台，或撤回这一次，都要等结果真实存在。' },
        ]} />
      </SaCard>
    </>
  )
}

export function SelfAssessmentResultPending({
  frame,
  inflight,
  failure,
  task,
  fallback,
  taskAiDown,
  consentOk,
  done,
  total,
  whyHead,
  nowHead,
  paramLead,
  emptyHead,
  resumeRoute,
  onHome,
  onResume,
  onIntro,
  exits,
}: {
  frame: SaFrameBase
  inflight: 'submit' | 'fetch' | null
  failure: string | null
  task: AiTaskStatus
  fallback: AiTaskFallback
  taskAiDown: boolean
  consentOk: boolean
  done: number
  total: number
  whyHead: string
  nowHead: string
  paramLead: string
  emptyHead: string
  resumeRoute: string
  onHome: () => void
  onResume: () => void
  onIntro: () => void
  exits: readonly SaExitItem[]
}) {
  const state = inflight === 'submit' ? 'submitting' : inflight === 'fetch' ? 'fetching' : failure ? 'result-error' : 'result-empty'
  const ask: ReactNode = inflight
    ? <>请稍候，<em>这一步还在等结果</em>。</>
    : failure
      ? <>这次<em>没能拿到结果</em>。</>
      : <>这一步<em>还打不开</em>。</>
  const doing: ReactNode = inflight
    ? <>页面不设倒计时，也不会自己变成「完成」；<b>只有系统真实返回才会换屏。</b></>
    : failure
      ? <>失败原因写在下面。<b>页面不会用别的东西顶上，也不会假装已完成。</b></>
      : <>这次作答没有「答满并提交」的标记。<b>页面不会跳过这一步，也不会补一个假结果给你看。</b></>

  return (
    <SaFrame
      {...frame}
      screen="resume-self-assessment-result"
      state={state}
      status={inflight
        ? { tone: 'unknown', label: inflight === 'submit' ? '正在生成' : '正在读取' }
        : failure
          ? { tone: 'bad', label: '这次没拿到结果' }
          : { tone: 'unknown', label: '无最近结果' }}
      ask={ask}
      doing={doing}
      back={{ label: '返回简历服务', onBack: onResume }}
      ctabar={failure && taskAiDown ? (
        <>
          <GhostButton label="返回首页" route="/" onClick={onHome} />
          <PrimaryButton label="返回简历服务" onClick={onResume} />
        </>
      ) : (
        <>
          <GhostButton label="返回简历服务" route={resumeRoute} onClick={onResume} />
          <PrimaryButton label={failure ? '重新作答' : '去看说明并开始'} onClick={onIntro} />
        </>
      )}
    >
      <AiTaskRegion task={task} label="AI 陈述式解读" className="sa-ai-region" fallback={fallback}
        running={
          <SaCard head={inflight === 'submit' ? '正在生成本次解读' : '正在读取这次结果'} hint="等系统真实返回">
            <p className="sa-sub" data-ai-progress="true">
              {inflight === 'submit'
                ? '维度强度由固定权重当场算出，解读由 AI 写 —— 这一步在等系统的真实返回，页面不设倒计时，也不会自己变成「完成」。'
                : '正在按记录编号读回本次结果。'}
            </p>
          </SaCard>
        }
        idle={
          <SaCard head={emptyHead} hint="这次作答没有「答满并提交」的标记" tone="down" testId="self-assessment-recover">
            <SaChips
              items={[
                { key: 'none', text: <>当前入口<b>不放行</b></>, tone: 'warn' },
                { key: 'keep', text: '已有作答不会被清空' },
                { key: 'noguess', text: '不生成任何结果' },
              ]}
            />
            <p className="sa-sub">这不是错误提示，而是这一步本来就有前置条件。结果只在本机保留 24 小时，过期会自动清理。按下面任意一个出口继续即可。</p>
          </SaCard>
        }
      />
      {state === 'result-empty' ? (
        <ResultEmptyPanels
          whyHead={whyHead}
          nowHead={nowHead}
          consented={consentOk}
          done={done}
          total={total}
        />
      ) : null}
      <SaCard head="现在可以做什么" hint="都是现在就能打开的入口">
        <SaPicks items={exits} />
      </SaCard>
      {state === 'result-empty' ? <SelfAssessmentParamNotice lead={paramLead} /> : null}
    </SaFrame>
  )
}
