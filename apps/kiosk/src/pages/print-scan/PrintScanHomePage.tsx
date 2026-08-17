// ============================================================
// PrintScanHomePage — V6 打印扫描域首屏（P39）。
//
// 视觉与文案真值：docs/design/kiosk-ai-os-v3-2026-08/39-print-hub.html
// （含 PR #644 补的「到机码核销」入口卡）。迁移方向单向：原型 → 生产。
//
// 本文件只做容器：读真实状态、算每张卡能不能点、把结果交给 V6PrintHubView。
// 一切文案在 printHubContent.ts，一切样式在 styles/print-hub-v6.css。
//
// ══ 两条独立的状态轴（原型 CSS 头注释的裁定，迁移时逐条落地）══
//   ① 能力探测轴 probe：GET /terminals/:id/capabilities 读不到 → 七项一律不开，
//      只留不依赖本机能力的记录类入口。
//   ② 打印机（MFP）轴 mfp：GET /terminals/:id/printer-status。
//      **这一轴此前生产页完全没接** —— 原型的 device-off 说的就是它：
//      要出纸的四项（文档打印 / 照片打印 / 材料扫描 / 证件照）停，
//      纯软件的三项（手机扫码上传 / 格式转换 / 签名盖章）照常。
//      读不到状态时只说「读不到」，绝不声称「离线」（CLAUDE.md §9 不伪造能力）。
// ============================================================

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
  ImageIcon,
  LayersIcon,
  MessageSquareIcon,
  PenToolIcon,
  PrinterIcon,
  ScanLineIcon,
  SmartphoneIcon,
  TicketIcon,
  UserSquareIcon,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import {
  loadConfiguredCapabilities,
  type CapabilitiesLoadResult,
  type ConfiguredCapabilityMap,
} from '../../services/api/printScanCapabilities'
import { KioskFeedbackDialog } from '../../components/KioskFeedbackDialog'
import { PRINT_HUB_ISSUE_OPTIONS } from '../../services/api/kioskFeedback'
import {
  PRINT_HUB_PRICE_NOTICE,
  arrivalCodeHint,
  arrivalCodeStateNote,
  capabilityGroupHint,
  recordsGroupHint,
  type MfpStatus,
  type PrintHubCap,
  type ProbeStatus,
} from './printHubContent'
import {
  V6PrintHubView,
  type V6PrintQuickLinkView,
} from './components/V6PrintHubView'
import './styles/print-hub-v6.css'

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
  /** 原型 device-off 时这张卡的停用理由，逐字来自 39-print-hub.html。 */
  mfpOffBadge?: string
  mfpOffNote?: string
}

