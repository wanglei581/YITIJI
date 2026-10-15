// ============================================================
// PolicyServiceHubPage — 政策服务中心（/policy-service）
//
// 视觉真值：docs/design/kiosk-redesign-2026-08/16-service-hubs.html?hub=policy
// 本文件只声明本域入口与文案；渲染、在线服务探测与设备提示统一在 QxServiceHub。
//
// ⚠️ 2026-08-11（CLAUDE.md §9）：本链原将政策与用户自填外链称为「官方口径 / 官方入口」，
// 但后端 policy.dto.ts:41 只把合作机构自填链接当普通字符串接收，
// policies.service.ts 没有官方域名、发布主体或证据核验——系统无法证明其官方性。
// 现统一改为「来源链接 / 由来源机构提交并经平台审核后展示」。
// 「以官方发布为准」这类**让用户去核实**的免责表述是诚实的，予以保留。
// 恢复条件：externalUrl 接入官方域名白名单核验（建议与线上平台目录、百宝箱共用一套）。
// 合规：政策信息由来源机构提交并经平台审核后展示，仅做信息展示与材料指引，不承诺办理结果。
// ============================================================

import {
  BookmarkIcon,
  BotIcon,
  CoinsIcon,
  EyeIcon,
  FileTextIcon,
  FolderIcon,
  ShieldIcon,
} from 'lucide-react'
import {
  QxServiceHub,
  type QxHubCard,
  type QxHubQuickLink,
} from '../../components/qingxu/service-hub/QxServiceHub'

const CAPABILITIES: readonly QxHubCard[] = [
  {
    key: 'employment',
    icon: FileTextIcon,
    title: '就业政策',
    description: '就业补贴、灵活就业等政策信息，由合作机构提交并经平台审核后展示',
    badge: '来源内容',
    to: '/renshi?tab=policy',
    kind: 'info',
  },
  {
    key: 'social-insurance',
    icon: ShieldIcon,
    title: '社保指南',
    description: '参保流程与社保办事材料说明，含城镇职工和灵活就业人员险种',
    badge: '确定性内容',
    to: '/renshi?tab=social',
    kind: 'info',
    requiresApi: false,
  },
  {
    key: 'archive',
    icon: FolderIcon,
    title: '档案 / 登记',
    description: '人事档案托管、毕业生就业登记与证明开具材料指引',
    badge: '确定性内容',
    to: '/renshi?tab=register',
    kind: 'info',
    requiresApi: false,
  },
  {
    key: 'subsidy',
    icon: CoinsIcon,
    title: '补贴指引',
    description: '就业补贴、失业保险、创业扶持政策说明与来源链接',
    badge: '来源内容',
    // `/renshi` 不认 `?tab=subsidy`（`renshi/shared.ts` 的 VALID_TABS），传了会被静默
    // 丢弃回落到 policy —— 它让人以为存在一个补贴 tab。补贴内容本来就在政策 tab 里。
    to: '/renshi',
    kind: 'info',
  },
  {
    key: 'ai-assistant',
    icon: BotIcon,
    title: 'AI政策助手',
    description: '咨询通用政策说明、办事材料，并回到来源核对',
    badge: 'AI · 需核实',
    // 不传 `state.topic`：`/assistant` 从头到尾没有读过 location.state
    // （它认的是 `?intent=`，取值须是 advisorScenes 里的 skill id，'policy' 不是）。
    to: '/assistant',
    kind: 'ai',
  },
  {
    key: 'policy-fav',
    icon: BookmarkIcon,
    title: '政策收藏',
    description: '查看本人收藏的政策内容',
    badge: '本人记录',
    to: '/me/favorites?tab=policy',
    kind: 'info',
  },
]

const QUICK_LINKS: readonly QxHubQuickLink[] = [
  { key: 'browse-history', icon: EyeIcon, title: '浏览记录', description: '查看最近浏览的政策', to: '/me/activity' },
  { key: 'ai-records', icon: BotIcon, title: 'AI政策问答记录', description: '查看本人政策问答', to: '/me/ai-records' },
]

export function PolicyServiceHubPage() {
  return (
    <QxServiceHub
      hub="policy"
      domainTitle="政策服务"
      domainSubtitle="就业政策 · 社保指南 · 档案登记 · AI政策问答"
      hero={{
        eyebrow: '政策服务',
        title: '看来源、查条件、备材料',
        subtitle: '就业政策、社保与档案登记以来源内容为准；AI顾问只做通用说明。',
        noteTitle: '不承诺办理或资格结果',
        note: '最终以官方审核为准。',
      }}
      section={{ title: '政策与办事指引', hint: '六个入口，来源与条件分开看' }}
      cards={CAPABILITIES}
      quickTitle="快捷入口"
      quickHint="登录后可查看历史记录"
      quickLinks={QUICK_LINKS}
      boundary={{
        title: '政策内容以来源发布为准。',
        copy: '政策内容由来源机构提交并经平台审核后展示，仅供参考；补贴类只做政策说明和材料指引（info-only），不承诺到账，不代办申请。办理前请核对来源机构与目标域名，正式办理请前往相关政府部门或官方渠道。',
      }}
    />
  )
}
