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
    <div className="flex h-full flex-col overflow-y-auto bg-canvas p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">智慧校园</h1>
          <p className="mt-0.5 text-sm text-neutral-500">校园场景服务专区</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
          返回首页
        </Button>
      </div>

      {/* 合规来源条 */}
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-plum-soft bg-plum-soft/60 px-4 py-3">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-plum" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-plum">
          校方授权的官方校园服务入口。仅信息展示与指引，不在本终端采集任何个人信息。
        </p>
      </div>

      {!config.enabled || cards.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 p-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100">
            <PartyPopperIcon className="h-7 w-7 text-neutral-400" aria-hidden="true" />
          </div>
          <p className="text-sm text-neutral-500">本机暂未开启智慧校园服务</p>
          <Button size="lg" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {cards.map((entry) => {
            const Icon = entry.icon
            const disabled = !entry.to
            return (
              <button
                key={entry.key}
                type="button"
                disabled={disabled}
                onClick={() => entry.to && navigate(entry.to)}
                className={[
                  'flex min-h-[148px] flex-col rounded-xl border bg-white p-5 text-left shadow-sm transition-colors',
                  disabled
                    ? 'cursor-not-allowed border-neutral-200 opacity-70'
                    : 'border-neutral-200 hover:border-plum/30 hover:bg-plum-soft/40 active:bg-plum-soft/40',
                ].join(' ')}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-plum-soft">
                  <Icon className="h-7 w-7 text-plum" aria-hidden="true" />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-neutral-900">{entry.title}</h3>
                  {disabled && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
                      即将上线
                    </span>
                  )}
                </div>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-neutral-500">{entry.description}</p>
                {!disabled && (
                  <div className="mt-2 flex min-h-[28px] items-center gap-0.5 text-sm font-semibold text-plum">
                    <span>进入</span>
                    <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      <div className="h-2" />
    </div>
  )
}
