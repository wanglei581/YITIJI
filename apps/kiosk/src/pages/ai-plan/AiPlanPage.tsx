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

const DEFAULT_PLAN: Required<PlanState> = {
  goal: '找到匹配的全职岗位，完善求职材料',
  hasMaterials: ['在读/毕业证明', '个人经历草稿'],
  gaps: ['简历PDF格式文件', '证件照（电子版）'],
  steps: [
    { title: '完善并打印简历', desc: '上传或新建简历，AI诊断优化后打印 A4 版', route: '/resume/source' },
    { title: '查找岗位信息', desc: '浏览第三方平台同步的岗位，用手机扫码前往投递', route: '/jobs' },
    { title: '打印求职材料', desc: '一键打印简历 + 求职附件，完整求职包', route: '/print/upload' },
  ],
}

export function AiPlanPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as PlanState | null
  const plan: Required<PlanState> = {
    goal: state?.goal ?? DEFAULT_PLAN.goal,
    hasMaterials: state?.hasMaterials ?? DEFAULT_PLAN.hasMaterials,
    gaps: state?.gaps ?? DEFAULT_PLAN.gaps,
    steps: state?.steps ?? DEFAULT_PLAN.steps,
  }

  return (
    <KioskPageFrame
      className="kpv1 kpv1--content-only"
      title="AI方案确认"
      subtitle="小青已理解你的目标"
      onBack={() => navigate(-1)}
      backLabel="返回"
      actionbar={
        <div style={{ display: 'flex', gap: 16, padding: '0 24px', width: '100%' }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              flex: '0 0 auto',
              minHeight: 64,
              padding: '0 36px',
              borderRadius: 'var(--pv-r-sm)',
              border: '2px solid var(--pv-line)',
              background: 'var(--pv-surface)',
              color: 'var(--pv-ink)',
              fontSize: 22,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--pv-sans)',
            }}
          >
            调整方案
          </button>
          <button
            type="button"
            onClick={() => navigate('/assistant')}
            style={{
              flex: 1,
              minHeight: 64,
              padding: '0 36px',
              borderRadius: 'var(--pv-r-sm)',
              border: 'none',
              background: 'var(--pv-teal)',
              color: 'var(--pv-paper)',
              fontSize: 22,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--pv-sans)',
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
      {/* AI 理解 banner */}
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
            小青已理解你的需求
          </div>
          <div style={{ fontSize: 17, color: 'var(--pv-muted)', marginTop: 4 }}>
            以下方案基于你的情况生成，可点击「调整方案」重新说明
          </div>
        </div>
      </div>

      {/* 理解区：三列 */}
      <div
        style={{
          marginTop: 20,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 14,
        }}
      >
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 14, color: 'var(--pv-muted)', marginBottom: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>
            你的目标
          </div>
          <div style={{ fontSize: 19, fontWeight: 600, color: 'var(--pv-teal-deep)', lineHeight: 1.45 }}>
            {plan.goal}
          </div>
        </div>

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
      </div>

      {/* 执行计划步骤 */}
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
    </KioskPageFrame>
  )
}
