// 继续上次（真实可恢复任务面板）
//
// 归属说明（prototype-v1 首页迁移，2026-07-20）：
// 01-home.html 原型无「继续上次」区块，首页试点按严格 1:1 不渲染本组件。
// 但其业务组件、数据、API 与任务恢复逻辑必须保留——本文件即为保留载体，
// 供后续页面家族或重新批准后复用。请勿删除。
//
// 诚实前提：只对「真实可恢复的任务」展示——① 进行中的打印任务（未达终态）；
// ② 已诊断但尚未优化的简历（下一步）。无可恢复任务不渲染。不伪造进度。
import type { MemberPrintOrderItem, MemberResumeItem } from '@ai-job-print/shared'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../auth/useAuth'
import { KIcon, type KioskIconName } from '../../../components/kiosk-icon'
import { getMyResumes } from '../../../services/api/memberAssets'
import { getMyPrintOrders } from '../../../services/api/memberPrintOrders'

interface ResumeSuggestion {
  kind: 'print' | 'optimize'
  title: string
  detail: string
  actionLabel: string
  onGo: () => void
  icon: KioskIconName
}

const ACTIVE_PRINT_STATUSES = new Set(['pending', 'claimed', 'printing'])
const PRINT_STATUS_TEXT: Record<string, string> = {
  pending: '排队中',
  claimed: '已领取',
  printing: '打印中',
}

export function ContinuePanel() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [suggestion, setSuggestion] = useState<ResumeSuggestion | null>(null)

  useEffect(() => {
    if (!isLoggedIn) {
      setSuggestion(null)
      return
    }
    const token = getToken()
    if (!token) {
      setSuggestion(null)
      return
    }

    let alive = true
    Promise.all([getMyPrintOrders(token, { pageSize: 5 }), getMyResumes(token, { pageSize: 5 })])
      .then(([orders, resumes]) => {
        if (!alive) return
        // 优先级 1：进行中的打印任务（真实未完成）
        const activePrint = orders.items.find((o: MemberPrintOrderItem) => ACTIVE_PRINT_STATUSES.has(o.status))
        if (activePrint) {
          setSuggestion({
            kind: 'print',
            title: '打印任务进行中',
            detail: `${activePrint.fileName ?? '打印文件'} · ${PRINT_STATUS_TEXT[activePrint.status] ?? activePrint.status}`,
            actionLabel: '查看进度',
            onGo: () => navigate('/me/print-orders'),
            icon: 'printer',
          })
          return
        }
        // 优先级 2：已诊断但未优化的简历（真实下一步）
        const diagnosed = resumes.items.find(
          (r: MemberResumeItem) => r.kind === 'parse' && r.status === 'completed' && !r.optimized,
        )
        if (diagnosed) {
          setSuggestion({
            kind: 'optimize',
            title: '上次诊断的简历，可继续优化',
            detail: '已完成诊断 · 一键进入 AI 优化，生成可打印版本',
            actionLabel: '去优化',
            onGo: () =>
              navigate(`/resume/optimize?taskId=${encodeURIComponent(diagnosed.taskId)}`, {
                state: { taskId: diagnosed.taskId },
              }),
            icon: 'sparkle',
          })
          return
        }
        setSuggestion(null)
      })
      .catch(() => {
        if (alive) setSuggestion(null)
      })

    return () => {
      alive = false
    }
  }, [isLoggedIn, getToken, navigate])

  if (!suggestion) return null

  return (
    <section className="continue" aria-label="继续上次">
      <span className="c-icon">
        <KIcon name={suggestion.icon} />
      </span>
      <div className="c-copy">
        <strong>{suggestion.title}</strong>
        <p>{suggestion.detail}</p>
      </div>
      <button type="button" className="btn primary lg" onClick={suggestion.onGo}>
        {suggestion.actionLabel}
        <KIcon name="arrow" />
      </button>
    </section>
  )
}
