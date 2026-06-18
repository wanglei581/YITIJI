export const BENEFIT_ACTIVITY_STATUS = ['draft', 'published', 'ended'] as const
export const BENEFIT_ACTIVITY_TYPES = ['coupon', 'free_quota', 'package_entitlement', 'subsidy_eligibility_hint'] as const
export const BENEFIT_ACTIVITY_SOURCE_TYPES = ['platform', 'campus', 'gov', 'fair', 'partner'] as const

export type BenefitActivityStatus = typeof BENEFIT_ACTIVITY_STATUS[number]
export type BenefitActivityType = typeof BENEFIT_ACTIVITY_TYPES[number]
export type BenefitActivitySourceType = typeof BENEFIT_ACTIVITY_SOURCE_TYPES[number]

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

export interface BenefitActivityClaimItem {
  id: string
  activityId: string
  endUserId: string
  phoneMasked: string
  benefitGrantId: string
  grantStatus: string
  createdAt: string
}
