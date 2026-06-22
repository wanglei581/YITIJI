import type {
  FileAssetCategory,
  FileOwnerType,
  FileRetentionPolicy,
  FileRetentionSetBy,
} from '@ai-job-print/shared'

export const RETENTION_FILTERS = ['全部', '保存3个月', '保存6个月', '长期保存', '系统短期'] as const

export const RETENTION_POLICY_LABELS: Record<FileRetentionPolicy, string> = {
  months_3: '保存3个月',
  months_6: '保存6个月',
  long_term: '长期保存',
  system_short: '系统短期',
}

export const RETENTION_SET_BY_LABELS: Record<FileRetentionSetBy, string> = {
  system: '系统设置',
  user: '用户本人',
  admin: '管理员锁定',
}

export const ASSET_CATEGORY_LABELS: Record<FileAssetCategory, string> = {
  original: '原始文件',
  optimized: '优化成果',
  derived: '衍生成果',
}

export const OWNER_TYPE_LABELS: Record<FileOwnerType, string> = {
  user: '会员用户',
  partner: '合作机构',
  admin: '管理员',
  system: '系统/匿名',
}

export function retentionPolicyLabel(policy: FileRetentionPolicy | null): string {
  return policy ? RETENTION_POLICY_LABELS[policy] : '未标记'
}

export function retentionSetByLabel(setBy: FileRetentionSetBy | null): string {
  return setBy ? RETENTION_SET_BY_LABELS[setBy] : '未记录'
}

export function assetCategoryLabel(category: FileAssetCategory | undefined): string {
  return category ? ASSET_CATEGORY_LABELS[category] : '未分类'
}

export function ownerTypeLabel(ownerType: FileOwnerType | null): string {
  return ownerType ? OWNER_TYPE_LABELS[ownerType] : '未记录'
}
