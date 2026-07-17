// ============================================================
// SmartCampusHomePage — 智慧校园服务中心（/smart-campus）
//
// 按终端开关：仅当后端返回 enabled 时，首页才出现入口卡进入本页。
// 子模块按 config.modules 显隐。迎新系统 / 校园大数据为真实可达页面；
// 行李帮运 / 校园全景为校园服务说明页（仅信息展示与指引）。
// 校园卡办理 / 一卡通开通 / 校园网开通为校园自助服务卡，随校园开启一并展示，点进
// 各自说明页给出办理指引（本期前端入口/说明，未接真实办理后端）。
//
// 合规：仅信息展示与指引，不采集任何个人信息；无任何招聘闭环语义。
// ============================================================

import { Button, Card } from '@ai-job-print/ui'
import { useNavigate } from 'react-router-dom'
import {
  ChevronRightIcon,
  CreditCardIcon,
  KeyRoundIcon,
  PackageIcon,
  PartyPopperIcon,
  ScanFaceIcon,
  ShieldCheckIcon,
  WifiIcon,
  type LucideIcon,
} from 'lucide-react'
import type { SmartCampusModuleKey } from '@ai-job-print/shared'
import { useSmartCampusConfig } from '../../hooks/useSmartCampusConfig'
import '../prototype/kiosk-prototype.css'

interface SmartCampusCard {
  key: string
  icon: LucideIcon
  title: string
  description: string
  /** 有则可点进入；缺省表示「即将上线」（占位模块卡用） */
  to?: string
}

/** 模块卡：受 config.modules 开关按终端控制显隐（本期 only 迎新可达）。 */
interface EntryDef extends SmartCampusCard {
  key: SmartCampusModuleKey
}

const ENTRIES: EntryDef[] = [
  {
    key: 'welcome',
    icon: PartyPopperIcon,
    title: '迎新系统',
    description: '报到流程、办事窗口、入学与求职准备',
    to: '/smart-campus/welcome',
  },
  // 校园大数据本期严格冻结：不在此列出入口，后端开关亦强制 false，直达 URL 仅见“未开放”。
  { key: 'luggage', icon: PackageIcon, title: '行李帮运', description: '合作物流服务入口与服务点说明', to: '/smart-campus/service/luggage' },
  { key: 'panorama', icon: ScanFaceIcon, title: 'VR校园', description: '360° 云游校园与重点场馆介绍', to: '/smart-campus/service/panorama' },
]

// 校园自助服务卡：与模块卡同一套卡片体系，校园开启即随迎新一并展示（基础校园服务，
// 不按单模块开关）。点进各自说明页给出办理指引（本期为前端入口/说明，未接真实办理后端）。
const SERVICE_ENTRIES: SmartCampusCard[] = [
  {
    key: 'campus-card',
    icon: CreditCardIcon,
    title: '校园卡办理',
    description: '新生办卡、补卡、挂失后快速办理',
    to: '/smart-campus/service/campus-card',
  },
  {
    key: 'all-in-one',
    icon: KeyRoundIcon,
    title: '一卡通开通',
    description: '开通食堂、门禁、图书馆等校园通行权限',
    to: '/smart-campus/service/all-in-one',
  },
  {
    key: 'campus-network',
    icon: WifiIcon,
    title: '校园网开通',
    description: '激活校园 Wi-Fi、宿舍网络与上网账号',
    to: '/smart-campus/service/campus-network',
  },
]

export function SmartCampusHomePage() {
  const navigate = useNavigate()
  const config = useSmartCampusConfig()

  const moduleEntries = ENTRIES.filter((e) => config.modules[e.key])
  // 校园开启即在同一卡片网格内追加校园自助服务卡；关闭（机器搬离校园）时整张不渲染。
  const cards: SmartCampusCard[] = config.enabled ? [...moduleEntries, ...SERVICE_ENTRIES] : []

  return (
    <div className="kproto kproto-teal">
      <div className="kproto-shell">
        <div className="kproto-pagehead">
          <button type="button" className="kproto-back" onClick={() => navigate('/')}>
            返回首页
          </button>
          <div className="kproto-title">
            <h1>智慧校园</h1>
            <p>校园场景服务专区 · 本机已开启校园模式</p>
          </div>
          <div className="kproto-aside">
            <span className="kproto-badge">本校已开通 {cards.length} 项服务</span>
          </div>
        </div>

        <main className="kproto-content">
          <div className="kproto-auth">
            <ShieldCheckIcon aria-hidden="true" />
            <p>
          校方授权的官方校园服务入口。仅信息展示与指引，不在本终端采集任何个人信息。
            </p>
          </div>

          {!config.enabled || cards.length === 0 ? (
            <Card className="kproto-card flex flex-col items-center justify-center gap-4 p-10 text-center">
              <PartyPopperIcon className="h-12 w-12 text-neutral-400" aria-hidden="true" />
              <p className="text-lg text-neutral-500">本机暂未开启智慧校园服务</p>
              <Button size="lg" onClick={() => navigate('/')}>返回首页</Button>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-5">
              {cards.map((entry) => {
                const Icon = entry.icon
                const disabled = !entry.to
                return (
                  <button
                    key={entry.key}
                    type="button"
                    disabled={disabled}
                    onClick={() => entry.to && navigate(entry.to)}
                    className={`flex min-h-[220px] flex-col rounded-[18px] border bg-[var(--kp-surface)] p-7 text-left shadow-sm ${disabled ? 'cursor-not-allowed opacity-60' : 'active:scale-[.985]'}`}
                  >
                    <span className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]">
                      <Icon className="h-8 w-8" aria-hidden="true" />
                    </span>
                    <span className="mt-5 flex items-center gap-3">
                      <b className="font-serif text-[28px] font-bold tracking-[1px]">{entry.title}</b>
                      {disabled && <span className="kproto-chip">即将上线</span>}
                    </span>
                    <span className="mt-2 flex-1 text-[19px] leading-normal text-[var(--kp-muted)]">{entry.description}</span>
                    {!disabled && (
                      <span className="mt-3 inline-flex items-center gap-2 text-[20px] font-bold text-[var(--kp-accent-deep)]">
                        进入<ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          <div className="kproto-notice mt-auto">
            <ShieldCheckIcon aria-hidden="true" />
            <p>
              实际办理请前往现场服务窗口或学校官方自助平台；校园大数据模块暂未开放，开放前不展示任何统计数据。
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
