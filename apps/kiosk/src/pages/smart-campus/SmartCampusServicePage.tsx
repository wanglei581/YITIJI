// ============================================================
// SmartCampusServicePage — 校园自助服务办理说明（/smart-campus/service/:key）
//   key = campus-card | all-in-one | campus-network | luggage | panorama
//
// 校园卡办理 / 一卡通开通 / 校园网开通三项自助服务的办理指引页。
// 本期（Phase 1）只做办理说明 + 所需材料 + 现场窗口指引，未接真实办理后端；
// 与迎新系统同属「仅信息展示与指引」，沿用智慧校园页面视觉（indigo + emerald 合规条）。
//
// 合规（compliance-boundary.md §九）：仅展示与指引，不在本终端采集任何个人信息；
// 实际办理一律引导至现场服务窗口 / 学校官方自助平台。无任何招聘闭环语义。
// ============================================================

import { Button, Card } from '@ai-job-print/ui'
import { useNavigate, useParams } from 'react-router-dom'
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  ClipboardListIcon,
  CreditCardIcon,
  KeyRoundIcon,
  MapPinIcon,
  PackageIcon,
  PartyPopperIcon,
  ScanFaceIcon,
  ShieldCheckIcon,
  WifiIcon,
  type LucideIcon,
} from 'lucide-react'

type ServiceKey = 'campus-card' | 'all-in-one' | 'campus-network' | 'luggage' | 'panorama'

interface ServiceInfo {
  icon: LucideIcon
  title: string
  subtitle: string
  summary: string
  /** 办理事项 / 开通权限 / 开通内容 的小标题（各服务措辞不同） */
  itemsTitle: string
  items: string[]
  /** 所需材料 */
  materials: string[]
  /** 现场办理地点 / 窗口 */
  location: string
  /** 底部现场办理提示 */
  note: string
}

const SERVICES: Record<ServiceKey, ServiceInfo> = {
  'campus-card': {
    icon: CreditCardIcon,
    title: '校园卡办理',
    subtitle: '新生办卡 · 补卡 · 挂失',
    summary: '新生办卡、补卡、挂失后快速办理。',
    itemsTitle: '办理事项',
    items: ['新生首次办卡', '卡片遗失补办', '挂失与解挂', '信息变更换卡'],
    materials: ['录取通知书 / 学生证', '本人身份证原件', '近期一寸免冠照片'],
    location: '校园卡服务中心（一卡通中心）· 行政楼一层',
    note: '校园卡线上办理后续开放，目前请携带上述材料前往校园卡服务中心办理；办理中遇到问题，可联系现场工作人员协助。',
  },
  'all-in-one': {
    icon: KeyRoundIcon,
    title: '一卡通开通',
    subtitle: '食堂 · 门禁 · 图书馆',
    summary: '开通食堂、门禁、图书馆等校园通行权限。',
    itemsTitle: '开通权限',
    items: ['食堂与校内消费', '宿舍 / 教学楼门禁', '图书馆借阅', '自助圈存与充值'],
    materials: ['已办理的校园卡', '本人学号'],
    location: '一卡通服务中心 · 自助圈存机（食堂、宿舍楼一层）',
    note: '一卡通权限开通暂未接入本终端线上办理，请前往一卡通服务中心或自助圈存机激活；如有疑问，可联系现场工作人员。',
  },
  'campus-network': {
    icon: WifiIcon,
    title: '校园网开通',
    subtitle: '校园 Wi-Fi · 宿舍网络',
    summary: '激活校园 Wi-Fi、宿舍网络与上网账号。',
    itemsTitle: '开通内容',
    items: ['校园 Wi-Fi 上网账号', '宿舍有线网络', '上网认证账号激活', '流量 / 套餐选择'],
    materials: ['本人学号', '初始密码（随录取材料发放）'],
    location: '网络服务中心 · 校园网自助服务平台',
    note: '校园网开通暂未接入本终端线上办理，请通过校园网自助服务平台或网络服务中心激活；如有疑问，可联系现场工作人员。',
  },
  luggage: {
    icon: PackageIcon,
    title: '行李帮运',
    subtitle: '服务点 · 路线 · 现场协助',
    summary: '展示校方合作行李帮运服务信息、服务点位置与现场办理指引。',
    itemsTitle: '服务内容',
    items: ['新生行李短驳', '宿舍楼栋路线指引', '服务点排队说明', '异常件现场协助'],
    materials: ['录取通知书 / 学生证', '本人联系电话', '行李件数与目标宿舍楼栋'],
    location: '迎新行李服务点 · 校门口 / 宿舍区入口',
    note: '行李帮运仅作为校方合作服务信息入口，本终端不代收费用、不采集个人隐私信息；具体办理以现场服务点为准。',
  },
  panorama: {
    icon: ScanFaceIcon,
    title: 'VR校园',
    subtitle: '全景导览 · 场馆介绍',
    summary: '展示校园重点区域、教学楼、宿舍、图书馆等全景导览入口。',
    itemsTitle: '导览内容',
    items: ['校园主干路线', '教学楼与实验楼', '图书馆 / 食堂 / 体育馆', '宿舍区与服务中心'],
    materials: ['无需材料'],
    location: '智慧校园服务专区 · VR校园导览',
    note: 'VR校园为信息展示与导览服务；如需实地咨询，请以前台志愿者或学校官方导览信息为准。',
  },
}

