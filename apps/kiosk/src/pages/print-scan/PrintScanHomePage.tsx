// ============================================================
// PrintScanHomePage — 打印扫描服务中心首页（/print-scan）
//
// 首页第二个大模块。展示 7 个能力入口：
//   已上线：文档打印 → /print/upload、手机扫码上传 → /print/upload?tab=qr、
//           材料扫描 → /scan/start、照片打印 → /print/upload
//   MVP 说明：证件照 / 格式转换 / 签名盖章 → /print-scan/feature/:key（可点击占位）
// 另有"我的打印记录"快捷入口区：指向既有 /me/documents、/me/print-orders、
//   /me/feedback?category=print 三个 /me/* 明细页，不新建数据模型或重复入口。
//
// 合规：敏感文件（证件照/身份证）自动清理提示；签名盖章为非 CA 电子签。
// 范围：不改 AI 简历服务、岗位、招聘会、后台。
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import {
  COMPLIANCE_COPY,
  canCreateFormalPrintScanTask,
  type PrintScanCapabilityKey,
  type PrintScanCapabilityStatus,
} from '@ai-job-print/shared'
import { getConfiguredCapabilities, type ConfiguredCapabilityMap } from '../../services/api/printScanCapabilities'
import {
  ChevronRightIcon,
  FilesIcon,
  FileTextIcon,
  FileType2Icon,
  ImageIcon,
  MessageSquareIcon,
  PenToolIcon,
  PrinterIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
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
  /** 可选的诚实说明（当前无卡片使用，为未来需要标注硬件依赖/使用限制的能力保留） */
  note?: string
  /** 不可用时的角标文案。默认「即将上线」；被管理员开关关闭时为「暂不可用」。 */
  unavailableBadge?: string
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
    key: 'phone-upload',
    icon: SmartphoneIcon,
    iconBg: 'bg-primary-50',
    iconColor: 'text-primary-600',
    title: '手机扫码上传',
    description: '手机或其他联网设备扫码上传文件，一体机确认后打印',
    to: '/print/upload?source=document&tab=qr',
    available: true,
  },
  {
    key: 'scan',
    icon: ScanLineIcon,
    iconBg: 'bg-success-bg',
    iconColor: 'text-success-fg',
    title: '材料扫描',
    description: '纸质材料扫描成 PDF / 图片存档',
    to: '/scan/start',
    available: true,
  },
  {
    key: 'photo-print',
    icon: ImageIcon,
    iconBg: 'bg-plum-soft',
    iconColor: 'text-plum',
    title: '照片打印',
    description: '上传 JPG / PNG 照片打印',
    to: '/print/upload',
    state: { category: 'photo' },
    available: true,
  },
  {
    key: 'id-photo',
    icon: UserSquareIcon,
    iconBg: 'bg-warning-bg',
    iconColor: 'text-warning-fg',
    title: '证件照',
    description: '常见规格证件照排版打印',
    to: '/print-scan/feature/id-photo',
    available: false,
  },
  {
    key: 'convert',
    icon: FileType2Icon,
    iconBg: 'bg-info-bg',
    iconColor: 'text-info',
    title: '格式转换',
    description: '文档与图片格式互转',
    to: '/print-scan/feature/convert',
    available: false,
  },
  {
    key: 'sign',
    icon: PenToolIcon,
    iconBg: 'bg-error-bg',
    iconColor: 'text-error-fg',
    title: '签名盖章',
    description: '在文件上叠加签名 / 印章图片',
    to: '/print-scan/feature/sign',
    available: false,
  },
]

// 卡片 → 能力开关键映射（Admin「打印扫描运维 → 设备能力」配置后覆盖硬编码默认）。
// photo-print 无独立能力键（本质走文档打印流程），保持硬编码不受开关控制。
const CARD_CAPABILITY_KEY: Partial<Record<string, PrintScanCapabilityKey>> = {
  'doc-print': 'document_print',
  'phone-upload': 'phone_upload',
  scan: 'scan',
  'id-photo': 'id_photo',
  convert: 'format_convert',
  sign: 'signature_stamp',
}

const CAPABILITY_STATUS_NOTES: Record<PrintScanCapabilityStatus, string | null> = {
  available: null,
  testing: '测试中，暂未对用户开放',
  maintenance: '维护中，暂时不可用',
  unsupported: '本终端不支持该能力',
  not_verified: '待验收，暂未开放',
}

interface QuickLink {
  key: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  to: string
}

