// ============================================================
// InterviewServiceHubPage — AI面试训练服务中心（/interview-service）
//
// 视觉真值：docs/design/kiosk-redesign-2026-08/16-service-hubs.html?hub=interview
// 本文件只声明本域入口与文案；渲染、在线服务探测与设备提示统一在 QxServiceHub。
//
// 合规：AI模拟面试仅供练习参考，不代表真实面试流程，评测结果不对外共享。
// ============================================================

import {
  BarChart3Icon,
  BotIcon,
  ClipboardCheckIcon,
  ClockIcon,
  LightbulbIcon,
  MapIcon,
  MicIcon,
} from 'lucide-react'
import {
  QxServiceHub,
  type QxHubCard,
  type QxHubQuickLink,
} from '../../components/qingxu/service-hub/QxServiceHub'

const CAPABILITIES: readonly QxHubCard[] = [
  {
    key: 'setup',
    icon: MicIcon,
    title: '开始模拟面试',
    description: '选择岗位类型与难度后进入AI模拟面试间，完成后出练习报告',
    badge: 'AI · 练习',
    to: '/interview/setup',
    kind: 'ai',
  },
  {
    key: 'self-assess',
    icon: ClipboardCheckIcon,
    title: '职业自我评估',
    description: '了解优势、偏好与可尝试方向',
    badge: 'AI · 仅供参考',
    to: '/resume/self-assessment/intro',
    kind: 'ai',
  },
  {
    key: 'career-plan',
    icon: MapIcon,
    title: '职业规划建议',
    description: '根据经历与目标形成行动建议',
    badge: 'AI · 仅供参考',
    to: '/resume/career-plan',
    kind: 'ai',
  },
  {
    key: 'tips',
    icon: LightbulbIcon,
    title: '面试技巧',
    description: '查看通用问答、自我介绍与沟通要点',
    badge: '静态内容',
    to: '/interview/tips',
    kind: 'info',
    requiresApi: false,
  },
  {
    key: 'history',
    icon: ClockIcon,
    title: '评估历史',
    description: '回看本人历次自我评估结果',
    badge: '本人记录',
    to: '/resume/self-assessment/history',
    kind: 'info',
  },
  {
    key: 'salary',
    icon: BotIcon,
    title: '行业薪资参考',
    description: '向通用AI顾问询问目标岗位的市场信息',
    badge: 'AI · 需核实',
    // 不传 `state.topic`：`/assistant` 不读 location.state（认的是 `?intent=`，
    // 且取值须是 advisorScenes 的 skill id，'salary' 不是）。传了必被丢弃。
    to: '/assistant',
    kind: 'ai',
  },
]

const QUICK_LINKS: readonly QxHubQuickLink[] = [
  { key: 'ai-records', icon: BotIcon, title: 'AI服务记录', description: '查看本人AI调用记录', to: '/me/ai-records' },
  {
    key: 'training-reports',
    icon: BarChart3Icon,
    title: '训练报告',
    description: '查看全部模拟面试报告',
    to: '/interview/reports',
  },
]

export function InterviewServiceHubPage() {
  return (
    <QxServiceHub
      hub="interview"
      domainTitle="AI面试训练"
      domainSubtitle="模拟问答 · 自我评估 · 面试技巧 · 训练报告，仅供练习参考"
      hero={{
        eyebrow: 'AI面试训练',
        title: '把表达练熟，不替你下结论',
        subtitle: '模拟问答、自我评估、技巧与历史报告，用于练习和复盘，不代表真实面试结果。',
        noteTitle: '不排名，不预测录用',
        note: '报告仅供本人练习参考，不对外共享。',
      }}
      section={{ title: '面试与成长', hint: '六个入口，按练习目标进入' }}
      cards={CAPABILITIES}
      quickTitle="快捷入口"
      quickHint="登录后可查看历史记录"
      quickLinks={QUICK_LINKS}
      boundary={{
        title: 'AI训练不是企业面试。',
        copy: 'AI模拟面试内容仅供练习参考，不代表真实面试流程；评测结果不构成招聘意见，不对外共享。不进行录用判断，不向企业推荐候选人。',
      }}
    />
  )
}
