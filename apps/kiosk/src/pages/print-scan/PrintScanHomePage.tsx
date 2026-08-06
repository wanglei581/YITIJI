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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import {
  COMPLIANCE_COPY,
  canCreateFormalPrintScanTask,
  type PrintScanCapabilityKey,
  type PrintScanCapabilityStatus,
} from '@ai-job-print/shared'
import {
  loadConfiguredCapabilities,
  type CapabilitiesLoadResult,
  type ConfiguredCapabilityMap,
} from '../../services/api/printScanCapabilities'
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
  SparklesIcon,
  SmartphoneIcon,
  UserSquareIcon,
} from 'lucide-react'
import './styles/print-scan-fusion.css'
import './styles/print-scan-home.css'
import './styles/print-scan-uplift.css'

interface Capability {
  key: string
  icon: React.ComponentType<{ className?: string }>
  accent: 'teal' | 'clay' | 'wheat' | 'plum' | 'slate'
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
    accent: 'slate',
    title: '文档打印',
    description: 'PDF、图片上传后先做材料检查，再设置参数打印',
    to: '/print/upload',
    available: true,
  },
  {
    key: 'phone-upload',
    icon: SmartphoneIcon,
    accent: 'slate',
    title: '手机扫码上传',
    description: '手机或其他联网设备扫码上传文件，一体机确认后打印',
    to: '/print/upload?source=document&tab=qr',
    available: true,
  },
  {
    key: 'scan',
    icon: ScanLineIcon,
    accent: 'teal',
    title: '材料扫描',
    description: '纸质材料扫描成 PDF，可打印、做简历识别；登录后可在「我的文档」管理',
    to: '/scan/start',
    available: true,
  },
  {
    key: 'photo-print',
    icon: ImageIcon,
    accent: 'plum',
    title: '照片打印',
    description: '上传 JPG / PNG 照片打印，走文档打印同一检查流程',
    to: '/print/upload',
    state: { category: 'photo' },
    available: true,
  },
  {
    key: 'id-photo',
    icon: UserSquareIcon,
    accent: 'wheat',
    title: '证件照',
    description: '常见规格证件照排版打印，当前可先用「照片打印」',
    to: '/print-scan/feature/id-photo',
    available: false,
  },
  {
    key: 'convert',
    icon: FileType2Icon,
    accent: 'slate',
    title: '格式转换',
    description: '多张图片（最多 20 张）合并为一份 PDF，便于打印和存档',
    to: '/print-scan/convert',
    available: true,
  },
  {
    key: 'sign',
    icon: PenToolIcon,
    accent: 'clay',
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
  const [capabilityLoad, setCapabilityLoad] = useState<
    CapabilitiesLoadResult | { status: 'loading'; map: ConfiguredCapabilityMap }
  >({ status: 'loading', map: {} })

  const loadCapabilities = useCallback(() => {
    setCapabilityLoad({ status: 'loading', map: {} })
    void loadConfiguredCapabilities().then(setCapabilityLoad)
  }, [])

  useEffect(() => {
    let cancelled = false
    setCapabilityLoad({ status: 'loading', map: {} })
    void loadConfiguredCapabilities().then((result) => {
      if (!cancelled) setCapabilityLoad(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const capabilitiesConfirmed = capabilityLoad.status === 'ok'
  const serviceUnavailableNote =
    capabilityLoad.status === 'loading' ? '正在确认本机服务配置' : '服务状态无法确认，请重新检测'

  const capabilities = useMemo<Capability[]>(
    () =>
      CAPABILITIES.map((cap) => {
        const key = CARD_CAPABILITY_KEY[cap.key]
        if (!capabilitiesConfirmed && key) {
          return {
            ...cap,
            available: false,
            to: '',
            state: undefined,
            note: serviceUnavailableNote,
            unavailableBadge: capabilityLoad.status === 'loading' ? '检查中' : '状态未确认',
          }
        }
        const override = key ? capabilityLoad.map[key] : undefined
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
    [capabilitiesConfirmed, capabilityLoad.map, capabilityLoad.status, serviceUnavailableNote]
  )

  return (
    <KioskPageFrame className="w2-print-scan-page">
      <div
        data-w2-page="print-scan-home"
        className="w2-print-scan-shell flex h-full flex-col overflow-y-auto bg-canvas"
      >
        <KioskPageHeader
          title="打印扫描服务"
          description="文档打印 · 手机扫码上传 · 材料扫描 · 照片与证件照 · 格式转换 · 签名盖章"
          onBack={() => navigate('/')}
          backLabel="返回"
        />

        <section className="ps-ai-rail" aria-label="在线服务状态" aria-live="polite">
          <SparklesIcon aria-hidden="true" />
          <div className="ps-ai-rail__copy">
            <b>
              {capabilitiesConfirmed
                ? '在线服务已连接'
                : capabilityLoad.status === 'loading'
                  ? '正在确认在线服务'
                  : '服务状态无法确认'}
            </b>
            <span>格式、隐私与打印参数仍会在提交后按真实处理结果再次确认</span>
          </div>
          <span className="ps-ai-rail__status">
            {capabilitiesConfirmed
              ? '配置已读取'
              : capabilityLoad.status === 'loading'
                ? '检查中'
                : '暂不开放任务'}
          </span>
          <button
            type="button"
            disabled={capabilityLoad.status === 'loading'}
            onClick={() => {
              if (capabilitiesConfirmed) navigate('/assistant')
              else loadCapabilities()
            }}
          >
            {capabilitiesConfirmed
              ? '让小青安排打印'
              : capabilityLoad.status === 'loading'
                ? '正在检查'
                : '重新检测'}
          </button>
        </section>

        {/* 隐私保护提示 */}
        <div className="ps-notice">
          <ShieldCheckIcon aria-hidden="true" />
          <p>{COMPLIANCE_COPY.KIOSK_PRINT_SCAN_SENSITIVE}</p>
        </div>

        {/* 7 能力卡 + 本机设备能力卡（2 列等高网格） */}
        <div className="ps-cap-grid">
          {capabilities.map((cap) => {
            const Icon = cap.icon
            const isDisabled = !cap.to
            return (
              <button
                key={cap.key}
                type="button"
                onClick={() => {
                  if (!cap.to) return
                  navigate(cap.to, cap.state ? { state: cap.state } : undefined)
                }}
                disabled={isDisabled}
                className={`ps-cap ps-accent--${cap.accent}${!cap.available ? ' ps-cap--unavailable' : ''}`}
              >
                <div className="ps-cap__top">
                  <span className="ps-cap__icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <h3>{cap.title}</h3>
                  {!cap.available && (
                    <span className="ps-cap__badge">{cap.unavailableBadge ?? '即将上线'}</span>
                  )}
                </div>
                <p className="ps-cap__description">{cap.description}</p>
                {cap.note && <p className="ps-cap__note">{cap.note}</p>}
                <div className="ps-cap__footer">
                  {cap.to ? (
                    <span className="ps-cap__go">
                      {cap.available ? '进入' : '了解详情'}
                      <ChevronRightIcon aria-hidden="true" />
                    </span>
                  ) : (
                    <span className="ps-cap__disabled-label">暂不可用</span>
                  )}
                </div>
              </button>
            )
          })}

          {/* 本机配置状态卡（第 8 格） */}
          <div className="ps-device-card ps-accent--teal">
            <h3>
              本机服务配置
              <span>
                {capabilitiesConfirmed
                  ? '配置已读取，具体硬件状态提交前再确认'
                  : '当前无法确认设备能力'}
              </span>
            </h3>
            <div className="ps-device-card__rows">
              {[
                capabilitiesConfirmed
                  ? '打印、扫描与材料处理入口按本机配置开放'
                  : '未取得本机打印扫描能力配置',
                '纸张、耗材、双面与输稿器状态在提交任务前确认',
                '未确认能力不会创建正式打印或扫描任务',
              ].map((item) => (
                <span key={item}>
                  {capabilitiesConfirmed ? (
                    <CheckIcon aria-hidden="true" />
                  ) : (
                    <InfoIcon aria-hidden="true" />
                  )}
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* 我的打印记录（登录后可查看） */}
        <div className="ps-records">
          <div className="ps-records__head">
            <b>我的打印记录</b>
            <span>登录后可查看历史记录与凭证</span>
          </div>
          <div className="ps-quick-row">
            {QUICK_LINKS.map((link) => {
              const Icon = link.icon
              return (
                <button
                  key={link.key}
                  type="button"
                  onClick={() => navigate(link.to)}
                  className="ps-quick"
                >
                  <span className="ps-quick__icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="ps-quick__copy">
                    <b>{link.title}</b>
                    <span>{link.description}</span>
                  </span>
                  <ChevronRightIcon className="ps-quick__arrow" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </div>

        {/* 非 CA 电子签说明 */}
        <div className="ps-notice ps-notice--legal">
          <InfoIcon aria-hidden="true" />
          <p>{COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE}</p>
        </div>
      </div>
    </KioskPageFrame>
  )
}