/** 指向既有 /me/* 明细页(登录态与空态由目标页自行处理),不新建数据模型或重复入口。 */
const QUICK_LINKS: QuickLink[] = [
  {
    key: 'documents',
    icon: FilesIcon,
    title: '我的文档',
    description: '查看已上传/生成的文件',
    to: '/me/documents',
  },
  {
    key: 'print-orders',
    icon: PrinterIcon,
    title: '打印订单',
    description: '查看打印任务状态与取件码',
    to: '/me/print-orders',
  },
  {
    key: 'feedback',
    icon: MessageSquareIcon,
    title: '异常反馈',
    description: '打印/扫描遇到问题可在此反馈',
    to: '/me/feedback?category=print',
  },
]

export function PrintScanHomePage() {
  const navigate = useNavigate()
  const [configured, setConfigured] = useState<ConfiguredCapabilityMap>({})

  useEffect(() => {
    let cancelled = false
    void getConfiguredCapabilities().then((map) => {
      if (!cancelled) setConfigured(map)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 管理员配置过的能力键覆盖硬编码默认；未配置键保持保守默认。
  // available 只由服务端 status==='available' 决定（fail-closed），
  // 覆盖为不可用时卡片改跳能力说明页，避免用户进入必然失败的流程。
  const capabilities = useMemo<Capability[]>(
    () =>
      CAPABILITIES.map((cap) => {
        const key = CARD_CAPABILITY_KEY[cap.key]
        const override = key ? configured[key] : undefined
        if (!override) return cap
        const available = canCreateFormalPrintScanTask(override.status)
        // 被关停时：本就指向说明页的卡片保留说明页入口；原本直达流程的卡片
        // 置为不可点（to=''），避免把用户带进必然失败的流程或错误的"未找到"页。
        const disabledTo = cap.to.startsWith('/print-scan/feature/') ? cap.to : ''
        return {
          ...cap,
          available,
          to: available ? cap.to : disabledTo,
          state: available ? cap.state : undefined,
          note: available ? cap.note : (override.note ?? CAPABILITY_STATUS_NOTES[override.status] ?? cap.note),
          unavailableBadge: available ? cap.unavailableBadge : '暂不可用',
        }
      }),
    [configured],
  )

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <PageHeader
        title="打印扫描服务"
        subtitle="文档打印 · 手机扫码上传 · 材料扫描 · 照片与证件照 · 格式转换 · 签名盖章"
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
        {capabilities.map((cap) => {
          const Icon = cap.icon
          return (
            <button
              key={cap.key}
              type="button"
              onClick={() => {
                if (!cap.to) return
                navigate(cap.to, cap.state ? { state: cap.state } : undefined)
              }}
              className="flex min-h-[160px] flex-col rounded-xl border border-neutral-200 bg-white p-5 text-left shadow-sm transition-colors hover:border-primary-200 hover:bg-primary-50/40 active:bg-primary-100/40"
            >
              <div className={['flex h-14 w-14 items-center justify-center rounded-xl', cap.iconBg].join(' ')}>
                <Icon className={['h-7 w-7', cap.iconColor].join(' ')} aria-hidden="true" />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <h3 className="text-lg font-semibold text-neutral-900">{cap.title}</h3>
                {!cap.available && (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
                    {cap.unavailableBadge ?? '即将上线'}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-neutral-500">{cap.description}</p>
              {cap.note ? (
                <p className="mt-1 flex-1 text-xs leading-relaxed text-warning-fg">{cap.note}</p>
              ) : (
                <div className="flex-1" />
              )}
              <div className="mt-2 flex min-h-[28px] items-center gap-0.5 text-sm font-semibold text-primary-600">
                {cap.to ? (
                  <>
                    <span>{cap.available ? '进入' : '了解详情'}</span>
                    <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
                  </>
                ) : (
                  <span className="text-neutral-400">暂不可用</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* 我的打印记录快捷入口：指向既有 /me/* 明细页,不新建数据模型 */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-neutral-500">我的打印记录</h2>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon
            return (
              <button
                key={link.key}
                type="button"
                onClick={() => navigate(link.to)}
                className="flex min-h-[56px] items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-primary-200 hover:bg-primary-50/40 active:bg-primary-100/40"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100">
                  <Icon className="h-5 w-5 text-neutral-500" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-neutral-900">{link.title}</p>
                  <p className="truncate text-xs text-neutral-500">{link.description}</p>
                </div>
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-neutral-300" aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </div>

      {/* 非 CA 电子签说明 */}
      <div className="mt-6 flex items-start gap-2 rounded-lg border border-info-bg bg-info-bg/70 px-4 py-3">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-neutral-600">
          {COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE}
        </p>
      </div>

      <div className="h-2" />
    </div>
  )
}