// 七件事。顺序照原型 39-print-hub.html:644-914 的栅格顺序（2 列 × 4 行）。
// 「到机码核销」不在这里 —— 它不是「在这台机器上从头办」的第八件事，
// 见下方 ARRIVAL_CODE_ENTRY。
const CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    key: 'doc-print',
    cap: 'doc',
    icon: FileTextIcon,
    title: '文档打印',
    description: 'PDF、图片上传后设参数打印，A4 黑白 / 彩色、双面可选',
    to: '/print/upload?source=document&tab=file',
    aiRole: 'ai',
    needsMfp: true,
    available: true,
    // 真有的：/print/material-check（页数识别 + A4 规范化评估 + 隐私片段检查）。
    // 没有的：打印参数建议 —— 后端 GET materials/tasks/:id/print-param-suggestions
    // 已实现，但前端零消费，用户拿不到，所以不写进卡面。
    stateNote: '可用 · 第 2 步材料体检：页数、A4 规范化、隐私片段；打印参数由你自己设',
    mfpOffBadge: '暂停 · 打印扫描一体机出不了纸',
    mfpOffNote: '这台机器出不了纸。文件可以先传上来存着，换一台再打。',
  },
  {
    key: 'phone-upload',
    cap: 'phone',
    icon: SmartphoneIcon,
    title: '手机扫码上传',
    description: '手机或其他联网设备扫码，把文件传到这台机器',
    to: '/print/upload?source=document&tab=qr',
    aiRole: 'none',
    needsMfp: false,
    available: true,
    stateNote: '可用 · 只是搬运，传完再去「文档打印」设参数',
    mfpOffStateNote: '照常可用 · 这一步不经过打印机，传上来先存着',
  },
  {
    key: 'scan',
    cap: 'scan',
    icon: ScanLineIcon,
    title: '材料扫描',
    description: '纸质材料扫成 PDF，可打印、可做简历识别',
    to: '/scan/start',
    aiRole: 'ai',
    needsMfp: true,
    available: true,
    // 扫描这一步本身不做文字识别（services/api/src/scan-tasks/ 全目录零 OCR）。
    // OCR 在结果页选「AI 简历识别」之后的简历链路里才发生，置信度也在那边的报告页
    // 如实标注（ResumeReportPage.tsx:62）。「需人工复核」这个标记全链路不存在。
    stateNote: '可用 · 扫成 PDF；文字识别在结果页的「AI 简历识别」里做，不在这一步',
    mfpOffBadge: '暂停 · 扫描仪就在这台一体机上',
    mfpOffNote: '打印和扫描是同一台机器，它出不了纸，扫描一起停。',
  },
  {
    key: 'photo-print',
    cap: 'photo',
    icon: ImageIcon,
    title: '照片打印',
    description: '和文档打印同一条流程：进去第 1 步选图片（本机上传 / 手机扫码传），再设参数',
    to: '/print/upload?source=document&tab=file',
    state: { category: 'photo' },
    aiRole: 'ai',
    needsMfp: true,
    available: true,
    // 走的就是文档打印那条流程，所以体检是同一套。「彩色与纸张的取舍理由」
    // 没有任何实现 —— 颜色、纸张、份数都在预览页由用户自己设。
    stateNote: '可用 · 和文档打印同一条流程、同一套材料体检；彩色与纸张由你自己设',
    mfpOffBadge: '暂停 · 同一台打印机',
    mfpOffNote: '照片走文档打印同一条出纸链路，那条停了，这条也出不了。',
  },
  {
    key: 'id-photo',
    cap: 'idphoto',
    icon: UserSquareIcon,
    title: '证件照',
    description: '常见规格证件照排版打印，当前可先用「照片打印」',
    to: '/print-scan/feature/id-photo',
    aiRole: 'ai',
    needsMfp: true,
    available: false,
    // /print-scan/feature/id-photo 是 PrintScanFeatureInfoPage 的一个静态说明页。
    // 「规格体检」「换底」在前后端都没有任何实现，不能写成这张卡的能力。
    stateNote: '进去只有常见规格说明 · 本机现在不做证件照排版，也不做换底',
    unavailableBadge: '尚未开放 · 可先了解',
    mfpOffBadge: '尚未开放 · 出片也要这台打印机',
    mfpOffNote: '功能本身还没开放；就算排好版，出片也要这台机器。',
  },
  {
    key: 'convert',
    cap: 'convert',
    icon: LayersIcon,
    title: '格式转换',
    description: '多张图片（最多 20 张）合并成一份 PDF，便于打印和存档',
    to: '/print-scan/convert',
    // ConvertImagesPage 全页只有手动「上移 / 下移 / 移除」，服务端 print-convert
    // 也没有任何 LLM / OCR 调用。这条链路自始至终不依赖 AI，标 ai 是虚标。
    aiRole: 'none',
    needsMfp: false,
    available: true,
    stateNote: '可用 · 页序用「上移 / 下移」自己排；本机不识别方向、不自动排序',
    mfpOffStateNote: '照常可用 · 合并不经过打印机，合完先存着',
  },
  {
    key: 'sign',
    cap: 'sign',
    icon: PenToolIcon,
    title: '签名盖章',
    description: '在 PDF 上叠加签名 / 印章图片（版式合成，非 CA 电子签）',
    to: '/print-scan/sign',
    // POST /print/sign/inspect 只返回 { pages }（print-sign.service.ts:78-95），
    // 服务端 print-sign 目录零 LLM / 零 OCR。落款位没有任何建议能力。
    aiRole: 'none',
    needsMfp: false,
    available: true,
    stateNote: '可用 · 本机只读出总页数；落款页码、方位与大小全部由你选',
    mfpOffStateNote: '照常可用 · 合成不经过打印机，出纸要换机',
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
    '小程序下单后拿到的 10 位到机码，扫码或手输，核销后付款出纸 · 不是付款后的取件凭证码',
  to: '/print/pickup-claim',
} as const

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

/** 反馈入口的 key。它不跳路由，而是就地打开匿名反馈弹层（见 handleQuickLink）。 */
const FEEDBACK_QUICK_LINK_KEY = 'feedback'

const QUICK_LINKS: readonly (V6PrintQuickLinkView & { to?: string })[] = [
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
  const { user } = useAuth()
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
      CAPABILITIES.map((capability) => {
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
        }

        // ③ MFP 轴：确定出不了纸时，停掉要出纸的四项，其余照常。
        //    「说明页」类入口（证件照）保留可达 —— 了解详情不需要打印机。
        if (mfp === 'unavailable') {
          if (resolved.needsMfp) {
            return {
              ...resolved,
              available: false,
              to: resolved.to.startsWith('/print-scan/feature/') ? resolved.to : '',
              state: undefined,
              stateNote: undefined,
              note: resolved.mfpOffNote ?? resolved.note,
              unavailableBadge: resolved.mfpOffBadge ?? `暂停 · ${device.printerLabel}`,
            }
          }
          // 不经过打印机的三项：状态行换成「照常可用」，明说为什么不受影响。
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

  const signedIn = Boolean(user)

  return (
    <KioskPageFrame className="v6-print-hub-page">
      <V6PrintHubView
        probe={probe}
        mfp={mfp}
        mfpLabel={device.printerLabel}
        signedIn={signedIn}
        capabilities={capabilities.map((capability) => ({
          ...capability,
          actionable: Boolean(capability.to),
        }))}
        arrivalCode={{
          ...ARRIVAL_CODE_ENTRY,
          hint: arrivalCodeHint(signedIn, probe, mfp),
          stateNote: arrivalCodeStateNote(probe, mfp),
        }}
        quickLinks={QUICK_LINKS}
        capabilityGroupHint={capabilityGroupHint(probe, mfp)}
        recordsGroupHint={recordsGroupHint(signedIn, mfp)}
        notices={[
          COMPLIANCE_COPY.KIOSK_PRINT_SCAN_SENSITIVE,
          COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE,
          PRINT_HUB_PRICE_NOTICE,
        ]}
        onAdvisor={() => navigate('/assistant')}
        onRetry={loadCapabilities}
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
    </KioskPageFrame>
  )
}
