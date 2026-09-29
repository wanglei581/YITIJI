import { formatDate } from '@ai-job-print/shared'
import { Card } from '@ai-job-print/ui'
import { CheckCircle2Icon, CircleAlertIcon } from 'lucide-react'
import type { LegalDocVersionView } from '../../services/api/legalDocs'
import { activeVersionOf, docTypeLabel, missingLoginConsentDocs } from './legalDocMeta'

/**
 * 顶部「上线就绪」：四类对外文档各自是否已发布，以及会员登录所需的两份协议是否就绪。
 * 「前台暂无展示位置」是 2026-09-29 按代码核实的现状：一体机 /legal 与小程序协议页只读
 * 用户服务协议与隐私政策，AI 服务说明、经营者信息发布后暂时没有页面展示。
 */
const READINESS_ITEMS: { docType: string; hint: string }[] = [
  { docType: 'terms_of_service', hint: '一体机、小程序协议页与登录勾选' },
  { docType: 'privacy_policy', hint: '一体机、小程序协议页与登录勾选' },
  { docType: 'ai_disclaimer', hint: '前台暂无展示位置' },
  { docType: 'operator_info', hint: '前台暂无展示位置' },
]

export function LegalReadinessCard({ rows }: { rows: LegalDocVersionView[] }) {
  const missing = missingLoginConsentDocs(rows)
  return (
    <Card className="mb-4 p-4">
      <p className="text-sm font-semibold text-neutral-900">上线就绪</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {READINESS_ITEMS.map(({ docType, hint }) => {
          const active = activeVersionOf(rows, docType)
          return (
            <li key={docType} className="rounded-lg border border-neutral-100 px-3 py-2">
              <p className="text-xs text-neutral-500">{docTypeLabel(docType)}</p>
              <p className={['mt-0.5 text-sm font-semibold', active ? 'text-success-fg' : 'text-warning-fg'].join(' ')}>
                {active
                  ? `已发布 ${active.version}（${formatDate(active.publishedAt, '发布时间缺失')}）`
                  : '未发布'}
              </p>
              <p className="mt-0.5 text-xs text-neutral-400">{hint}</p>
            </li>
          )
        })}
      </ul>
      <p
        className={[
          'mt-3 flex items-start gap-1.5 rounded-lg px-3 py-2 text-sm',
          missing.length === 0 ? 'bg-success-bg text-success-fg' : 'bg-warning-bg text-warning-fg',
        ].join(' ')}
      >
        {missing.length === 0 ? (
          <>
            <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            会员登录所需的《用户服务协议》《隐私政策》都已正式发布，生产环境可以登录。
          </>
        ) : (
          <>
            <CircleAlertIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            会员登录所需的协议未就绪：{missing.join('、')}还没有可用的正式发布版本。生产环境下会员暂时无法登录。
          </>
        )}
      </p>
    </Card>
  )
}
