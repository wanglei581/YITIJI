// ============================================================
// PrintScanHomePage — 打印扫描 Hub（青序流光 10-print-hub）。
//
// 视觉真值：docs/design/kiosk-redesign-2026-08-v2/10-print-hub.html
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
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
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
import { getTerminalId, subscribeTerminalIdentity } from '../../services/api/screensaver'
import {
  loadConfiguredCapabilities,
  resolveCapabilityOverride,
  type CapabilitiesLoadResult,
  type ConfiguredCapabilityMap,
} from '../../services/api/printScanCapabilities'
import { KioskFeedbackDialog } from '../../components/KioskFeedbackDialog'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { PRINT_HUB_ISSUE_OPTIONS } from '../../services/api/kioskFeedback'
import {
  COPY_GUIDE_KEY,
  COPY_GUIDE_ROUTE,
  HUB_PILL,
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
 * 卡面描述按稿 10 的密度只留一行半；彩色 / 双面状态统一显示在「01 要办什么」的只读说明。
 */
function describeDocPrint(map: ConfiguredCapabilityMap): string {
  const extras = docPrintExtras(map)
  return extras.on.length > 0
    ? `选文件，检查后设参数；${extras.on.join(' / ')}可选`
    : '选文件，检查后设参数'
}

function docPrintExtras(map: ConfiguredCapabilityMap): { on: string[]; off: string[] } {
  const on: string[] = []
  const off: string[] = []
  for (const [key, label] of [
    ['color_print', '彩色'],
    ['duplex_print', '双面'],
  ] as const) {
    ;(map[key]?.status === 'available' ? on : off).push(label)
  }
  return { on, off }
}

const CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    key: 'doc-print',
    cap: 'doc',
    icon: FileTextIcon,
    title: '文档打印',
    description: '选文件，检查后设参数',
    to: '/print/upload?source=document&tab=file',
    aiRole: 'ai',
    needsMfp: true,
    available: true,
    iconTone: 'teal',
    // 运行时由 describeDocPrintFoot 按本机彩色 / 双面登记改写；这里是未登记时的口径。
    stateNote: '带走：打印件',
    mfpOffBadge: '这台机器现在出不了纸',
    mfpOffNote: '文件可以先传上来存着，换一台再打。',
  },
  {
    key: 'phone-upload',
    cap: 'phone',
    icon: SmartphoneIcon,
    title: '手机扫码上传',
    description: '扫码把手机文件传过来',
    to: '/print/upload?source=document&tab=qr&mode=transfer',
    aiRole: 'none',
    needsMfp: false,
    available: true,
    iconTone: 'slate',
    stateNote: '带走：打印件',
    mfpOffStateNote: '照常可用 · 传上来先存着',
  },
  {
    key: 'usb-import',
    cap: 'usb',
    icon: UsbIcon,
    title: 'U 盘导入打印',
    description: '从 U 盘选文件打印',
    to: '/print/upload?source=document&tab=usb&mode=transfer',
    aiRole: 'none',
    needsMfp: false,
    available: true,
    iconTone: 'slate',
    stateNote: '带走：打印件',
    mfpOffStateNote: '照常可用 · 导入后先存着',
  },
  {
    key: 'photo-print',
    cap: 'photo',
    icon: ImageIcon,
    title: '照片打印',
    description: '选照片，检查后设参数',
    to: '/print/upload?source=document&tab=file&category=photo',
    state: { category: 'photo' },
    aiRole: 'ai',
    needsMfp: true,
    available: true,
    iconTone: 'clay',
    stateNote: '带走：照片打印件',
    mfpOffBadge: '这台机器现在出不了纸',
    mfpOffNote: '打印暂时不可用，请稍后再试。',
  },
  {
    key: 'scan',
    cap: 'scan',
    icon: ScanLineIcon,
    title: '材料扫描',
    description: '到打印机面板扫描',
    to: '/scan',
    aiRole: 'ai',
    needsMfp: true,
    available: true,
    iconTone: 'slate',
    stateNote: '带走：扫描文件',
    mfpOffBadge: '这台机器现在出不了纸',
    mfpOffNote: '扫描和打印是同一台机器，一起停。',
  },
  {
    key: 'convert',
    cap: 'convert',
    icon: LayersIcon,
    title: '格式转换',
    description: '多张图片合成 PDF',
    to: '/print-scan/convert',
    aiRole: 'none',
    needsMfp: false,
    available: true,
    iconTone: 'teal',
    stateNote: '带走：合并 PDF',
    mfpOffStateNote: '照常可用 · 合完先存着',
  },
  {
    key: 'sign',
    cap: 'sign',
    icon: PenToolIcon,
    title: '签名',
    description: '放入本人手写签名',
    to: '/print-scan/sign',
    aiRole: 'none',
    needsMfp: false,
    available: true,
    iconTone: 'clay',
    stateNote: '带走：生成的新 PDF',
    mfpOffStateNote: '照常可用 · 出纸要换机',
  },
  {
    key: 'id-photo',
    cap: 'idphoto',
    icon: UserSquareIcon,
    title: '证件照',
    description: '尚未开放，可查看说明',
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
    '输入 8 位数字到机码（历史 10 位码也支持），核对订单后领取打印件。',
  to: '/print/pickup-claim',
  emphasis: ['8 位数字到机码'],
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
  unsupported: '本机不支持此项服务',
  not_verified: '本机暂未开通',
}

