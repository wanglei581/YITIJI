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

import { Button } from '@ai-job-print/ui'
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
import '../prototype/kiosk-prototype.css'

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
    <div className="kproto kproto-teal">
      <div className="kproto-shell">
        <div className="kproto-pagehead">
          <button type="button" className="kproto-back" onClick={() => navigate('/smart-campus')}>返回</button>
          <div className="kproto-title">
            <h1>{info.title}</h1>
            <p>{info.subtitle} · 智慧校园自助服务指引</p>
          </div>
          <div className="kproto-aside"><span className="kproto-badge">办理指引 · 未接线上办理</span></div>
        </div>

        <main className="kproto-content">
          <div className="kproto-auth">
            <ShieldCheckIcon aria-hidden="true" />
            <p>校方官方信息入口，仅展示与指引，不在本终端采集任何个人信息；实际办理请前往现场服务窗口或学校官方自助平台。</p>
          </div>

          <section className="kproto-card accented">
            <div className="flex items-center gap-6">
              <span className="grid h-24 w-24 shrink-0 place-items-center rounded-[20px] bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]">
                <Icon className="h-12 w-12" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-serif text-4xl font-black tracking-[2px]">{info.title}</h2>
                <p className="mt-2 text-[21px] leading-normal text-[var(--kp-muted)]">{info.summary}</p>
              </div>
            </div>
          </section>

          <div className="kproto-grid-2">
            <section className="kproto-card">
              <div className="kproto-card-head">
                <span className="kproto-icon"><ClipboardListIcon aria-hidden="true" /></span>
                <div><h2>{info.itemsTitle}</h2></div>
              </div>
              <div className="grid gap-3 text-[21px]">
                {info.items.map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <CheckCircle2Icon className="h-6 w-6 text-[var(--kp-accent-deep)]" aria-hidden="true" />
                    {item}
                  </div>
                ))}
              </div>
            </section>

            <section className="kproto-card">
              <div className="kproto-card-head">
                <span className="kproto-icon"><ClipboardListIcon aria-hidden="true" /></span>
                <div><h2>所需材料</h2></div>
              </div>
              <div className="grid gap-3 text-[21px]">
                {info.materials.map((m) => (
                  <div key={m} className="flex items-center gap-4"><span className="h-2.5 w-2.5 rounded-full bg-[var(--kp-line)]" />{m}</div>
                ))}
              </div>
            </section>
          </div>

          <section className="kproto-card">
            <div className="kproto-card-head">
              <span className="kproto-icon"><MapPinIcon aria-hidden="true" /></span>
              <div><h2>办理地点</h2></div>
            </div>
            <div className="flex items-center gap-4 rounded-[14px] border border-[var(--kp-line)] bg-[var(--kp-paper)] px-6 py-5 text-[21px] font-bold">
              <MapPinIcon className="h-7 w-7 text-[var(--kp-muted)]" aria-hidden="true" />
              {info.location}
            </div>
          </section>

          <div className="kproto-notice">
            <ShieldCheckIcon aria-hidden="true" />
            <p>{info.note}</p>
          </div>

          <div className="kproto-actionbar">
            <button type="button" className="kproto-btn" onClick={() => navigate('/smart-campus')}>返回智慧校园</button>
            <div className="kproto-spacer" />
            <button type="button" className="kproto-btn dark" onClick={() => navigate('/smart-campus/welcome')}>
              查看迎新报到指引<ChevronRightIcon aria-hidden="true" />
            </button>
          </div>
        </main>
      </div>
    </div>
  )
}