function isServiceKey(k: string | undefined): k is ServiceKey {
  return k === 'campus-card' || k === 'all-in-one' || k === 'campus-network' || k === 'luggage' || k === 'panorama'
}

export function SmartCampusServicePage() {
  const navigate = useNavigate()
  const { key } = useParams<{ key: string }>()

  // 未知 key 直达容错：不白屏，引导回智慧校园。
  if (!isServiceKey(key)) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100">
          <PartyPopperIcon className="h-8 w-8 text-neutral-400" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-lg font-semibold text-neutral-900">未找到该服务</h1>
        <p className="mt-1.5 text-sm text-neutral-500">请返回智慧校园选择可用服务</p>
        <Button size="lg" className="mt-7" onClick={() => navigate('/smart-campus')}>
          返回智慧校园
        </Button>
      </div>
    )
  }

  const info = SERVICES[key]
  const Icon = info.icon

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{info.title}</h1>
          <p className="mt-0.5 text-sm text-neutral-500">{info.subtitle}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => navigate('/smart-campus')}>
          返回
        </Button>
      </div>

      {/* 合规来源条 */}
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-success-bg bg-success-bg/60 px-4 py-3">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success-fg" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-success-fg">
          校方官方信息入口，仅展示与指引，<span className="font-semibold">不在本终端采集任何个人信息</span>；
          实际办理请前往现场服务窗口或学校官方自助平台。
        </p>
      </div>

      {/* 服务概览 */}
      <Card className="mb-4 p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-plum-soft">
            <Icon className="h-8 w-8 text-plum" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-neutral-900">{info.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-neutral-500">{info.summary}</p>
          </div>
        </div>
      </Card>

      {/* 办理事项 / 开通内容 */}
      <Card className="mb-4 p-5">
        <div className="mb-3 flex items-center gap-2">
          <ClipboardListIcon className="h-4 w-4 text-plum" aria-hidden="true" />
          <p className="text-sm font-semibold text-neutral-700">{info.itemsTitle}</p>
        </div>
        <ul className="space-y-2.5">
          {info.items.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm text-neutral-600">
              <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-plum" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* 所需材料 */}
      <Card className="mb-4 p-5">
        <p className="mb-3 text-sm font-semibold text-neutral-700">所需材料</p>
        <ul className="space-y-2.5">
          {info.materials.map((m) => (
            <li key={m} className="flex items-start gap-2.5 text-sm text-neutral-600">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-300" aria-hidden="true" />
              <span>{m}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* 办理地点 */}
      <Card className="mb-4 p-5">
        <p className="mb-3 text-sm font-semibold text-neutral-700">办理地点</p>
        <div className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2.5">
          <MapPinIcon className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
          <p className="text-sm text-neutral-800">{info.location}</p>
        </div>
      </Card>

      {/* 现场办理提示 */}
      <div className="mb-2 flex items-start gap-2 rounded-xl border border-warning/20 bg-warning-bg/70 px-4 py-3">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-warning-fg">{info.note}</p>
      </div>

      {/* 顺带导向迎新指引（真实可达页面），避免死路 */}
      <button
        type="button"
        onClick={() => navigate('/smart-campus/welcome')}
        className="mt-2 flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-plum/30 active:bg-plum-soft"
      >
        <PartyPopperIcon className="h-5 w-5 shrink-0 text-plum" aria-hidden="true" />
        <span className="flex-1 text-sm font-medium text-neutral-800">查看迎新报到指引</span>
        <ChevronRightIcon className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
      </button>

      <div className="h-2" />
    </div>
  )
}
