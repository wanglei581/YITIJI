import { PROHIBITED_MODULES, type ProhibitedModule } from '@ai-job-print/shared'

const LABELS: Record<ProhibitedModule, string> = {
  in_platform_apply: '禁止在平台内投递',
  candidate_management: '禁止管理候选人',
  resume_delivery_to_enterprise: '禁止向企业推送简历',
  interview_invitation: '禁止向求职者发出企业面试邀约',
  offer_management: '禁止管理企业录用通知',
}

export function ComplianceRestrictions() {
  return <div className="flex flex-wrap gap-1.5">
    {PROHIBITED_MODULES.map((code) => <span key={code} title={code} className="rounded bg-error-bg px-2 py-0.5 text-xs text-error-fg">{LABELS[code]}</span>)}
  </div>
}
