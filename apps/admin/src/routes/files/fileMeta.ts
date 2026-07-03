import type {
  AdminFilePurpose,
  AdminFileRecord,
  AdminFileSensitive,
} from '../../services/api'

export const PURPOSE_META: Record<AdminFilePurpose, { label: string; style: string; source: string }> = {
  resume_upload:        { label: '简历上传',   style: 'bg-blue-50 text-blue-600',     source: '用户上传' },
  resume_scan:          { label: '简历扫描',   style: 'bg-purple-50 text-purple-600', source: '扫描仪'   },
  id_scan:              { label: '身份证',     style: 'bg-red-50 text-red-600',       source: '扫描仪'   },
  print_doc:            { label: '打印文档',   style: 'bg-neutral-100 text-neutral-600',    source: '打印上传' },
  fair_material:        { label: '招聘会资料', style: 'bg-green-50 text-green-600',    source: '机构上传' },
  cover_letter:         { label: '求职信',     style: 'bg-blue-50 text-blue-600',     source: '用户上传' },
  partner_profile:      { label: '机构资料',   style: 'bg-teal-50 text-teal-600',     source: '机构上传' },
  partner_image:        { label: '岗位图片',   style: 'bg-teal-50 text-teal-600',     source: '机构上传' },
  partner_video:        { label: '机构视频',   style: 'bg-teal-50 text-teal-600',     source: '机构上传' },
  job_fair_material:    { label: '招聘会资料', style: 'bg-green-50 text-green-600',    source: '机构上传' },
  screensaver_material: { label: '宣传屏素材', style: 'bg-amber-50 text-amber-600',   source: '运营上传' },
  admin_upload:         { label: '管理员上传', style: 'bg-neutral-100 text-neutral-600',    source: '管理员'   },
  temp:                 { label: '临时文件',   style: 'bg-neutral-100 text-neutral-500',    source: '临时'     },
}

const PURPOSE_FALLBACK = { label: '其他文件', style: 'bg-neutral-100 text-neutral-500', source: '其他' }

export const SENSITIVE_UI: Record<AdminFileSensitive, { key: 'high' | 'medium' | 'low'; badge: 'error' | 'warning' | 'default'; label: string }> = {
  highly_sensitive: { key: 'high',   badge: 'error',   label: '高敏感' },
  sensitive:        { key: 'medium', badge: 'warning', label: '中敏感' },
  normal:           { key: 'low',    badge: 'default', label: '低敏感' },
}

export type CleanStatus = 'active' | 'scheduled' | 'cleaned'
export const CLEAN_MAP: Record<CleanStatus, { badge: 'success' | 'warning' | 'default'; label: string }> = {
  active:    { badge: 'success', label: '有效期内' },
  scheduled: { badge: 'warning', label: '待清理'   },
  cleaned:   { badge: 'default', label: '已清理'   },
}

export const TYPE_FILTERS      = ['全部', '简历上传', '简历扫描', '身份证', '打印文档', '招聘会资料', '求职信'] as const
export const SENSITIVE_FILTERS = ['全部', '高敏感', '中敏感', '低敏感'] as const
export const CLEAN_FILTERS     = ['全部', '有效期内', '待清理', '已清理'] as const

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function fmtDate(iso: string | null, fallback = '-'): string {
  if (iso === null) return fallback
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function cleanStatusOf(f: AdminFileRecord, now: number): CleanStatus {
  if (f.deletedAt !== null) return 'cleaned'
  if (f.expiresAt === null) return 'active'
  if (Date.parse(f.expiresAt) <= now) return 'scheduled'
  return 'active'
}

export function cleanPolicyOf(f: AdminFileRecord, status: CleanStatus): string {
  if (status === 'cleaned') return f.deleteReason ?? '已清理'
  if (status === 'scheduled') return '已过期，待定时清理'
  if (f.expiresAt === null) return '长期保存'
  return f.sensitiveLevel === 'highly_sensitive' ? '高敏感·到期即删' : '到期自动清理'
}

export interface ViewFile {
  raw: AdminFileRecord
  name: string
  user: string
  source: string
  size: string
  typeLabel: string
  typeStyle: string
  sensitive: 'high' | 'medium' | 'low'
  sensitiveBadge: 'error' | 'warning' | 'default'
  sensitiveLabel: string
  createdAt: string
  expiresAt: string
  clean: CleanStatus
  cleanPolicy: string
}

export function toViewFile(f: AdminFileRecord, now: number): ViewFile {
  const meta = PURPOSE_META[f.purpose] ?? PURPOSE_FALLBACK
  const sens = SENSITIVE_UI[f.sensitiveLevel] ?? SENSITIVE_UI.normal
  const clean = cleanStatusOf(f, now)
  return {
    raw: f,
    name: f.filename,
    user: f.endUserId ?? f.uploaderId ?? '匿名(Kiosk)',
    source: meta.source,
    size: fmtBytes(f.sizeBytes),
    typeLabel: meta.label,
    typeStyle: meta.style,
    sensitive: sens.key,
    sensitiveBadge: sens.badge,
    sensitiveLabel: sens.label,
    createdAt: fmtDate(f.createdAt),
    expiresAt: fmtDate(f.expiresAt, '长期保存'),
    clean,
    cleanPolicy: cleanPolicyOf(f, clean),
  }
}
