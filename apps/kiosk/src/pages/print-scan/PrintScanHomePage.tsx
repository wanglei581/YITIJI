// ============================================================
// PrintScanHomePage — 打印扫描服务中心首页（/print-scan）
//
// 布局原则：可完成能力放主区（大卡片），未上线能力放次级区（明确标注）。
// 合规：敏感文件自动清理提示；签名盖章为非 CA 电子签。
// 范围：不改 AI 简历服务、岗位、招聘会、后台。
// ============================================================

import { useNavigate } from 'react-router-dom'
import { Button, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import {
  ChevronRightIcon,
  ClockIcon,
  FileTextIcon,
  FileType2Icon,
  ImageIcon,
  PenToolIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  UserSquareIcon,
} from 'lucide-react'

// ── 已上线能力（有真实或明确演示链路）────────────────────────

interface AvailableCapability {
  key: string
  icon: React.ComponentType<{ className?: string }>
  iconBg: string
  iconColor: string
  title: string
  description: string
  to: string
  state?: Record<string, unknown>
  note?: string
}

const AVAILABLE: AvailableCapability[] = [
  {
    key: 'doc-print',
    icon: FileTextIcon,
    iconBg: 'bg-primary-50',
    iconColor: 'text-primary-600',
    title: '文档打印',
    description: 'PDF、Word、图片，上传后设置参数打印',
    to: '/print/upload',
  },
  {
    key: 'scan',
    icon: ScanLineIcon,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    title: '材料扫描',
    description: '纸质材料扫描成 PDF / 图片存档',
    to: '/scan/start',
    note: '流程演示·真机需连接 Terminal Agent',
  },
  {
    key: 'photo-print',
    icon: ImageIcon,
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-600',
    title: '照片打印',
    description: '上传 JPG / PNG 照片打印',
    to: '/print/upload',
    state: { category: 'photo' },
  },
]

// ── 即将上线能力────────────────────────────────────────────

interface UpcomingCapability {
  key: string
  icon: React.ComponentType<{ className?: string }>
  iconBg: string
  iconColor: string
  title: string
  to: string
}

const UPCOMING: UpcomingCapability[] = [
  {
    key: 'id-photo',
    icon: UserSquareIcon,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-500',
    title: '证件照',
    to: '/print-scan/feature/id-photo',
  },
  {
    key: 'convert',
    icon: FileType2Icon,
    iconBg: 'bg-sky-50',
    iconColor: 'text-sky-500',
    title: '格式转换',
    to: '/print-scan/feature/convert',
  },
  {
    key: 'sign',
    icon: PenToolIcon,
    iconBg: 'bg-rose-50',
    iconColor: 'text-rose-400',
    title: '签名盖章',
    to: '/print-scan/feature/sign',
  },
]

// ── Component ──────────────────────────────────────────────

export function PrintScanHomePage() {
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <PageHeader
        title="打印扫描服务"
        subtitle="文档打印 · 材料扫描 · 照片打印"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />

      {/* 敏感文件提示 */}
      <div className="mt-4">
        <ComplianceBanner tone="success" title="隐私保护">
          {COMPLIANCE_COPY.KIOSK_PRINT_SCAN_SENSITIVE}
        </ComplianceBanner>
      </div>

      {/* ── 主区：已上线能力 ── */}
      <section className="mt-6" aria-label="已上线能力">
        <div className="grid grid-cols-3 gap-4">
          {AVAILABLE.map((cap) => {
            const Icon = cap.icon
            return (
              <button
                key={cap.key}
                type="button"
                onClick={() => navigate(cap.to, cap.state ? { state: cap.state } : undefined)}
                className="flex min-h-[176px] flex-col rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-colors hover:border-primary-200 hover:bg-primary-50/40 active:bg-primary-100/40"
              >
                <div className={['flex h-14 w-14 items-center justify-center rounded-xl', cap.iconBg].join(' ')}>
                  <Icon className={['h-7 w-7', cap.iconColor].join(' ')} aria-hidden="true" />
                </div>
                <h3 className="mt-3 text-lg font-semibold text-gray-900">{cap.title}</h3>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-gray-500">{cap.description}</p>
                {cap.note && (
                  <p className="mt-1 text-xs leading-relaxed text-amber-600">{cap.note}</p>
                )}
                <div className="mt-3 flex min-h-[44px] items-center gap-0.5 text-base font-semibold text-primary-600">
                  <span>进入</span>
                  <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* ── 次级区：即将上线 ── */}
      <section className="mt-6" aria-label="即将上线">
        <div className="mb-3 flex items-center gap-2">
          <ClockIcon className="h-4 w-4 text-gray-400" aria-hidden="true" />
          <h2 className="text-sm font-medium text-gray-400">即将上线</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {UPCOMING.map((cap) => {
            const Icon = cap.icon
            return (
              <button
                key={cap.key}
                type="button"
                onClick={() => navigate(cap.to)}
                className="flex min-h-[96px] flex-col items-start rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-4 text-left transition-colors hover:bg-gray-100/60"
              >
                <div className={['flex h-10 w-10 items-center justify-center rounded-lg opacity-60', cap.iconBg].join(' ')}>
                  <Icon className={['h-5 w-5', cap.iconColor].join(' ')} aria-hidden="true" />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-400">{cap.title}</p>
                  <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">即将上线</span>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* 非 CA 电子签说明 */}
      <div className="mt-5 flex items-start gap-2 rounded-lg border border-sky-100 bg-sky-50/70 px-4 py-3">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-gray-600">
          {COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE}
        </p>
      </div>

      <div className="h-2" />
    </div>
  )
}
