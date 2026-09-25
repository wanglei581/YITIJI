import { useState } from 'react'
import { ZapOffIcon } from 'lucide-react'
import { CircuitBreakDialog, type CircuitBreakTarget } from '../components/recruitment/CircuitBreakDialog'

/**
 * 机构详情抽屉里的「按机构熔断」（3.13）。
 *
 * 应急处置，不是日常批量工具：一次只熔断一家机构，必选事由、填写说明并勾选不可撤销。
 * 熔断把该机构名下的招聘类内容与政策全部下架并锁定，今后不能再发布或同步，平台没有恢复入口。
 * 与招聘内容托管开关无关，两种部署都提供。单条内容的处置在各信息源页用「紧急下架」。
 */
export function OrgCircuitBreakPanel({
  orgId,
  orgName,
  onChanged,
}: {
  orgId: string
  orgName: string
  onChanged: () => void
}) {
  const [target, setTarget] = useState<CircuitBreakTarget | null>(null)

  return (
    <section aria-label="按机构熔断" className="space-y-2 rounded-lg border border-error/20 bg-error-bg/30 p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-800">
        <ZapOffIcon className="h-4 w-4 text-error-fg" aria-hidden="true" />
        紧急处置：按机构熔断
      </p>
      <p className="text-xs leading-relaxed text-neutral-600">
        只在违法内容、主管部门要求等紧急情况下使用，不是日常批量工具。熔断后这家机构名下的岗位、招聘会、企业资料、线下机构与政策全部下架并锁定，今后不能再发布或同步，不可撤销；受影响的内容会逐条通知机构。只处置单条内容时，请到对应信息源页用「紧急下架」。
      </p>
      <button
        type="button"
        onClick={() => setTarget({ scope: 'org', id: orgId, name: orgName })}
        className="rounded-lg border border-error/40 bg-surface px-3 py-1.5 text-xs font-semibold text-error-fg hover:bg-error-bg"
      >
        按机构熔断…
      </button>
      <CircuitBreakDialog target={target} onClose={() => setTarget(null)} onDone={() => onChanged()} />
    </section>
  )
}
