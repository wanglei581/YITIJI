// PrintScanHomePage — V6 打印扫描域首屏。
// 视觉真值：docs/design/kiosk-ai-os-v3-2026-08/39-print-hub.html。
// 真实能力读取、失败关闭与生产路由保持不变；本文件只做容器编排。

import { KioskPageFrame } from '@ai-job-print/ui'
import {
  COMPLIANCE_COPY,
  canCreateFormalPrintScanTask,
  type PrintScanCapabilityKey,
  type PrintScanCapabilityStatus,
} from '@ai-job-print/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FilesIcon,
  FileTextIcon,
  FileType2Icon,
  ImageIcon,
  MessageSquareIcon,
  PenToolIcon,
  PrinterIcon,
  ScanLineIcon,
  SmartphoneIcon,
  UserSquareIcon,
  type LucideIcon,
} from 'lucide-react'
import {
  loadConfiguredCapabilities,
  type CapabilitiesLoadResult,
  type ConfiguredCapabilityMap,
} from '../../services/api/printScanCapabilities'
import {
  V6PrintHubView,
  type V6PrintCapabilityView,
  type V6PrintQuickLinkView,
} from './components/V6PrintHubView'
import './styles/print-hub-v6.css'

interface CapabilityDefinition {
  key: string
  icon: LucideIcon
  accent: V6PrintCapabilityView['accent']
  title: string
  description: string
  to: string
  state?: Record<string, unknown>
  available: boolean
  note?: string
  unavailableBadge?: string
}

const CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    key: 'doc-print',
    icon: FileTextIcon,
    accent: 'slate',
    title: '文档打印',
    description: 'PDF、图片上传后先做材料检查，再设置参数打印',
    to: '/print/upload?source=document&tab=file',
    available: true,
  },
  {
    key: 'phone-upload',
    icon: SmartphoneIcon,
    accent: 'teal',
    title: '手机扫码上传',
    description: '一体机生成二维码；手机上传后回到本机确认',
    to: '/print/upload?source=document&tab=qr',
    available: true,
  },
  {
    key: 'scan',
    icon: ScanLineIcon,
    accent: 'teal',
    title: '材料扫描',
    description: '纸质材料扫描为 PDF，再打印或保存到本人文档',
    to: '/scan/start',
    available: true,
  },
  {
    key: 'photo-print',
    icon: ImageIcon,
    accent: 'plum',
    title: '照片打印',
    description: '与文档打印走同一检查流程，再设置真实参数',
    to: '/print/upload?source=document&tab=file',
    state: { category: 'photo' },
    available: true,
  },
  {
    key: 'id-photo',
    icon: UserSquareIcon,
    accent: 'wheat',
    title: '证件照',
    description: '常见规格排版打印；当前先提供能力说明',
    to: '/print-scan/feature/id-photo',
    available: false,
    unavailableBadge: '待开发',
  },
  {
    key: 'convert',
    icon: FileType2Icon,
    accent: 'slate',
    title: '格式转换',
    description: '多张图片合并成一份 PDF，便于打印和存档',
    to: '/print-scan/convert',
    available: true,
  },
  {
    key: 'sign',
    icon: PenToolIcon,
    accent: 'clay',
    title: '签名盖章',
    description: '在 PDF 叠加签名或印章图片，非 CA 电子签',
    to: '/print-scan/sign',
    available: true,
  },
]

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

const QUICK_LINKS: readonly (V6PrintQuickLinkView & { to: string })[] = [
  {
    key: 'documents',
    icon: FilesIcon,
    title: '我的文档',
    description: '查看本人上传或生成的文件',
    to: '/me/documents',
  },
  {
    key: 'print-orders',
    icon: PrinterIcon,
    title: '打印订单',
    description: '查看任务状态与取件凭证',
    to: '/me/print-orders',
  },
  {
    key: 'feedback',
    icon: MessageSquareIcon,
    title: '异常反馈',
    description: '反馈打印或扫描问题',
    to: '/me/feedback?category=print',
  },
]

export function PrintScanHomePage() {
  const navigate = useNavigate()
  const [capabilityLoad, setCapabilityLoad] = useState<
    CapabilitiesLoadResult | { status: 'loading'; map: ConfiguredCapabilityMap }
  >({ status: 'loading', map: {} })

  const loadCapabilities = useCallback(() => {
    setCapabilityLoad({ status: 'loading', map: {} })
    void loadConfiguredCapabilities().then(setCapabilityLoad)
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadConfiguredCapabilities().then((result) => {
      if (!cancelled) setCapabilityLoad(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const confirmed = capabilityLoad.status === 'ok'
  const unavailableNote =
    capabilityLoad.status === 'loading' ? '正在确认本机服务配置' : '服务状态无法确认，请重新检测'

  const capabilities = useMemo(
    () =>
      CAPABILITIES.map((capability) => {
        const capabilityKey = CARD_CAPABILITY_KEY[capability.key]
        if (!confirmed && capabilityKey) {
          return {
            ...capability,
            available: false,
            to: '',
            state: undefined,
            note: unavailableNote,
            unavailableBadge: capabilityLoad.status === 'loading' ? '检查中' : '状态未确认',
          }
        }
        const override = capabilityKey ? capabilityLoad.map[capabilityKey] : undefined
        if (!override) return capability
        const available = canCreateFormalPrintScanTask(override.status)
        return {
          ...capability,
          available,
          to: available
            ? capability.to
            : capability.to.startsWith('/print-scan/feature/')
              ? capability.to
              : '',
          state: available ? capability.state : undefined,
          note: available
            ? capability.note
            : (override.note ?? CAPABILITY_STATUS_NOTES[override.status] ?? capability.note),
          unavailableBadge: available ? capability.unavailableBadge : '暂不可用',
        }
      }),
    [capabilityLoad.map, capabilityLoad.status, confirmed, unavailableNote]
  )

  const handleCapability = (key: string) => {
    const capability = capabilities.find((item) => item.key === key)
    if (!capability?.to) return
    navigate(capability.to, capability.state ? { state: capability.state } : undefined)
  }

  const handleQuickLink = (key: string) => {
    const link = QUICK_LINKS.find((item) => item.key === key)
    if (link) navigate(link.to)
  }

  return (
    <KioskPageFrame className="v6-print-hub-page">
      <V6PrintHubView
        loadStatus={
          capabilityLoad.status === 'ok'
            ? 'ok'
            : capabilityLoad.status === 'loading'
              ? 'loading'
              : 'error'
        }
        capabilities={capabilities.map((capability) => ({
          ...capability,
          actionable: Boolean(capability.to),
        }))}
        quickLinks={QUICK_LINKS}
        sensitiveNotice={COMPLIANCE_COPY.KIOSK_PRINT_SCAN_SENSITIVE}
        legalNotice={COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE}
        onAiGuide={() => navigate('/assistant')}
        onRetry={loadCapabilities}
        onCapability={handleCapability}
        onQuickLink={handleQuickLink}
      />
    </KioskPageFrame>
  )
}
