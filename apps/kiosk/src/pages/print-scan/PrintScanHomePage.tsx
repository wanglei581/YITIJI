// ============================================================
// PrintScanHomePage — 打印扫描 Hub（青序流光 10-print-hub）。
//
// 视觉真值：docs/design/kiosk-redesign-2026-08/10-print-hub.html
// 本文件只做容器：读真实状态、算每张卡能不能点，把结果交给 QxPrintHubView。
//
// ══ 两条独立的状态轴 ══
//   ① 能力探测轴 probe：GET /terminals/:id/capabilities 读不到 → 八项一律不开，
//      只留不依赖本机能力的记录类入口（到机码核销）。
//   ② 打印机（MFP）轴 mfp：GET /terminals/:id/printer-status。
//      fail-closed：null / 心跳过期 / 请求失败一律不算在线。
//      读不到状态时只说「读不到」，顶栏胶囊不得默认写成设备可用。
// ============================================================

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
  ImageIcon,
  LayersIcon,
  MessageSquareIcon,
  PenToolIcon,
  PrinterIcon,
  ScanLineIcon,
  SmartphoneIcon,
  TicketIcon,
  UsbIcon,
  UserSquareIcon,
  type LucideIcon,
} from 'lucide-react'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import {
  loadConfiguredCapabilities,
  type CapabilitiesLoadResult,
  type ConfiguredCapabilityMap,
} from '../../services/api/printScanCapabilities'
import { KioskFeedbackDialog } from '../../components/KioskFeedbackDialog'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { PRINT_HUB_ISSUE_OPTIONS } from '../../services/api/kioskFeedback'
import {
  HUB_PILL,
  PRINT_HUB_PRICE_NOTICE,
  arrivalCodeStateNote,
  capabilityGroupHint,
  colorDuplexChip,
  deriveHubUiState,
  recordsGroupHint,
  type MfpStatus,
  type PrintHubCap,
  type ProbeStatus,
} from './printHubContent'
import {
  PrintHubNavbar,
  QxPrintHubView,
  type QxPrintQuickLinkView,
} from './components/QxPrintHubView'
import './styles/print-hub-qx.css'

interface CapabilityDefinition {
  key: string
  /** 原型 data-cap，用于 AI 带高亮与逐卡对照。 */
  cap: PrintHubCap
  icon: LucideIcon
  title: string
  description: string
  to: string
  state?: Record<string, unknown>
  /** 原型标签口径：AI 卡恒标「AI · 仅供参考」，非 AI 卡恒标「不依赖 AI」。 */
  aiRole: 'ai' | 'none'
  /** 要不要这台 MFP 动起来才办得成（原型 device-off 的分界）。 */
  needsMfp: boolean
  available: boolean
  /** 可用时的「一行状态」，原型 .hc-st 默认态。 */
  stateNote?: string
  /** MFP 出不了纸、但这张卡照常可办时的状态行（原型 .hc-st 的 device-off 变体）。 */
  mfpOffStateNote?: string
  note?: string
  unavailableBadge?: string
  /** 原型 device-off 时这张卡的停用理由。 */
  mfpOffBadge?: string
  mfpOffNote?: string
  iconTone: 'teal' | 'slate' | 'clay' | 'wheat'
  wide?: boolean
}

// 七件事。顺序照原型 39-print-hub.html:644-914 的栅格顺序（2 列 × 4 行）。
// 「到机码核销」不在这里 —— 它不是「在这台机器上从头办」的第八件事，
// 见下方 ARRIVAL_CODE_ENTRY。
/**
 * 文档打印卡的描述行：彩色 / 双面只有在**本机**登记为 available 时才敢写进文案。
 * 未登记的机器上写「彩色、双面可选」= 谎报能力（CLAUDE.md §9「不伪造能力」）。
 */
function describeDocPrint(map: ConfiguredCapabilityMap): string {
  const on = (key: 'color_print' | 'duplex_print') => map[key]?.status === 'available'
  const extras = [on('color_print') ? '彩色' : null, on('duplex_print') ? '双面' : null].filter(
    (v): v is string => v !== null,
  )
  return extras.length > 0
    ? `PDF、图片上传后设参数打印，A4 黑白 / ${extras.join(' / ')}可选`
    : 'PDF、图片上传后设参数打印，A4 黑白（本机彩色 / 双面尚未通过真机验证）'
}

const CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    key: 'doc-print',
    cap: 'doc',
    icon: FileTextIcon,
    title: '文档打印',
    description: 'PDF、图片上传后设参数打印，A4 黑白',
    to: '/print/upload?source=document&tab=file',
    aiRole: 'ai',
    needsMfp: true,
    available: true,
    iconTone: 'teal',
    stateNote: 'A4 · 黑白单面',
    mfpOffBadge: '这台机器现在出不了纸',
    mfpOffNote: '这台机器出不了纸。文件可以先传上来存着，换一台再打。',
  },
  {
    key: 'phone-upload',
    cap: 'phone',
    icon: SmartphoneIcon,
    title: '手机扫码上传',
    description: '手机或其他联网设备扫码，把文件传到这台机器',
    to: '/print/upload?source=document&tab=qr&mode=transfer',
    aiRole: 'none',
    needsMfp: false,
    available: true,
    iconTone: 'slate',
    stateNote: '不用登录 · 不占打印机',
    mfpOffStateNote: '照常可用 · 这一步不经过打印机，传上来先存着',
  },
  {
    key: 'usb-import',
    cap: 'usb',
    icon: UsbIcon,
    title: 'U 盘导入打印',
    description: '从 U 盘根目录选一份文件，导入后继续材料检查与打印。',
    to: '/print/upload?source=document&tab=usb&mode=transfer',
    aiRole: 'none',
    needsMfp: false,
    available: true,
    iconTone: 'slate',
    stateNote: '本地网桥已实现 · Windows 真机未验收',
    mfpOffStateNote: '照常可用 · 导入不经过打印机，传上来先存着',
  },
  {
    key: 'photo-print',
    cap: 'photo',
    icon: ImageIcon,
    title: '照片打印',
    description: '照片上传后设参数打印，与文档同一条流程。',
    to: '/print/upload?source=document&tab=file&category=photo',
    state: { category: 'photo' },
    aiRole: 'ai',
    needsMfp: true,
    available: true,
    iconTone: 'clay',
    stateNote: '与文档打印同链路',
    mfpOffBadge: '这台机器现在出不了纸',
    mfpOffNote: '照片走文档打印同一条出纸链路，那条停了，这条也出不了。',
  },
  {
    key: 'scan',
    cap: 'scan',
    icon: ScanLineIcon,
    title: '材料扫描',
    description: '纸质材料扫描后按设备回传格式保存，可打印、可做简历识别',
    to: '/scan/start',
    aiRole: 'ai',
    needsMfp: true,
    available: true,
    iconTone: 'slate',
    stateNote: '面板手动扫描 · 无一键启动',
    mfpOffBadge: '这台机器现在出不了纸',
    mfpOffNote: '打印和扫描是同一台机器，它出不了纸，扫描一起停。',
  },
  {
    key: 'convert',
    cap: 'convert',
    icon: LayersIcon,
    title: '格式转换',
    description: '多张图片（最多 20 张）合并成一份 PDF，便于打印和存档',
    to: '/print-scan/convert',
    aiRole: 'none',
    needsMfp: false,
    available: true,
    iconTone: 'teal',
    stateNote: '最多 20 张 · 单张 ≤10MB',
    mfpOffStateNote: '照常可用 · 合并不经过打印机，合完先存着',
  },
  {
    key: 'sign',
    cap: 'sign',
    icon: PenToolIcon,
    title: '签名盖章',
    description: '在 PDF 上叠加签名 / 印章图片（版式合成，非 CA 电子签）',
    to: '/print-scan/sign',
    aiRole: 'none',
    needsMfp: false,
    available: true,
    iconTone: 'clay',
    stateNote: '图像合成，不是电子签名',
    mfpOffStateNote: '照常可用 · 合成不经过打印机，出纸要换机',
  },
  {
    key: 'id-photo',
    cap: 'idphoto',
    icon: UserSquareIcon,
    title: '证件照',
    description: '本机尚未开放，先看说明和替代路径。',
    to: '/print-scan/feature/id-photo',
    aiRole: 'ai',
    needsMfp: false,
    available: false,
    iconTone: 'wheat',
    wide: true,
    stateNote: '说明页 · 未开放',
    unavailableBadge: '说明页 · 未开放',
    mfpOffBadge: '说明页 · 未开放',
    mfpOffNote: '功能本身还没开放；了解说明不需要这台打印机。',
  },
]

