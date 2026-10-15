// ============================================================
// ResumeServiceHubPage — AI简历服务中心（/resume-service）
//
// 视觉真值：docs/design/kiosk-redesign-2026-08/16-service-hubs.html?hub=resume
// 本文件只声明本域入口与文案；渲染、在线服务探测与设备提示统一在 QxServiceHub。
//
// 合规：AI生成内容仅供参考，投递由用户本人确认；本机不代投、不替企业筛选或邀约。
// ============================================================

import {
  BarChart3Icon,
  BotIcon,
  BriefcaseIcon,
  FilePlus2Icon,
  FileSearchIcon,
  FileTextIcon,
  LibraryIcon,
  MapIcon,
  PencilLineIcon,
  PrinterIcon,
  ShieldCheckIcon,
  UserIcon,
} from 'lucide-react'
import {
  QxServiceHub,
  type QxHubCard,
  type QxHubQuickLink,
} from '../../components/qingxu/service-hub/QxServiceHub'

const CAPABILITIES: readonly QxHubCard[] = [
  {
    key: 'diagnose',
    icon: FileSearchIcon,
    title: 'AI简历诊断',
    description: '先选简历来源，再查看结构与问题',
    badge: 'AI · 仅供参考',
    to: '/resume/source?intent=diagnose',
    kind: 'ai',
  },
  {
    key: 'optimize',
    icon: PencilLineIcon,
    title: 'AI简历优化',
    description: '选择目标岗位后逐条查看改写建议',
    badge: 'AI · 仅供参考',
    to: '/resume/source?intent=optimize',
    kind: 'ai',
  },
  {
    key: 'generate',
    icon: FilePlus2Icon,
    title: '简历生成',
    description: '从零按引导补充信息，生成可核对草稿',
    badge: 'AI · 需核对',
    to: '/resume/generate',
    kind: 'ai',
  },
  {
    key: 'templates',
    icon: LibraryIcon,
    title: '简历素材库',
    description: '按分类查看真实模板、标签与适用场景',
    badge: '模板目录',
    to: '/resume/templates',
    kind: 'info',
  },
  {
    key: 'career-plan',
    icon: MapIcon,
    title: '职业规划',
    description: '基于真实经历与目标生成行动建议',
    badge: 'AI · 仅供参考',
    to: '/resume/career-plan',
    kind: 'ai',
  },
  {
    key: 'job-materials',
    icon: BriefcaseIcon,
    title: '求职材料',
    description: '准备求职信、自我介绍与材料清单',
    badge: 'AI · 需核对',
    to: '/resume/materials',
    kind: 'ai',
  },
  {
    key: 'print',
    icon: PrinterIcon,
    title: '简历打印',
    description: '选择文件、核价后在本机打印',
    badge: '依赖打印机',
    to: '/print/upload?source=resume',
    kind: 'device',
  },
  {
    key: 'job-fit',
    icon: BarChart3Icon,
    title: '岗位匹配参考',
    description: '简历与岗位逐项对照，不给录用结论',
    badge: 'AI · 不给百分比',
    to: '/resume/job-fit',
    kind: 'ai',
  },
]

// 签约与权益：与简历制作能力同组展示，不作为百宝箱或岗位入口重复投放。
// 构建期开关关闭时整张卡不渲染（不是灰掉），避免展示本机没开通的能力。
const CONTRACT_REVIEW_CARD: QxHubCard = {
  key: 'contract-review',
  icon: ShieldCheckIcon,
  title: 'AI签约风险提示',
  description: '上传劳动合同、实习协议或 Offer，核查试用期、薪酬、竞业等条款风险',
  badge: '签约与权益 · 仅作风险提示',
  to: '/contract-review',
  kind: 'ai',
}

const QUICK_LINKS: readonly QxHubQuickLink[] = [
  { key: 'resumes', icon: UserIcon, title: '我的简历', description: '查看本人已保存版本', to: '/me/resumes' },
  { key: 'ai-records', icon: BotIcon, title: 'AI服务记录', description: '查看诊断与优化记录', to: '/me/ai-records' },
  {
    key: 'self-assessment',
    icon: FileTextIcon,
    title: '自我评估',
    description: '完成职业倾向参考',
    to: '/resume/self-assessment/intro',
  },
]

const contractReviewEnabled = import.meta.env.VITE_ENABLE_CONTRACT_REVIEW === 'true'

export function ResumeServiceHubPage() {
  return (
    <QxServiceHub
      hub="resume"
      domainTitle="AI简历服务"
      domainSubtitle="AI诊断 · 优化 · 生成 · 打印，一条龙完成"
      hero={{
        eyebrow: 'AI简历服务',
        title: '把简历这件事，做得更清楚',
        subtitle: '从来源选择、诊断优化到生成、材料与打印，按你的目标进入对应步骤。',
        noteTitle: '原件始终由你掌控',
        note: 'AI建议仅供参考，新版本不会覆盖原文件。',
      }}
      section={{ title: '简历能力', hint: '先选目标，再进入真实流程' }}
      cards={contractReviewEnabled ? [...CAPABILITIES, CONTRACT_REVIEW_CARD] : CAPABILITIES}
      quickTitle="我的简历服务"
      quickHint="登录后可查看历史记录"
      quickLinks={QUICK_LINKS}
      boundary={{
        title: '简历是否使用、投给谁，由你本人决定。',
        copy: 'AI生成内容仅供参考，不构成正式求职建议；简历最终投递由本人负责确认。系统不代投、不替企业筛选或邀约。',
      }}
    />
  )
}
