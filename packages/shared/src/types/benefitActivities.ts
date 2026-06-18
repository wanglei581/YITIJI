import type { BenefitSourceType, BenefitType } from './memberBenefits'

export type BenefitActivityStatus = 'draft' | 'published' | 'ended'
export type BenefitActivityType = BenefitType
export type BenefitActivitySourceType = BenefitSourceType

export interface BenefitActivityListItem {
  id: string
  title: string
  description: string | null
  rulesText: string | null
  benefitType: BenefitActivityType
  sourceType: BenefitActivitySourceType
  quantityTotal: number | null
  stockTotal: number | null
  stockRemaining: number | null
  claimLimitPerUser: number
  status: BenefitActivityStatus
  validFrom: string | null
  validUntil: string | null
  grantValidDays: number | null
  claimable: boolean
  claimed: boolean
  soldOut: boolean
  ended: boolean
  createdAt: string
  updatedAt: string
}
