// ============================================================
// AiPlanPage — AI 方案确认页。
//
// ⚠ 这一页此前整页伪造：DEFAULT_PLAN 写死了用户的「目标」「已有材料」
// 「尚需准备」，页头还写「小青已理解你的目标」，而本文件不 import 任何
// services/api，全站也没有任何导航指向 /ai/plan（见下）。因此 100% 的渲染
// 都是那段假内容 —— 直接违反 CLAUDE.md §9「不伪造能力」。
// 定位与判定见 docs/reviews/kiosk-control-integrity-audit-2026-08-16.md §3.5 / §4.2
// 与 docs/reviews/legacy-capability-inventory-2026-08-16.md（判定：伪造内容，勿接线）。
//
// 为什么不接后端：现有 /advisor 系列 10 个端点产出的是
// qa_pins（问答留痕）/ slot_draft（自我介绍初稿）/ compare_report（逐条要求比对），
// 三种产物都没有 goal、没有 hasMaterials、没有 steps —— 后端无法诚实填满
// 这一页的「目标 / 已有材料 / 尚需准备 / 执行计划」版式。硬接等于换一种方式编。
// 真要做这个能力，应按三种真实产物重新设计页面，不是给旧版式补数据。
//
// 为什么不删页：verify-fusion-w6.mjs 对 104 条路由做 deepEqual 冻结
// （apps/kiosk/scripts/verify-fusion-w6.mjs:236-266），删路由会同时打红三处断言。
//
// 现在的口径：只渲染调用方真的传进来的方案；没有就如实说没有，不替用户编。
// h1「AI方案确认」为视觉回归夹具锚点（tests/visual/fixtures/fusion-w6-route-cases.ts:123），
// 保持不变。
// ============================================================

import { useLocation, useNavigate } from 'react-router-dom'
import { KioskPageFrame } from '@ai-job-print/ui'
import { ArrowRightIcon, CheckIcon, AlertCircleIcon, ClipboardListIcon } from 'lucide-react'
import '../../styles/prototype-v1.css'

interface PlanStep {
  title: string
  desc: string
  route?: string
}

interface PlanState {
  goal?: string
  hasMaterials?: string[]
  gaps?: string[]
  steps?: PlanStep[]
}

/** 调用方带来的方案。任何一项有真实内容才算「收到了方案」，否则一律走空态。 */
function resolvePlan(state: PlanState | null): Required<PlanState> | null {
  if (!state) return null
  const goal = state.goal?.trim() ?? ''
  const hasMaterials = state.hasMaterials?.filter((item) => item.trim().length > 0) ?? []
  const gaps = state.gaps?.filter((item) => item.trim().length > 0) ?? []
  const steps = state.steps?.filter((step) => step.title.trim().length > 0) ?? []
  if (!goal && hasMaterials.length === 0 && gaps.length === 0 && steps.length === 0) return null
  return { goal, hasMaterials, gaps, steps }
}

const BTN_BASE = {
  minHeight: 64,
  padding: '0 36px',
  borderRadius: 'var(--pv-r-sm)',
  fontSize: 22,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'var(--pv-sans)',
} as const