/**
 * 到机码核销 —— 手机上已经下过单的人的入口。
 * 原型 39-print-hub.html:585-627（PR #644 补入），单独一行、不进七张卡的栅格。
 *
 * ⚠ 命名：后端与小程序下单页都叫它「到机码」（pickup-order.service.ts 的
 * 错误文案「到机码无效或已过期」、小程序 print-pay 的「提交并生成到机码」），
 * 它与付款后才生成的「取件凭证码」(Order.pickupCode) 是两个码。原型据此
 * 把卡面写成「到机码核销 · 不是取件码」。生产此前把两个码都叫「取件码」。
 *
 * ⚠ 门禁：刻意不登记进 CARD_CAPABILITY_KEY，也不随 MFP 轴停用 ——
 * 核销的是订单而非新建本机打印任务。原型在 device-off / 探测失败时把这张卡
 * 整个停掉，生产保留可点但把「这台出不了纸」如实写在卡面（arrivalCodeStateNote），
 * 理由见 docs 与既有门禁 verify-fusion-w2-print-scan.mjs 的同名断言。
 */
const ARRIVAL_CODE_ENTRY = {
  key: 'arrival-code',
  icon: TicketIcon,
  title: '到机码核销',
  description:
    '手机上下过单拿到的 8 位数字到机码；早期发出的 10 位字母数字历史码同样能用。扫码或手输都行。不是付款后的取件凭证码',
  to: '/print/pickup-claim',
} as const

