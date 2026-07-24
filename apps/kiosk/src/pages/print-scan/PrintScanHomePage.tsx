// ============================================================
// PrintScanHomePage — 打印扫描服务中心首页（/print-scan）
//
// 屏02 视觉口径对齐 docs/design/kiosk-proto-2026-07/02-print-hub.html
// 配色：CSS token 映射（--teal/--clay/--wheat/--plum/--slate 品类色）
// 布局：2 列固定竖屏 cap-grid，按钮 min-height ≥ 56px
//
// 功能不变：7 能力入口 + 本机设备能力卡 + 我的打印记录快捷入口
// 合规：敏感文件（证件照/身份证）自动清理提示；签名盖章为非 CA 电子签。
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, KioskActionBar, KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import {
  COMPLIANCE_COPY,
  canCreateFormalPrintScanTask,
  type PrintScanCapabilityKey,
  type PrintScanCapabilityStatus,
} from '@ai-job-print/shared'
import { getConfiguredCapabilities, type ConfiguredCapabilityMap } from '../../services/api/printScanCapabilities'
import {
  CheckIcon,
  ChevronRightIcon,
  FilesIcon,
  FileTextIcon,
  FileType2Icon,
  ImageIcon,
  InfoIcon,
  MessageSquareIcon,
  PenToolIcon,
  PrinterIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  UserSquareIcon,
} from 'lucide-react'
import './styles/print-scan-fusion.css'

interface Capability {
  key: string
  icon: React.ComponentType<{ className?: string }>
  /** 卡片顶部 4px 色条，e.g. "border-t-info" */
  accentBorder: string
  /** 图标容器背景 Tailwind 类 */
  iconBg: string
  /** 图标前景色 Tailwind 类 */
  iconColor: string
  /** "进入/了解详情" 链接文字颜色（= accent-deep） */
  goColor: string
  title: string
  description: string
  to: string
  state?: Record<string, unknown>
  available: boolean
  note?: string
  /** 不可用角标文案。默认「即将上线」；被管理员关闭时为「暂不可用」。 */
  unavailableBadge?: string
}

const CAPABILITIES: Capability[] = [
  {
    key: 'doc-print',
    icon: FileTextIcon,
    accentBorder: 'border-t-info',
    iconBg: 'bg-info-bg',
    iconColor: 'text-info-fg',
    goColor: 'text-info-fg',
    title: '文档打印',
    description: 'PDF、图片上传后先做材料检查，再设置参数打印',
    to: '/print/upload',
    available: true,
  },
  {
    key: 'phone-upload',
    icon: SmartphoneIcon,
    accentBorder: 'border-t-info',
    iconBg: 'bg-info-bg',
    iconColor: 'text-info-fg',
    goColor: 'text-info-fg',
    title: '手机扫码上传',
    description: '手机或其他联网设备扫码上传文件，一体机确认后打印',
    to: '/print/upload?source=document&tab=qr',
    available: true,
  },
  {
    key: 'scan',
    icon: ScanLineIcon,
    accentBorder: 'border-t-primary-600',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-700',
    goColor: 'text-primary-700',
    title: '材料扫描',
    description: '纸质材料扫描成 PDF / 图片，可存档、打印或做简历识别',
    to: '/scan/start',
    available: true,
  },
  {
    key: 'photo-print',
    icon: ImageIcon,
    accentBorder: 'border-t-plum',
    iconBg: 'bg-plum-soft',
    iconColor: 'text-plum',
    goColor: 'text-plum',
    title: '照片打印',
    description: '上传 JPG / PNG 照片打印，走文档打印同一检查流程',
    to: '/print/upload',
    state: { category: 'photo' },
    available: true,
  },
  {
    key: 'id-photo',
    icon: UserSquareIcon,
    accentBorder: 'border-t-wheat',
    iconBg: 'bg-wheat-soft',
    iconColor: 'text-wheat',
    goColor: 'text-wheat',
    title: '证件照',
    description: '常见规格证件照排版打印，当前可先用「照片打印」',
    to: '/print-scan/feature/id-photo',
    available: false,
  },
  {
    key: 'convert',
    icon: FileType2Icon,
    accentBorder: 'border-t-info',
    iconBg: 'bg-info-bg',
    iconColor: 'text-info-fg',
    goColor: 'text-info-fg',
    title: '格式转换',
    description: '多张图片（最多 20 张）合并为一份 PDF，便于打印和存档',
    to: '/print-scan/convert',
    available: true,
  },
  {
    key: 'sign',
    icon: PenToolIcon,
    accentBorder: 'border-t-clay',
    iconBg: 'bg-clay-soft',
    iconColor: 'text-clay',
    goColor: 'text-clay',
    title: '签名盖章',
    description: '在 PDF 上叠加签名 / 印章图片（版式合成，非 CA 电子签）',
    to: '/print-scan/sign',
    available: true,
  },
]