export function AiPlanPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const plan = resolvePlan(location.state as PlanState | null)

  if (!plan) return <EmptyPlan onBack={() => navigate(-1)} onAssistant={() => navigate('/assistant')} />

  return (
    <KioskPageFrame
      className="kpv1 kpv1--content-only"
      title="AI方案确认"
      subtitle="确认下面这份方案"
      onBack={() => navigate(-1)}
      backLabel="返回"
      actionbar={
        <div style={{ display: 'flex', gap: 16, padding: '0 24px', width: '100%' }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              ...BTN_BASE,
              flex: '0 0 auto',
              border: '2px solid var(--pv-line)',
              background: 'var(--pv-surface)',
              color: 'var(--pv-ink)',
            }}
          >
            调整方案
          </button>
          <button
            type="button"
            onClick={() => navigate('/assistant')}
            style={{
              ...BTN_BASE,
              flex: 1,
              border: 'none',
              background: 'var(--pv-teal)',
              color: 'var(--pv-paper)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            按这个方案继续
            <ArrowRightIcon aria-hidden="true" style={{ width: 24, height: 24 }} />
          </button>
        </div>
      }
    >
      {/* 说明条：只说这份方案从哪来、能不能改，不声称「已理解你的需求」。 */}
      <div
        style={{
          margin: '4px 0 0',
          padding: '16px 22px',
          background: 'var(--pv-teal-soft)',
          borderRadius: 'var(--pv-r-md)',
          border: '1px solid color-mix(in srgb, var(--pv-teal) 30%, transparent)',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            flexShrink: 0,
            background: 'var(--pv-teal)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--pv-paper)',
          }}
        >
          <ClipboardListIcon aria-hidden="true" style={{ width: 26, height: 26 }} />
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--pv-ink)', letterSpacing: 1 }}>
            以下内容来自上一步带过来的方案
          </div>
          <div style={{ fontSize: 17, color: 'var(--pv-muted)', marginTop: 4 }}>
            AI 判断，仅供参考；不对不全都可以点「调整方案」回去重说
          </div>
        </div>
      </div>

      {/* 理解区：三列。每一列只在真的收到对应内容时才出现 ——
          空列会被读成「AI 认定你什么材料都没有」，那也是一句假话。 */}
      <div
        style={{
          marginTop: 20,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 14,
        }}
      >
        {plan.goal && (
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 14, color: 'var(--pv-muted)', marginBottom: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>
            你的目标
          </div>
          <div style={{ fontSize: 19, fontWeight: 600, color: 'var(--pv-teal-deep)', lineHeight: 1.45 }}>
            {plan.goal}
          </div>
        </div>
        )}

        {plan.hasMaterials.length > 0 && (
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 14, color: 'var(--pv-muted)', marginBottom: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>
            已有材料
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {plan.hasMaterials.map((item) => (
              <li
                key={item}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, color: 'var(--pv-ink)' }}
              >
                <CheckIcon
                  aria-hidden="true"
                  style={{ width: 18, height: 18, color: 'var(--pv-teal)', flexShrink: 0 }}
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
        )}

        {plan.gaps.length > 0 && (
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 14, color: 'var(--pv-muted)', marginBottom: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>
            尚需准备
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {plan.gaps.map((item) => (
              <li
                key={item}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, color: 'var(--pv-ink)' }}
              >
                <AlertCircleIcon
                  aria-hidden="true"
                  style={{ width: 18, height: 18, color: 'var(--pv-clay)', flexShrink: 0 }}
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
        )}
      </div>

      {/* 执行计划步骤 */}
      {plan.steps.length > 0 && (
      <div style={{ marginTop: 24 }}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            fontFamily: 'var(--pv-serif)',
            color: 'var(--pv-ink)',
            letterSpacing: 1,
            marginBottom: 14,
          }}
        >
          推荐执行计划
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {plan.steps.map((step, i) => (
            <div
              key={step.title}
              className="card"
              style={{ padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 18 }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: 'var(--pv-teal)',
                  color: 'var(--pv-paper)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  fontWeight: 700,
                }}
              >
                {i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 21, fontWeight: 600, color: 'var(--pv-ink)', letterSpacing: 0.5 }}>
                  {step.title}
                </div>
                <div style={{ fontSize: 16, color: 'var(--pv-muted)', marginTop: 4 }}>
                  {step.desc}
                </div>
              </div>
              {step.route != null && (
                <ArrowRightIcon
                  aria-hidden="true"
                  style={{ width: 22, height: 22, color: 'var(--pv-muted)', flexShrink: 0 }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      )}
    </KioskPageFrame>
  )
}

/**
 * 没收到方案时的诚实空态。
 *
 * 这是当前 100% 的渲染路径：全站没有任何导航带 state 指向 /ai/plan
 * （grep "'/ai/plan'" apps/kiosk/src 无结果，只有路由注册与测试夹具命中）。
 * 旧实现在这条路径上回落 DEFAULT_PLAN，把「在读/毕业证明」「缺简历PDF、证件照」
 * 当成用户的真实处境展示出来。这里改成如实说没有，并把用户导向真的能说话的地方。
 */
function EmptyPlan({ onBack, onAssistant }: { onBack: () => void; onAssistant: () => void }) {
  return (
    <KioskPageFrame
      className="kpv1 kpv1--content-only"
      title="AI方案确认"
      subtitle="暂无待确认的方案"
      onBack={onBack}
      backLabel="返回"
      actionbar={
        <div style={{ display: 'flex', gap: 16, padding: '0 24px', width: '100%' }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              ...BTN_BASE,
              flex: '0 0 auto',
              border: '2px solid var(--pv-line)',
              background: 'var(--pv-surface)',
              color: 'var(--pv-ink)',
            }}
          >
            返回
          </button>
          <button
            type="button"
            onClick={onAssistant}
            style={{
              ...BTN_BASE,
              flex: 1,
              border: 'none',
              background: 'var(--pv-teal)',
              color: 'var(--pv-paper)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            去和小青说说你的情况
            <ArrowRightIcon aria-hidden="true" style={{ width: 24, height: 24 }} />
          </button>
        </div>
      }
    >
      <div
        className="card"
        style={{
          marginTop: 4,
          padding: '48px 32px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 16,
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 18,
            background: 'var(--pv-teal-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--pv-teal)',
          }}
        >
          <ClipboardListIcon aria-hidden="true" style={{ width: 36, height: 36 }} />
        </div>
        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--pv-ink)', letterSpacing: 1 }}>
          还没有可确认的方案
        </div>
        <p style={{ fontSize: 18, color: 'var(--pv-muted)', lineHeight: 1.6, maxWidth: 560, margin: 0 }}>
          这一页只显示上一步真的带过来的方案内容。本机没有收到任何方案，也不会替你猜目标、
          猜已有材料或猜还缺什么。
        </p>
        <p style={{ fontSize: 18, color: 'var(--pv-muted)', lineHeight: 1.6, maxWidth: 560, margin: 0 }}>
          想让 AI 帮你理一理，先去和顾问「小青」说说你的情况；打印、扫描、简历、岗位这些
          事情也可以直接从首页各自的入口办，不需要先有方案。
        </p>
      </div>
    </KioskPageFrame>
  )
}
