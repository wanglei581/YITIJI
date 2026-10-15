// ============================================================
// FairsServiceHubPage — 招聘会服务中心（/fairs-service）
//
// 视觉真值：docs/design/kiosk-redesign-2026-08/16-service-hubs.html?hub=fairs
// 本文件只声明本域入口与文案；渲染、在线服务探测与设备提示统一在 QxServiceHub。
// 六个入口各指向不同的真实路由（2026-08 修过四张卡同指 /job-fairs 的重复入口）。
//
// 合规：招聘会只做第三方/官方来源信息入口；预约请前往来源平台。
// ============================================================

import {
  BotIcon,
  BuildingIcon,
  CalendarIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileTextIcon,
  MapIcon,
  PrinterIcon,
} from 'lucide-react'
import {
  QxServiceHub,
  type QxHubCard,
  type QxHubQuickLink,
} from '../../components/qingxu/service-hub/QxServiceHub'

const CAPABILITIES: readonly QxHubCard[] = [
  {
    key: 'fair-social',
    icon: CalendarIcon,
    title: '社会招聘会',
    description: '查看真实场次、时间、地点、参会企业与来源',
    badge: '真实加载',
    to: '/job-fairs',
    kind: 'info',
  },
  {
    key: 'fair-campus',
    icon: BuildingIcon,
    title: '校园招聘会',
    description: '查看校园相关场次与企业信息，预约请前往来源平台',
    badge: '真实加载',
    to: '/campus',
    kind: 'info',
  },
  {
    key: 'checkin',
    icon: MapIcon,
    title: '扫码签到',
    description: '核对来源预约与现场流程，现场签到二维码展示与识别引导',
    badge: '无签到回执',
    to: '/job-fairs/checkin',
    kind: 'info',
  },
  {
    key: 'ai-plan',
    icon: BotIcon,
    title: 'AI参会规划',
    description: '问AI顾问了解参会准备与现场沟通建议',
    badge: 'AI · 仅供参考',
    // 不传 `state.topic`：`/assistant` 不读 location.state（认的是 `?intent=`，
    // 且取值须是 advisorScenes 的 skill id，'jobfair' 不是）。传了必被丢弃。
    to: '/assistant',
    kind: 'ai',
  },
  {
    key: 'resume-prepare',
    icon: FileTextIcon,
    title: '求职材料准备',
    description: '诊断、优化或准备多份简历，进入简历中心',
    badge: '进入简历中心',
    to: '/resume-service',
    kind: 'info',
  },
  {
    key: 'fair-print',
    icon: PrinterIcon,
    title: '活动资料打印',
    description: '先查看文件、格式与办理入口；出纸或扫描步骤进入后确认',
    badge: '进入后确认',
    to: '/print-scan',
    kind: 'info',
  },
]

const QUICK_LINKS: readonly QxHubQuickLink[] = [
  { key: 'browse-history', icon: EyeIcon, title: '浏览记录', description: '查看看过的招聘会', to: '/me/activity' },
  {
    key: 'jump-history',
    icon: ExternalLinkIcon,
    title: '外部跳转记录',
    description: '查看打开过的来源入口',
    to: '/me/activity?tab=jump',
  },
]

export function FairsServiceHubPage() {
  return (
    <QxServiceHub
      hub="fairs"
      domainTitle="招聘会信息"
      domainSubtitle="场次查询 · 校园专场 · AI参会规划 · 材料打印，投递预约请前往来源平台"
      hero={{
        eyebrow: '招聘会',
        title: '先看场次，再准备到场',
        subtitle: '查看招聘会时间、地点和来源，准备简历与路线；预约在来源平台完成。',
        noteTitle: '不显示虚构签到结果',
        note: '场次、参会企业和地图均以真实数据为准。',
      }}
      section={{ title: '招聘会服务', hint: '六个入口，覆盖会前与现场准备' }}
      cards={CAPABILITIES}
      quickTitle="快捷入口"
      quickHint="登录后可查看历史记录"
      quickLinks={QUICK_LINKS}
      boundary={{
        title: '预约和投递由来源平台负责。',
        copy: '招聘会信息来自第三方或官方来源；预约、报名请前往来源平台完成，本终端只提供信息展示与跳转入口。',
      }}
    />
  )
}
