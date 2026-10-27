// ============================================================
// SmartCampusServicePage — 校园自助服务办理说明（/smart-campus/service/:key）
//   key = campus-card | all-in-one | campus-network | luggage | panorama
//
// 校园卡办理 / 一卡通开通 / 校园网开通三项自助服务的办理指引页。
// 本期（Phase 1）只做办理说明 + 所需材料 + 现场窗口指引，未接真实办理后端；
// 与迎新指引同属「仅信息展示与指引」，沿用智慧校园页面视觉（indigo + emerald 合规条）。
//
// 合规（compliance-boundary.md §九）：仅展示与指引，不在本终端采集任何个人信息；
// 实际办理一律引导至现场服务窗口 / 学校官方自助平台。无任何招聘闭环语义。
// ============================================================

import type { CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import '../../auth/capability-gate-touch.css'
import {
  CheckCircle2Icon,
  ClipboardListIcon,
  CreditCardIcon,
  KeyRoundIcon,
  MapPinIcon,
  PackageIcon,
  PrinterIcon,
  ScanFaceIcon,
  ShieldCheckIcon,
  WifiIcon,
  type LucideIcon,
} from 'lucide-react'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { QxTouchTile } from '../../components/qingxu/touch/QxTouchTile'
import { P10BigCard, P10HelpRemind } from '../../auth/CapabilityStayCards'
import { useSmartCampusCapabilitySnapshot } from '../../auth/KioskCapabilityGuard'
import './smart-campus-touch.css'
import { helpNeededLine } from '../../copy/unattendedCopy'
import { useSupportContact } from '../../hooks/useSupportContact'

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
    location: '校园卡服务中心 / 一卡通中心（具体位置以学校迎新指引为准）',
    note: '校园卡线上办理后续开放，目前请携带上述材料前往校园卡服务中心办理。',
  },
  'all-in-one': {
    icon: KeyRoundIcon,
    title: '一卡通开通',
    subtitle: '食堂 · 门禁 · 图书馆',
    summary: '开通食堂、门禁、图书馆等校园通行权限。',
    itemsTitle: '开通权限',
    items: ['食堂与校内消费', '宿舍 / 教学楼门禁', '图书馆借阅', '自助圈存与充值'],
    materials: ['已办理的校园卡', '本人学号'],
    location: '一卡通服务中心 / 校内自助圈存机（具体位置以学校迎新指引为准）',
    note: '本机不办理一卡通权限开通，请前往一卡通服务中心或自助圈存机激活。',
  },
  'campus-network': {
    icon: WifiIcon,
    title: '校园网开通',
    subtitle: '校园 Wi-Fi · 宿舍网络',
    summary: '激活校园 Wi-Fi、宿舍网络与上网账号。',
    itemsTitle: '开通内容',
    items: ['校园 Wi-Fi 上网账号', '宿舍有线网络', '上网认证账号激活', '流量 / 套餐选择'],
    materials: ['本人学号', '初始密码（随录取材料发放）'],
    location: '网络服务中心 / 校园网自助服务平台（具体位置以学校迎新指引为准）',
    note: '本机不办理校园网开通，请通过校园网自助服务平台或网络服务中心激活。',
  },
  luggage: {
    icon: PackageIcon,
    title: '行李帮运',
    subtitle: '服务点 · 路线 · 现场协助',
    summary: '行李帮运服务的通用说明与现场办理指引。',
    itemsTitle: '服务内容',
    items: ['新生行李短驳', '宿舍楼栋路线指引', '服务点排队说明', '异常件现场协助'],
    materials: ['录取通知书 / 学生证', '本人联系电话', '行李件数与目标宿舍楼栋'],
    location: '迎新行李服务点（具体位置以学校现场指引为准）',
    note: '行李帮运为通用服务说明，本终端不代收费用、不采集个人隐私信息；是否提供该服务、服务点位置与收费均以学校现场指引为准。',
  },
  panorama: {
    icon: ScanFaceIcon,
    title: 'VR校园',
    subtitle: '全景导览 · 场馆介绍',
    summary: '校园全景导览入口；具体导览内容需学校提供后展示。',
    itemsTitle: '导览内容',
    items: ['校园主干路线', '教学楼与实验楼', '图书馆 / 食堂 / 体育馆', '宿舍区与服务中心'],
    materials: ['无需材料'],
    location: '本终端 · 智慧校园服务专区',
    note: 'VR校园为信息展示与导览服务。实地路线以学校公布的导览信息为准。',
  },
}

/** 说明卡的最小高度（稿 campus-svc 按服务各有一档，让正文把屏填满）。 */
const HERO_MIN_HEIGHT: Record<ServiceKey, number> = {
  'campus-card': 300,
  'all-in-one': 360,
  'campus-network': 380,
  luggage: 380,
  panorama: 380,
}

function isServiceKey(k: string | undefined): k is ServiceKey {
  return k === 'campus-card' || k === 'all-in-one' || k === 'campus-network' || k === 'luggage' || k === 'panorama'
}