const CARD_CAPABILITY_KEY: Partial<Record<string, PrintScanCapabilityKey>> = {
  'doc-print': 'document_print',
  'phone-upload': 'phone_upload',
  'usb-import': 'usb_import',
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

/** 反馈入口的 key。它不跳路由，而是就地打开匿名反馈弹层（见 handleQuickLink）。 */
const FEEDBACK_QUICK_LINK_KEY = 'feedback'

const QUICK_LINKS: readonly (QxPrintQuickLinkView & { to?: string })[] = [
  {
    key: 'documents',
    icon: FilesIcon,
    title: '我的文档',
    description: '已上传 / 生成的文件',
    to: '/me/documents',
  },
  {
    key: 'print-orders',
    icon: PrinterIcon,
    title: '打印订单',
    description: '任务状态与取件凭证码',
    to: '/me/print-orders',
  },
  {
    // 免登录：就地开弹层打匿名端点。旧实现跳 /me/feedback（会员面，必须登录），
    // 一体机是公共位设备，绝大多数用户没登录，那个入口对他们是死的。
    key: FEEDBACK_QUICK_LINK_KEY,
    icon: MessageSquareIcon,
    title: '反馈问题',
    description: '反馈打印或扫描问题，无需登录',
  },
]

/** 探测轴：把 loadConfiguredCapabilities 的四种结果收成原型的两态 + 一个中间态。 */
function toProbeStatus(load: CapabilitiesLoadResult | { status: 'loading' }): ProbeStatus {
  if (load.status === 'loading') return 'loading'
  // skipped = mock / 未接后端，按「已读取」处理，与既有服务中心行为一致。
  return load.status === 'error' ? 'error' : 'ok'
}

export function PrintScanHomePage() {
  const navigate = useNavigate()
  const device = useTerminalDeviceStatus()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
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

  const probe = toProbeStatus(capabilityLoad)
  const confirmed = probe === 'ok'

  // MFP 轴。printerReady 之外一律不算就绪；但只有「确定出不了纸」才敢说 unavailable。
  const mfp: MfpStatus = device.loading
    ? 'checking'
    : device.kind === 'ready' || device.kind === 'low_paper'
      ? 'ready'
      : device.kind === 'offline' || device.kind === 'error'
        ? 'unavailable'
        : 'unknown'

  const unavailableNote =
    probe === 'loading' ? '正在确认本机服务配置' : '服务状态无法确认，请重新检测'

  const capabilities = useMemo(
    () =>
      CAPABILITIES.map((rawCapability) => {
        // 文档打印卡的彩色/双面表述按本机能力登记动态改写，其余卡原样。
        const capability =
          rawCapability.key === 'doc-print'
            ? { ...rawCapability, description: describeDocPrint(capabilityLoad.map) }
            : rawCapability
        const capabilityKey = CARD_CAPABILITY_KEY[capability.key]

        // ① 探测轴优先：读不到能力配置 → 七项一律不开（含证件照说明页）。
        if (!confirmed && capabilityKey) {
          return {
            ...capability,
            available: false,
            to: '',
            state: undefined,
            stateNote: undefined,
            note: unavailableNote,
            unavailableBadge:
              probe === 'loading' ? '检查中' : '暂不开放任务 · 服务状态无法确认',
          }
        }

        // ② 管理员后台的能力配置覆盖。
        const override = capabilityKey ? capabilityLoad.map[capabilityKey] : undefined
        let resolved = capability
        if (override) {
          const available = canCreateFormalPrintScanTask(override.status)
          resolved = {
            ...capability,
            available,
            // 管理员关掉的项整卡停用（含证件照说明）。未配置的「尚未开放」说明页仍可进。
            to: available ? capability.to : '',
            state: available ? capability.state : undefined,
            note: available
              ? capability.note
              : (override.note ?? CAPABILITY_STATUS_NOTES[override.status] ?? capability.note),
            unavailableBadge: available ? capability.unavailableBadge : '暂不可用',
          }
        }

        // ③ MFP 轴：确定出不了纸时，停掉 needsMfp 的项。读不到状态不算离线。
        if (mfp === 'unavailable') {
          if (resolved.needsMfp) {
            return {
              ...resolved,
              available: false,
              to: '',
              state: undefined,
              stateNote: undefined,
              note: resolved.mfpOffNote ?? resolved.note,
              unavailableBadge: resolved.mfpOffBadge ?? `暂停 · ${device.printerLabel}`,
            }
          }
          return { ...resolved, stateNote: resolved.mfpOffStateNote ?? resolved.stateNote }
        }

        return resolved
      }),
    [
      capabilityLoad.map,
      confirmed,
      device.printerLabel,
      mfp,
      probe,
      unavailableNote,
    ]
  )

  const handleCapability = (key: string) => {
    const capability = capabilities.find((item) => item.key === key)
    if (!capability?.to) return
    navigate(capability.to, capability.state ? { state: capability.state } : undefined)
  }

  const handleQuickLink = (key: string) => {
    if (key === FEEDBACK_QUICK_LINK_KEY) {
      setFeedbackOpen(true)
      return
    }
    const link = QUICK_LINKS.find((item) => item.key === key)
    if (link?.to) navigate(link.to)
  }

  const locked =
    confirmed &&
    Object.values(capabilityLoad.map).some(
      (item) => item != null && !canCreateFormalPrintScanTask(item.status),
    )
  const hubState = deriveHubUiState({ probe, mfp, locked })
  const pill = HUB_PILL[hubState]

  return (
    <QxPageFrame
      title="打印扫描服务"
      status={pill}
      terminalLabel="就业服务大厅"
      navbar={
        <PrintHubNavbar
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      }
    >
      <QxPrintHubView
        hubState={hubState}
        probe={probe}
        mfp={mfp}
        colorDuplexLabel={colorDuplexChip(
          capabilityLoad.map.color_print?.status === 'available',
          capabilityLoad.map.duplex_print?.status === 'available',
        )}
        capabilities={capabilities.map((capability) => ({
          key: capability.key,
          icon: capability.icon,
          title: capability.title,
          description: capability.description,
          iconTone: capability.iconTone,
          wide: capability.wide,
          available: capability.available,
          actionable: Boolean(capability.to),
          stateNote: capability.stateNote,
          unavailableBadge: capability.unavailableBadge,
          note: capability.note,
        }))}
        arrivalCode={{
          ...ARRIVAL_CODE_ENTRY,
          stateNote: arrivalCodeStateNote(probe, mfp),
        }}
        quickLinks={QUICK_LINKS}
        capabilityGroupHint={capabilityGroupHint(probe, mfp, locked)}
        recordsGroupHint={recordsGroupHint()}
        notices={[
          COMPLIANCE_COPY.KIOSK_PRINT_SCAN_SENSITIVE,
          COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE,
          PRINT_HUB_PRICE_NOTICE,
        ]}
        onRetry={loadCapabilities}
        onHelp={() => navigate('/help')}
        onCapability={handleCapability}
        onArrivalCode={() => navigate(ARRIVAL_CODE_ENTRY.to)}
        onQuickLink={handleQuickLink}
      />
      <KioskFeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        issueOptions={PRINT_HUB_ISSUE_OPTIONS}
        description="选择这次遇到的问题，工作人员会核实后现场处理"
      />
    </QxPageFrame>
  )
}
