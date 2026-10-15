// ============================================================
// JobsServiceHubPage — 岗位信息服务中心（/jobs-service）
//
// 视觉真值：docs/design/kiosk-redesign-2026-08/16-service-hubs.html?hub=jobs
// 本文件只声明本域入口与文案；渲染、在线服务探测与设备提示统一在 QxServiceHub。
//
// 合规：岗位来自第三方/官方来源，投递请前往来源平台，本系统不参与招聘闭环。
// ============================================================

import {
  BarChart3Icon,
  BriefcaseIcon,
  BuildingIcon,
  ExternalLinkIcon,
  EyeIcon,
  MapIcon,
  SearchIcon,
} from 'lucide-react'
import {
  QxServiceHub,
  type QxHubCard,
  type QxHubQuickLink,
} from '../../components/qingxu/service-hub/QxServiceHub'

const CAPABILITIES: readonly QxHubCard[] = [
  {
    key: 'fulltime',
    icon: BriefcaseIcon,
    title: '全职岗位',
    description: '第三方来源的全职岗位，按行业、地区与薪资范围筛选',
    badge: '第三方来源',
    to: '/jobs?category=fulltime',
    kind: 'info',
  },
  {
    key: 'intern',
    icon: BriefcaseIcon,
    title: '实习岗位',
    description: '查看面向在校生与应届生的实习机会',
    badge: '第三方来源',
    to: '/jobs?category=intern',
    kind: 'info',
  },
  {
    key: 'parttime',
    icon: BriefcaseIcon,
    title: '兼职信息',
    description: '灵活就业与兼职来源信息，投递请前往来源平台',
    badge: '第三方来源',
    to: '/jobs?category=parttime',
    kind: 'info',
  },
  {
    key: 'all',
    icon: SearchIcon,
    title: '全部岗位',
    description: '搜索并查看全部已审核来源岗位',
    badge: '真实加载',
    to: '/jobs',
    kind: 'info',
  },
  {
    key: 'companies',
    icon: BuildingIcon,
    title: '找企业',
    description: '先了解企业，再查看岗位来源',
    badge: '来源信息',
    to: '/companies',
    kind: 'info',
  },
  {
    key: 'job-fit',
    icon: BarChart3Icon,
    title: '岗位匹配参考',
    description: '简历与目标岗位逐项对照，不给录用结论',
    badge: 'AI · 仅供参考',
    to: '/resume/job-fit',
    kind: 'ai',
  },
  {
    key: 'online-platforms',
    icon: ExternalLinkIcon,
    title: '线上招聘平台',
    description: '扫码打开第三方平台，岗位与投递均在该平台自行完成',
    badge: '外部来源',
    to: '/jobs/online-platforms',
    kind: 'info',
    requiresApi: false,
  },
  {
    key: 'offline',
    icon: MapIcon,
    title: '线下招聘机构',
    description: '查看机构地址与到店咨询指引',
    badge: '线下咨询',
    to: '/offline-agencies',
    kind: 'info',
  },
]

const QUICK_LINKS: readonly QxHubQuickLink[] = [
  { key: 'browse', icon: EyeIcon, title: '浏览记录', description: '查看看过的岗位', to: '/me/activity' },
  {
    key: 'jump',
    icon: ExternalLinkIcon,
    title: '外部跳转记录',
    description: '查看打开过的来源入口',
    to: '/me/activity?tab=jump',
  },
]

export function JobsServiceHubPage() {
  return (
    <QxServiceHub
      hub="jobs"
      domainTitle="岗位信息"
      domainSubtitle="第三方来源岗位 · AI研判 · 线上平台入口，投递请前往来源平台"
      hero={{
        eyebrow: '岗位信息',
        title: '看清来源，再决定去哪里投',
        subtitle: '岗位来自第三方或官方来源。本机帮助筛选和理解，投递仍在来源平台完成。',
        noteTitle: '本机不代收简历',
        note: '不替企业筛选、不安排面试、不管理 Offer。',
      }}
      section={{ title: '岗位与来源入口', hint: '岗位以进入后的真实加载为准' }}
      cards={CAPABILITIES}
      quickTitle="我的浏览记录"
      quickHint="登录后可查看历史"
      quickLinks={QUICK_LINKS}
      boundary={{
        title: '投递在来源平台完成。',
        copy: '岗位信息均来自第三方 / 官方来源，本终端仅提供信息展示；投递、预约请前往来源平台完成，本系统不参与招聘闭环，不收取求职者简历给企业。',
      }}
    />
  )
}
