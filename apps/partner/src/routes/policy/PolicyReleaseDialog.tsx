import { useEffect, useState } from 'react'
import { Button } from '@ai-job-print/ui'
import { ApiHttpError } from '../../services/api/client'
import { partnerPoliciesService, type PartnerPolicyRecord } from '../../services/api/policies'

/** 只使用政策服务从 error.message 解析出的原因，缺失时不展示技术信息。 */
function errMsg(e: unknown): string {
  if (e instanceof ApiHttpError) {
    const message = e.message.trim()
    // 只放行服务端写的中文原因；纯英文技术串（如政策被并发删掉时的「Policy xx not found」）换成兜底句。
    if (message && /[\u4e00-\u9fff]/.test(message)) return message
  }
  return '这次没发布成功，请稍后再试；多次失败请联系平台管理员'
}

/**
 * 政策发布与发布责任确认（3.13）。
 *
 * 政策由本机构自己审核、发布并署名，管理员只保留紧急下架。发布前必须由操作者勾选确认
 * 「本机构作为发布者对这一版本的内容负责」；服务端审计记下确认人、时间与 contentVersion。
 * 勾选状态原样提交给服务端判定，不替用户默认勾上；发布是否生效只按服务端返回的状态说话。
 */
export function PolicyReleaseDialog({
  policy,
  onClose,
  onReleased,
}: {
  policy: PartnerPolicyRecord | null
  onClose: () => void
  onReleased: (updated: PartnerPolicyRecord) => void
}) {
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const policyKey = policy ? `${policy.id}:${policy.contentVersion ?? ''}` : null
  useEffect(() => {
    setAcknowledged(false)
    setBusy(false)
    setError(null)
  }, [policyKey])

  if (!policy) return null

  const version = policy.contentVersion
  const versionLabel = typeof version === 'number' ? `v${version}` : '当前版本'
  const publisher = policy.sourceName || '本机构'

  const release = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await partnerPoliciesService.releasePolicy(policy.id, { responsibilityAcknowledged: acknowledged })
      if (updated.publishStatus !== 'published') {
        setError('这次没发布成功，请稍后再试；多次失败请联系平台管理员')
        return
      }
      onReleased(updated)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-release-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface p-6 shadow-xl">
        <h2 id="policy-release-title" className="text-base font-semibold text-neutral-900">发布政策</h2>
        <p className="mt-1 text-sm text-neutral-700">「{policy.title}」</p>
        <dl className="mt-3 grid grid-cols-[5.5rem_1fr] gap-y-1.5 rounded-lg bg-neutral-50 px-4 py-3 text-sm">
          <dt className="text-neutral-500">发布机构</dt>
          <dd className="text-neutral-800">{publisher}</dd>
          <dt className="text-neutral-500">内容版本</dt>
          <dd className="font-medium tabular-nums text-neutral-800">{versionLabel}</dd>
        </dl>

        <p className="mt-3 text-xs leading-relaxed text-neutral-600">
          发布后展示这一版本（对应一体机首页「查政策」），并标注由{publisher}发布。平台不审核、不代发政策，只在违法违规等紧急情况下单向下架。之后如需修改，保存修改会生成新的内容版本并自动撤下、回到待审核，须重新审核通过并确认发布后才会再展示。
        </p>

        <ul aria-label="发布前提" className="mt-3 space-y-1 text-xs text-neutral-600">
          <li>{policy.kind === 'policy_guide'
            ? [policy.whoCanApply, policy.requiredMaterials, policy.whereToApply].every((value) => value?.trim())
              ? '谁可以申请、要准备的材料、去哪办：已填齐'
              : '谁可以申请、要准备的材料、去哪办：未填齐，发布时会被拦下'
            : '政策公告无需填写谁可以申请、要准备的材料、去哪办'}</li>
          <li>{policy.externalUrl?.trim()
            ? policy.externalUrlVerified === true ? '原文链接已通过官方网站核对' : '原文链接还没通过官方网站核对，发布时会被拦下'
            : policy.kind === 'policy_guide' ? '原文链接未填写，发布时会被拦下' : '原文链接未填写（政策公告可选）'}</li>
        </ul>

        <label className="mt-4 flex items-start gap-2.5 rounded-lg border border-primary-200 bg-primary-50/40 px-3 py-3 text-sm text-neutral-800">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0"
            checked={acknowledged}
            disabled={busy}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span>
            我代表「{publisher}」确认：这条政策（{versionLabel}）的内容已核对，由本机构作为发布者对其真实性与合规性负责。
          </span>
        </label>

        {error && (
          <p className="mt-3 rounded-lg bg-error-bg px-3 py-2 text-sm text-error-fg" role="alert">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button size="sm" variant="primary" onClick={() => void release()} disabled={busy || !acknowledged}>
            {busy ? '发布中…' : '确认发布'}
          </Button>
        </div>
      </div>
    </div>
  )
}
