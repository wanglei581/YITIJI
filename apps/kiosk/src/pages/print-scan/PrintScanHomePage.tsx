// ============================================================
// PrintScanHomePage — 打印扫描服务中心首页（/print-scan）
//
// 首页第二个大模块。展示 6 个能力入口：
//   已上线：文档打印 → /print/upload、材料扫描 → /scan/start、照片打印 → /print/upload
//   MVP 说明：证件照 / 格式转换 / 签名盖章 → /print-scan/feature/:key（可点击占位）
//
// 合规：敏感文件（证件照/身份证）自动清理提示；签名盖章为非 CA 电子签。
// 范围：不改 AI 简历服务、岗位、招聘会、后台。
// ============================================================

import { useNavigate } from 'react-router-dom'
import { Button, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import {
  ChevronRightIcon,
  FileTextIcon,
  FileType2Icon,
  ImageIcon,
  PenToolIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  UserSquareIcon,
} from 'lucide-react'

interface Capability {
  key: string
  icon: React.ComponentType<{ className?: string }>
  iconBg: string
  iconColor: string
  title: string
  description: string
  /** 已上线能力直接进入对应流程；MVP 进入说明页 */
  to: string
  state?: Record<string, unknown>
  available: boolean
  /** 可选的诚实说明（如材料扫描为流程演示，真机需 Agent） */
  note?: string
}

const CAPABILITIES: Capability[] = [
  {
    key: 'doc-print',
    icon: FileTextIcon,
    iconBg: 'bg-primary-50',
    iconColor: 'text-primary-600',
    title: '文档打印',
    description: 'PDF、Word、图片，上传后设置参数打印',
    to: '/print/upload',
    available: true,
  },
  {
    key: 'scan',
    icon: ScanLineIcon,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    title: '材料扫描',
    description: '纸质材料扫描成 PDF / 图片存档',
    to: '/scan/start',
    available: true,
    note: '流程演示，真机扫描需连接 Terminal Agent',
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
    available: true,
  },
  {
    key: 'id-photo',
    icon: UserSquareIcon,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    title: '证件照',
    description: '常见规格证件照排版打印',
    to: '/print-scan/feature/id-photo',
    available: false,
  },
  {
    key: 'convert',
    icon: FileType2Icon,
    iconBg: 'bg-sky-50',
    iconColor: 'text-sky-600',
    title: '格式转换',
    description: '文档与图片格式互转',
    to: '/print-scan/feature/convert',
    available: false,
  },
  {
    key: 'sign',
    icon: PenToolIcon,
    iconBg: 'bg-rose-50',
    iconColor: 'text-rose-600',
    title: '签名盖章',
    description: '在文件上叠加签名 / 印章图片',
    to: '/print-scan/feature/sign',
    available: false,
  },
]

export function PrintScanHomePage() {
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <PageHeader
        title="打印扫描服务"
        subtitle="文档打印 · 材料扫描 · 照片与证件照 · 格式转换 · 签名盖章"
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

      {/* 6 个能力入口 */}
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        {CAPABILITIES.map((cap) => {
          const Icon = cap.icon
          return (
            <button
              key={cap.key}
              type="button"
              onClick={() => navigate(cap.to, cap.state ? { state: cap.state } : undefined)}
              className="flex min-h-[160px] flex-col rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-colors hover:border-primary-200 hover:bg-primary-50/40 active:bg-primary-100/40"
            >
              <div className={['flex h-14 w-14 items-center justify-center rounded-xl', cap.iconBg].join(' ')}>
                <Icon className={['h-7 w-7', cap.iconColor].join(' ')} aria-hidden="true" />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <h3 className="text-lg font-semibold text-gray-900">{cap.title}</h3>
                {!cap.available && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                    即将上线
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-gray-500">{cap.description}</p>
              {cap.note ? (
                <p className="mt-1 flex-1 text-xs leading-relaxed text-amber-600">{cap.note}</p>
              ) : (
                <div className="flex-1" />
              )}
              <div className="mt-2 flex min-h-[28px] items-center gap-0.5 text-sm font-semibold text-primary-600">
                <span>{cap.available ? '进入' : '了解详情'}</span>
                <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
              </div>
            </button>
          )
        })}
      </div>

      {/* 非 CA 电子签说明 */}
      <div className="mt-6 flex items-start gap-2 rounded-lg border border-sky-100 bg-sky-50/70 px-4 py-3">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-gray-600">
          {COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE}
        </p>
      </div>

      <div className="h-2" />
    </div>
  )
}