export function SmartCampusServicePage() {
  const navigate = useNavigate()
  const { key } = useParams<{ key: string }>()
  const supportContact = useSupportContact()
  const { config } = useSmartCampusCapabilitySnapshot()

  // 未知 key 直达容错：不白屏，引导回智慧校园，并列出本机已开通的服务让人直接再选一次。
  if (!isServiceKey(key)) {
    const openServices = (Object.keys(SERVICES) as ServiceKey[]).filter(
      (serviceKey) => (serviceKey !== 'luggage' && serviceKey !== 'panorama') || config.modules[serviceKey],
    )
    return (
      <div data-qx-page="campus-service" className="sc-touch-fill w4-page-frame">
      <QxTouchScreen
        testId="campus-svc-missing"
        stateId="missing"
        bodyClassName="qxt-body-scroll"
        band={(
          <QxTouchBand
            seal={null}
            eyebrow="智慧校园"
            title="未找到该服务"
            sub="请返回智慧校园选择可用服务"
            back={false}
            status={{ text: '未找到', tone: 'unknown' }}
          />
        )}
        dock={(
          <QxTouchDock
            onBack={() => navigate('/smart-campus')}
            backLabel="返回智慧校园"
            ask={{ label: '问小青：这一项要带什么？', draft: '没有这项服务时还能办什么？请只做说明。' }}
          />
        )}
      >
        <div className="p10-gate-wrap">
          <div className="p10-gate" data-kiosk-screen="campus-service-missing">
            <p>请返回智慧校园选择可用服务</p>
          </div>
          <P10BigCard
            icon="map"
            title="返回智慧校园"
            desc="校园卡、行李帮运、校园网等已开通的项目，从这里再选一次。"
            cta="返回"
            onClick={() => navigate('/smart-campus')}
          />
          <div className="qxt-sec">本机已开通的校园服务</div>
          <div className="qxt-grid2">
            {openServices.map((serviceKey, index) => (
              <QxTouchTile
                key={serviceKey}
                icon="idcard"
                title={SERVICES[serviceKey].title}
                desc={SERVICES[serviceKey].subtitle}
                tone="slate"
                index={index}
                onClick={() => navigate(`/smart-campus/service/${serviceKey}`)}
              />
            ))}
          </div>
          <P10BigCard
            icon="home"
            title="回首页"
            desc="打印、扫描和政策查询不受这项影响，可以先回首页接着办。"
            cta="回首页"
            onClick={() => navigate('/')}
          />
          <P10HelpRemind />
        </div>
      </QxTouchScreen>
      </div>
    )
  }

  const info = SERVICES[key]
  const Icon = info.icon

  const help = (key === 'campus-card' || key === 'all-in-one' || key === 'campus-network') && supportContact.servicePhone
    ? `${helpNeededLine(supportContact)}。`
    : ''

  return (
    <div data-qx-page="campus-service" className="sc-touch-fill w4-page-frame">
    <QxTouchScreen
      testId="campus-svc-touch"
      stateId={key}
      bodyClassName="qxt-body-scroll"
      band={(
        <QxTouchBand
          seal={null}
          eyebrow="智慧校园"
          title={info.title}
          sub={`${info.subtitle} · 智慧校园自助服务指引`}
          back={false}
          status={{ text: '到窗口办理', tone: 'unknown' }}
        />
      )}
      dock={(
        <QxTouchDock
          onBack={() => navigate('/smart-campus')}
          backLabel="返回智慧校园"
          ask={{ label: '问小青：这一项要带什么？', draft: '这一项要带什么？请只做说明，不要代替学校办理。' }}
          primary={{ label: '查看迎新报到指引', onClick: () => navigate('/smart-campus/welcome') }}
        />
      )}
    >
        <div className="kproto kproto-teal kproto-content">
          <div className="kproto-auth">
            <ShieldCheckIcon aria-hidden="true" />
            <p>本页为通用办理指引，<b>不代表任何具体学校的安排</b>；所需材料、办理地点与流程请以学校官方通知为准。本终端不采集任何个人信息，实际办理请前往现场服务窗口或学校官方自助平台。</p>
          </div>

          <section
            className="sc-hero"
            style={{ '--sc-hero-h': `${HERO_MIN_HEIGHT[key]}px` } as CSSProperties}
          >
            <span className="sc-hero-v" aria-hidden="true">
              <Icon size={96} strokeWidth={1.5} />
            </span>
            <div className="sc-hero-t">
              <h2>{info.title}</h2>
              <p>{info.summary}</p>
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

          <div className="kproto-notice warn">
            <ShieldCheckIcon aria-hidden="true" />
            <p>{info.note}{help}</p>
          </div>

          {/* 本机可办（仅校园卡页展示：证件照打印即将上线 + 入学材料打印可用） */}
          {key === 'campus-card' && (
            <div className="kproto-grid-2">
              <button
                type="button"
                disabled
                className="kproto-tile flex cursor-not-allowed items-center gap-4 opacity-55"
                style={{ borderStyle: 'dashed', background: 'var(--kp-surface)' }}
              >
                <span className="kproto-icon shrink-0"><ScanFaceIcon aria-hidden="true" /></span>
                <span className="flex-1 text-left">
                  <b className="block text-[23px] font-semibold">证件照排版打印</b>
                  <span className="sc-sub">功能即将上线；当前可用手机照片在打印扫描页打印</span>
                </span>
                <span className="sc-soon">即将上线</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/print/upload')}
                className="kproto-tile flex items-center gap-4"
                style={{ background: 'var(--kp-teal-soft)', borderColor: 'rgba(31,158,134,.35)' }}
              >
                <span className="kproto-icon shrink-0" style={{ background: 'var(--kp-teal)', color: '#fffdf8' }}><PrinterIcon aria-hidden="true" /></span>
                <span className="flex-1 text-left">
                  <b className="block text-[23px] font-semibold">入学材料 / 表格打印</b>
                  <span className="sc-sub">报到表、申请表等自助打印</span>
                </span>
              </button>
            </div>
          )}

        </div>
    </QxTouchScreen>
    </div>
  )
}
