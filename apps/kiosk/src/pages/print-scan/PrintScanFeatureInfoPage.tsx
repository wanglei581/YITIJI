// ============================================================
// PrintScanFeatureInfoPage — 打印扫描能力 MVP 说明页
//   路由：/print-scan/feature/:key（key = id-photo | sign）
//
// 第一阶段这两项（证件照 / 签名盖章）只做可点击的说明页，
// 介绍能力规划 + 当前可用替代路径 + 合规声明，不做完整实现。
//
// 合规：证件照=敏感文件清理提示；签名盖章=非 CA 电子签声明。
// ============================================================

import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import {
  CheckCircle2Icon,
  FileType2Icon,
  PenToolIcon,
  ShieldCheckIcon,
  UserSquareIcon,
} from 'lucide-react'

type FeatureKey = 'id-photo' | 'sign'

interface FeatureInfo {
  icon: React.ComponentType<{ className?: string }>
  iconBg: string
  iconColor: string
  title: string
  summary: string
  plans: string[]
  /** 合规声明（可选）：'sensitive' = 敏感文件清理；'esign' = 非 CA 电子签 */
  notice?: 'sensitive' | 'esign'
  /** 已真正实现的能力入口（优先展示为主按钮）；仅 sign 分支填写，id-photo 仍是纯说明页。 */
  primaryLabel?: string
  primaryTo?: string
  /** 当前可用的替代路径按钮（有 primaryTo 时降级为次要按钮兜底） */
  fallbackLabel?: string
  fallbackTo?: string
}

const FEATURES: Record<FeatureKey, FeatureInfo> = {
  'id-photo': {
    icon: UserSquareIcon,
    iconBg: 'bg-warning-bg',
    iconColor: 'text-warning-fg',
    title: '证件照',
    summary: '即将支持常见规格证件照的尺寸排版与打印（一寸 / 二寸 / 小一寸等）。',
    plans: [
      '选择证件照规格与底色',
      '自动排版到 6 寸相纸 / A4',
      '直接接入打印流程出图',
    ],
    notice: 'sensitive',
    fallbackLabel: '先用照片打印',
    fallbackTo: '/print/upload',
  },
  sign: {
    icon: PenToolIcon,
    iconBg: 'bg-error-bg',
    iconColor: 'text-error-fg',
    title: '签名盖章',
    summary: '在一张 JPG / PNG 文件上叠加手写或上传的签名 / 印章图片，合成后直接打印。',
    plans: [
      '上传 / 手写签名图片',
      '在文件指定位置叠加签名或印章',
      '合成后打印',
    ],
    notice: 'esign',
    primaryLabel: '开始签名盖章',
    primaryTo: '/print-scan/sign',
    fallbackLabel: '先去文档打印',
    fallbackTo: '/print/upload',
  },
}

function isFeatureKey(k: string | undefined): k is FeatureKey {
  return k === 'id-photo' || k === 'sign'
}

export function PrintScanFeatureInfoPage() {
  const navigate = useNavigate()
  const { key } = useParams<{ key: string }>()

  // 未知 key 直达容错：不白屏，引导回服务中心
  if (!isFeatureKey(key)) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-100">
          <FileType2Icon className="h-10 w-10 text-neutral-400" />
        </div>
        <h1 className="mt-6 text-xl font-semibold text-neutral-900">未找到该功能</h1>
        <p className="mt-2 text-sm text-neutral-500">请返回打印扫描服务选择可用功能</p>
        <Button className="mt-8" onClick={() => navigate('/print-scan')}>
          返回打印扫描服务
        </Button>
      </div>
    )
  }

  const info = FEATURES[key]
  const Icon = info.icon

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <PageHeader
        title={info.title}
        subtitle={info.primaryTo ? '功能说明' : '功能说明（即将上线）'}
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/print-scan')}>
            返回打印扫描服务
          </Button>
        }
      />

      <Card className="mt-6 p-6">
        <div className="flex items-center gap-4">
          <div className={['flex h-16 w-16 shrink-0 items-center justify-center rounded-xl', info.iconBg].join(' ')}>
            <Icon className={['h-8 w-8', info.iconColor].join(' ')} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-neutral-900">{info.title}</h2>
              {!info.primaryTo && (
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
                  即将上线
                </span>
              )}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-neutral-500">{info.summary}</p>
          </div>
        </div>

        <div className="mt-6">
          <p className="mb-3 text-sm font-medium text-neutral-700">计划支持</p>
          <ul className="space-y-2.5">
            {info.plans.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-sm text-neutral-600">
                <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" aria-hidden="true" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {/* 合规声明 */}
      {info.notice === 'sensitive' && (
        <div className="mt-4">
          <ComplianceBanner tone="success" title="隐私保护">
            {COMPLIANCE_COPY.KIOSK_PRINT_SCAN_SENSITIVE}
          </ComplianceBanner>
        </div>
      )}
      {info.notice === 'esign' && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-info-bg bg-info-bg/70 px-4 py-3">
          <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-neutral-600">
            {COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE}
          </p>
        </div>
      )}

      {/* 操作区：真正实现的能力优先展示主按钮，说明性兜底路径降级为次要按钮 */}
      <div className="mt-6 flex flex-col gap-3">
        {info.primaryTo && info.primaryLabel && (
          <Button size="lg" onClick={() => navigate(info.primaryTo!)}>
            {info.primaryLabel}
          </Button>
        )}
        {info.fallbackTo && info.fallbackLabel && (
          <Button size="lg" variant={info.primaryTo ? 'secondary' : 'primary'} onClick={() => navigate(info.fallbackTo!)}>
            {info.fallbackLabel}
          </Button>
        )}
        <Button size="lg" variant="secondary" onClick={() => navigate('/print-scan')}>
          返回打印扫描服务
        </Button>
      </div>

      <div className="h-2" />
    </div>
  )
}