/** 反馈入口的 key。它不跳路由，而是就地打开匿名反馈弹层（见 handleQuickLink）。 */
const FEEDBACK_QUICK_LINK_KEY = 'feedback'

const QUICK_LINKS: readonly (QxPrintQuickLinkView & { to?: string })[] = [
  {
    key: 'documents',
    icon: FilesIcon,
    title: '我的文档',
    description: '选文件，带走打印件',
    to: '/me/documents',
  },
  {
    key: 'print-orders',
    icon: PrinterIcon,
    title: '打印订单',
    description: '查看订单与取件凭证码',
    to: '/me/print-orders',
  },
  {
    // 免登录：就地开弹层打匿名端点。旧实现跳 /me/feedback（会员面，必须登录），
    // 一体机是公共位设备，绝大多数用户没登录，那个入口对他们是死的。
    key: FEEDBACK_QUICK_LINK_KEY,
    icon: MessageSquareIcon,
    title: '反馈问题',
    description: '反馈打印或扫描问题，无需登录',
    compact: true,
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
  // Hub 只选办理入口，使用中性文案；价目由后续打印确认页读取，离开扫描不额外取价。
  const terminalId = useSyncExternalStore(subscribeTerminalIdentity, getTerminalId, () => '')
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
    let retryTimer: number | null = null
    const load = () => void loadConfiguredCapabilities().then((result) => {
      if (cancelled) return
      setCapabilityLoad(result)
      // Agent/能力配置可能晚于页面到达；失败态先对用户如实收口，后台短暂重试以便自动恢复。
      if (result.status === 'error') {
        retryTimer = window.setTimeout(() => {
          if (!cancelled) load()
        }, 5_000)
      }
    })
    load()
    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [terminalId])

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

  const capabilities = useMemo(
    () =>
      CAPABILITIES.map((rawCapability) => {
        // 文档打印卡的彩色/双面表述按本机能力登记动态改写，其余卡原样。
        const capability =
          rawCapability.key === 'doc-print'
            ? {
                ...rawCapability,
                description: describeDocPrint(capabilityLoad.map),
                stateNote: '带走：打印件',
              }
            : rawCapability
        const capabilityKey = CARD_CAPABILITY_KEY[capability.key]

        // ① 探测轴优先：读不到能力配置 → 八项一律不开（含证件照说明页）。
        //    理由只写在徽标上一次；「重新检测 / 联系工作人员」在页顶状态块里，不在八张卡上各抄一遍。
        if (!confirmed && capabilityKey) {
          return {
            ...capability,
            available: false,
            to: '',
            state: undefined,
            stateNote: undefined,
            note: undefined,
            unavailableBadge:
              probe === 'loading' ? '检查中' : '暂不开放任务 · 服务状态无法确认',
          }
        }

        // ② 管理员后台的能力配置覆盖。签名这类默认拒绝的键：读取成功但没登记 =
        //    本机暂未开通，按 not_verified 整卡停用（resolveCapabilityOverride），与服务端一致。
        const override = capabilityKey ? resolveCapabilityOverride(capabilityLoad, capabilityKey) : undefined
        let resolved = capability
        if (override) {
          const available = canCreateFormalPrintScanTask(override.status)
          resolved = {
            ...capability,
            available,
            // 管理员关掉的项整卡停用（含证件照说明）。未配置的「尚未开放」说明页仍可进。
            to: available ? capability.to : '',
            state: available ? capability.state : undefined,
            note: available ? capability.note : (override.note ?? undefined),
            unavailableBadge: available
              ? capability.unavailableBadge
              : (CAPABILITY_STATUS_NOTES[override.status] ?? '暂不可用'),
          }
        }

        // ③ MFP 轴：确定出不了纸、或打印闸门合上时，停掉 needsMfp 的项。读不到状态不算离线。
        // 闸门合上沿用同一套停用卡，短标题和说明改成暂停接单，不说成缺纸或离线。
        if (mfp === 'unavailable') {
          if (resolved.needsMfp) {
            const orderPaused = Boolean(device.printerNotice)
            return {
              ...resolved,
              available: false,
              to: '',
              state: undefined,
              stateNote: undefined,
              note: orderPaused ? device.printerNotice : (resolved.mfpOffNote ?? resolved.note),
              unavailableBadge: orderPaused
                ? device.printerLabel
                : (resolved.mfpOffBadge ?? `暂停 · ${device.printerLabel}`),
            }
          }
          return { ...resolved, stateNote: resolved.mfpOffStateNote ?? resolved.stateNote }
        }

        return resolved
      }),
    [
      capabilityLoad,
      confirmed,
      device.printerLabel,
      device.printerNotice,
      mfp,
      probe,
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
    // R4（2026-09-29）：复印卡改为可点，进「怎么在打印机面板上复印」说明态。
    if (key === COPY_GUIDE_KEY) {
      navigate(COPY_GUIDE_ROUTE)
      return
    }
    const link = QUICK_LINKS.find((item) => item.key === key)
    if (link?.to) navigate(link.to)
  }

  // 只数管理员真配置过的行：签名没登记是默认关，不是「被管理员关闭」，
  // 不因它把整页切到 locked 态（那张卡已在 ② 里单独停用）。
  const locked =
    confirmed &&
    Object.values(capabilityLoad.map).some(
      (item) => item != null && !canCreateFormalPrintScanTask(item.status),
    )
  const hubState = deriveHubUiState({ probe, mfp, locked })
  const pill = HUB_PILL[hubState]
  const printerUnavailable = {
    label: device.printerLabel,
    notice: device.printer.errorCode === 'paperEmpty'
      ? '打印机缺纸，请找现场工作人员加纸'
      : device.kind === 'offline'
        ? '打印机当前无法连接，请找现场工作人员'
        : '打印机异常，请找现场工作人员检查',
  }

  return (
    <QxPageFrame
      back={{ label: '返回首页', onBack: () => navigate('/') }}
      title="打印扫描服务"
      status={device.printerNotice ? { tone: 'bad', label: device.printerLabel } : hubState === 'device-off' ? { tone: 'warn', label: `${device.printerLabel} · 出纸类暂停` } : pill}
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
        printerUnavailable={printerUnavailable}
        orderPaused={
          hubState === 'device-off' && device.printerNotice
            ? { label: device.printerLabel, notice: device.printerNotice }
            : undefined
        }
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
          stateNote: probe === 'ok' && device.printerNotice
            ? device.printerNotice
            : arrivalCodeStateNote(probe, mfp),
        }}
        quickLinks={QUICK_LINKS}
        capabilityGroupHint={mfp === 'unavailable' && confirmed ? device.printerLabel : capabilityGroupHint(probe, mfp, locked)}
        recordsGroupHint={recordsGroupHint()}
        notices={[
          COMPLIANCE_COPY.KIOSK_PRINT_SCAN_SENSITIVE,
          COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE,
        ]}
        onRetry={loadCapabilities}
        onHelp={() => navigate('/help')}
        onCapability={handleCapability}
        onArrivalCode={() => navigate(ARRIVAL_CODE_ENTRY.to)}
        onQuickLink={handleQuickLink}
        onBack={() => navigate('/')}
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
