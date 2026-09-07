import { useEffect, useState } from 'react'
import type { ResumeExportPricing } from '@ai-job-print/shared'
import { isRedeemableForPrint } from '../../../../services/api/benefits'
import { getResumeExportPricing, type ResumeReadAccess } from '../../../../services/api/ai'
import { getMyBenefits } from '../../../../services/api/memberFavorites'
import { userMessageOf } from '../../../../services/api/userErrorMessage'

export function useResumeExportPricing(access: ResumeReadAccess, token: string | null) {
  const [pricing, setPricing] = useState<ResumeExportPricing | null>(null)
  const [pricingError, setPricingError] = useState<string | null>(null)
  const [benefitGrantId, setBenefitGrantId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const memberToken = access.token
  const accessToken = access.accessToken

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setPricingError(null)
    getResumeExportPricing({ token: memberToken, accessToken })
      .then(async (row) => {
        if (cancelled) return
        setPricing(row)
        if (row.mode !== 'charged' || !token || !row.benefit || row.benefit.available <= 0) {
          setBenefitGrantId(undefined)
          return
        }
        const page = await getMyBenefits(token, { pageSize: 50 })
        if (cancelled) return
        const now = Date.now()
        const grant = page.items.find((item) => isRedeemableForPrint(item, now))
        setBenefitGrantId(grant?.id)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPricing(null)
        setBenefitGrantId(undefined)
        setPricingError(userMessageOf(err, '导出价格这次没读取到，导出暂不可用'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [memberToken, accessToken, token])

  const chargedBlocked = pricing?.mode === 'charged' && (!pricing.benefit || pricing.benefit.available <= 0 || !benefitGrantId)
  const unavailable = pricing?.mode === 'unavailable' || Boolean(pricingError) || (!loading && !pricing)
  const blockedReason = pricingError
    ?? (pricing?.mode === 'unavailable' ? (pricing.label || '简历导出当前不可用（价目已停用，不是免费）') : null)
    ?? (chargedBlocked
      ? (!token
        ? '收费导出需登录会员账号并核销 1 次权益'
        : '当前没有可用的导出权益，导出按钮不可用')
      : null)

  return { pricing, pricingError, benefitGrantId, loading, chargedBlocked, unavailable, blockedReason }
}