// 卡片 → 能力开关键映射（Admin「打印扫描运维 → 设备能力」配置后覆盖硬编码默认）。
// photo-print 走文档打印流程（服务端按 document_print 门禁），因此服从同一开关。
// 本覆盖只是体验层——服务端有权威门禁（TerminalCapabilitiesService.assertUserTaskAllowed），
// 本页拉取失败时的回落不会放大真实可用性，最终由服务端拒绝并给出诚实错误。
const CARD_CAPABILITY_KEY: Partial<Record<string, PrintScanCapabilityKey>> = {
  'doc-print': 'document_print',
  'phone-upload': 'phone_upload',
  'photo-print': 'document_print',
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

/** 指向既有 /me/* 明细页（登录态与空态由目标页自行处理），不新建数据模型或重复入口。 */
const QUICK_LINKS: QuickLink[] = [
  {
    key: 'documents',
    icon: FilesIcon,
    title: '我的文档',
    description: '查看已上传 / 生成的文件',
    to: '/me/documents',
  },
  {
    key: 'print-orders',
    icon: PrinterIcon,
    title: '打印订单',
    description: '查看任务状态与取件凭证码',
    to: '/me/print-orders',
  },
  {
    key: 'feedback',
    icon: MessageSquareIcon,
    title: '异常反馈',
    description: '打印 / 扫描遇到问题在此反馈',
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
    return () => { cancelled = true }
  }, [])

  const capabilities = useMemo<Capability[]>(
    () =>
      CAPABILITIES.map((cap) => {
        const key = CARD_CAPABILITY_KEY[cap.key]
        const override = key ? configured[key] : undefined
        if (!override) return cap
        const available = canCreateFormalPrintScanTask(override.status)
        const disabledTo = cap.to.startsWith('/print-scan/feature/') ? cap.to : ''
        return {
          ...cap,
          available,
          to: available ? cap.to : disabledTo,
          state: available ? cap.state : undefined,
          note: available
            ? cap.note
            : (override.note ?? CAPABILITY_STATUS_NOTES[override.status] ?? cap.note),
          unavailableBadge: available ? cap.unavailableBadge : '暂不可用',
        }
      }),
    [configured],
  )

  return (
    <KioskPageFrame className="w2-print-scan-page">
      <div data-w2-page="print-scan-home" className="w2-print-scan-shell flex h-full flex-col overflow-y-auto bg-canvas px-12 pb-8">
      <KioskPageHeader
        title="打印扫描服务"
        description="文档打印 · 手机扫码上传 · 材料扫描 · 照片与证件照 · 格式转换 · 签名盖章"
        aside={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />

      {/* 隐私保护提示 */}
      <div className="mt-5 flex items-center gap-3 rounded-xl border border-dashed border-neutral-200 bg-surface/70 px-5 py-3">
        <ShieldCheckIcon className="h-5 w-5 shrink-0 text-wheat" aria-hidden="true" />
        <p className="text-[17px] leading-relaxed text-neutral-500">
          {COMPLIANCE_COPY.KIOSK_PRINT_SCAN_SENSITIVE}
        </p>
      </div>

      {/* 7 能力卡 + 本机设备能力卡（2 列等高网格） */}
      <div className="mt-6 grid flex-1 grid-cols-2 gap-5">
        {capabilities.map((cap) => {
          const Icon = cap.icon
          const isDisabled = !cap.available && !cap.to
          return (
            <button
              key={cap.key}
              type="button"
              onClick={() => {
                if (!cap.to) return
                navigate(cap.to, cap.state ? { state: cap.state } : undefined)
              }}
              disabled={isDisabled}
              className={[
                'flex flex-col gap-3 rounded-[var(--radius-lg)] border border-neutral-200 bg-surface p-6 text-left',
                'border-t-4 shadow-sm active:scale-[0.99]',
                cap.accentBorder,
                !cap.available ? 'opacity-[0.62]' : 'cursor-pointer',
              ].join(' ')}
            >
              <div className="flex items-center gap-4">
                <span className={['flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl', cap.iconBg].join(' ')}>
                  <Icon className={['h-[34px] w-[34px]', cap.iconColor].join(' ')} aria-hidden="true" />
                </span>
                <h3 className="font-serif text-[28px] font-bold tracking-wide text-neutral-900">{cap.title}</h3>
                {!cap.available && (
                  <span className="rounded-full border border-neutral-200 bg-canvas px-3 py-1 text-[15px] text-neutral-500 whitespace-nowrap">
                    {cap.unavailableBadge ?? '即将上线'}
                  </span>
                )}
              </div>
              <p className="text-[18px] leading-relaxed text-neutral-500">{cap.description}</p>
              {cap.note && (
                <p className="text-[16px] leading-relaxed text-warning-fg">{cap.note}</p>
              )}
              <div className="mt-auto flex items-center gap-2">
                {cap.to ? (
                  <span className={['flex items-center gap-2 text-[19px] font-semibold', cap.goColor].join(' ')}>
                    {cap.available ? '进入' : '了解详情'}
                    <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
                  </span>
                ) : (
                  <span className="text-[19px] font-semibold text-neutral-400">暂不可用</span>
                )}
              </div>
            </button>
          )
        })}

        {/* 本机设备能力卡（第 8 格，a-teal） */}
        <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-t-4 border-neutral-200 border-t-primary-600 bg-surface p-6 shadow-sm">
          <h3 className="font-serif text-[26px] font-bold text-neutral-900">
            本机设备能力
            <span className="ml-3 font-sans text-[15px] font-normal text-neutral-500">
              以本机实际配置与耗材状态为准
            </span>
          </h3>
          <div className="flex flex-col gap-2 text-[17px] text-neutral-500">
            {[
              '彩色 / 黑白激光打印 · A4 幅面',
              '自动双面打印，省纸更环保',
              '输稿器连续扫描，一次最多 50 页',
              '扫描支持 PDF / JPG / PNG 格式',
            ].map((item) => (
              <span key={item} className="flex items-center gap-2.5">
                <CheckIcon className="h-[18px] w-[18px] shrink-0 text-primary-700" aria-hidden="true" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 我的打印记录（登录后可查看） */}
      <div className="mt-6">
        <div className="mb-2 flex items-baseline gap-3">
          <b className="font-serif text-[24px] font-bold tracking-wide text-neutral-900">我的打印记录</b>
          <span className="text-[17px] text-neutral-500">登录后可查看历史记录与凭证</span>
        </div>
        <div className="grid grid-cols-3 gap-[18px]">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon
            return (
              <button
                key={link.key}
                type="button"
                onClick={() => navigate(link.to)}
                className="flex min-h-24 items-center gap-4 rounded-[var(--radius-md)] border border-neutral-200 bg-surface px-[22px] py-4 text-left shadow-sm active:scale-[0.98]"
              >
                <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[13px] bg-info-bg text-info-fg">
                  <Icon className="h-7 w-7" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[21px] font-bold text-neutral-900">{link.title}</b>
                  <span className="mt-0.5 block text-[16px] text-neutral-500">{link.description}</span>
                </span>
                <ChevronRightIcon className="h-[22px] w-[22px] shrink-0 text-neutral-400 opacity-60" aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </div>

      {/* 非 CA 电子签说明 */}
      <div className="mt-6 flex items-center gap-3 rounded-xl border border-dashed border-neutral-200 bg-surface/70 px-5 py-3">
        <InfoIcon className="h-5 w-5 shrink-0 text-wheat" aria-hidden="true" />
        <p className="text-[17px] leading-relaxed text-neutral-500">
          {COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE}
        </p>
      </div>

      <KioskActionBar>
        <Button variant="secondary" onClick={() => navigate('/')}>返回首页</Button>
      </KioskActionBar>
      </div>
    </KioskPageFrame>
  )
}
