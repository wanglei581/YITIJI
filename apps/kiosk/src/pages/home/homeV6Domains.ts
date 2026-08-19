export type HomeV6ActionId =
  | 'assistant'
  | 'assistant-resume'
  | 'assistant-jobfair'
  | 'login'
  | 'profile'
  | 'print-hub'
  | 'print-local'
  | 'print-phone'
  | 'print-usb'
  | 'scan-paper'
  | 'file-tools'
  | 'resume-hub'
  | 'resume-diagnose'
  | 'resume-generate'
  | 'resume-job-fit'
  | 'resume-materials'
  | 'career-plan'
  | 'jobs-hub'
  | 'fairs-hub'
  | 'interview-hub'
  | 'policy-hub'
  | 'toolbox'
  | 'smart-campus'

export interface HomeV6QuickAction {
  id: HomeV6ActionId
  label: string
}

export interface HomeV6Domain {
  id: 'print' | 'resume' | 'jobs' | 'fairs' | 'interview' | 'policy' | 'toolbox' | 'campus'
  actionId: HomeV6ActionId
  title: string
  description: string
  accent: 'print' | 'resume' | 'jobs' | 'fairs' | 'interview' | 'policy' | 'toolbox' | 'campus'
  icon: 'printer' | 'resume' | 'briefcase' | 'calendar' | 'mic' | 'policy' | 'toolbox' | 'campus'
  size: 'large' | 'small'
  quickActions?: readonly HomeV6QuickAction[]
}

export const HOME_V6_ROUTES: Readonly<Record<HomeV6ActionId, string>> = {
  assistant: '/assistant',
  'assistant-resume': '/assistant',
  'assistant-jobfair': '/assistant',
  login: '/login',
  profile: '/profile',
  'print-hub': '/print-scan',
  // 通道型快捷入口（只声明「文件从哪来」，没声明要做什么）带 mode=transfer，
  // 让落地页直达对应面板、标题用入口名，不再让用户把刚点过的通道重选一遍。
  // 判据见 docs/reviews/2026-08-19-kiosk-entry-directness-review.md。
  //
  // **print-local 刻意不加 mode=transfer**：`PrintUploadPage` 文件头注明「选择文件」
  // 用的是 `<input type="file">`，只是桌面 Chrome/Edge 下的 E2E 链路验证，
  // 生产一体机按 CLAUDE.md §17 不许弹系统文件对话框（真正的本机路径是 U 盘导入，
  // 走 Terminal Agent 的 /local/usb/* 网桥）。给它配直达入口 + 专属标题，
  // 等于把一条非生产路径提升成一等公民，所以保持原样不做直达。
  'print-local': '/print/upload?source=document&tab=file',
  'print-phone': '/print/upload?source=document&tab=qr&mode=transfer',
  'print-usb': '/print/upload?source=document&tab=usb&mode=transfer',
  'scan-paper': '/scan/start',
  'file-tools': '/print-scan/convert',
  'resume-hub': '/resume-service',
  'resume-diagnose': '/resume/source?intent=diagnose',
  'resume-generate': '/resume/generate',
  'resume-job-fit': '/resume/job-fit',
  'resume-materials': '/resume/materials',
  'career-plan': '/resume/career-plan',
  'jobs-hub': '/jobs-service',
  'fairs-hub': '/fairs-service',
  'interview-hub': '/interview-service',
  'policy-hub': '/policy-service',
  toolbox: '/toolbox',
  'smart-campus': '/smart-campus',
}

export const HOME_V6_DOMAINS: readonly HomeV6Domain[] = [
  {
    id: 'print',
    actionId: 'print-hub',
    title: '打印扫描',
    description: '上传、扫描、加工与本机出纸',
    accent: 'print',
    icon: 'printer',
    size: 'large',
    quickActions: [
      { id: 'print-local', label: '本机上传' },
      { id: 'print-phone', label: '手机扫码传' },
      { id: 'print-usb', label: 'U 盘' },
      { id: 'scan-paper', label: '纸质扫描' },
      { id: 'file-tools', label: '文件加工' },
    ],
  },
  {
    id: 'resume',
    actionId: 'resume-hub',
    title: 'AI 简历服务',
    description: '诊断、优化、生成与求职材料',
    accent: 'resume',
    icon: 'resume',
    size: 'large',
    quickActions: [
      { id: 'resume-diagnose', label: '诊断优化' },
      { id: 'resume-generate', label: '访谈式生成' },
      { id: 'resume-job-fit', label: '岗位匹配' },
      { id: 'resume-materials', label: '材料工厂' },
      { id: 'career-plan', label: '职业规划' },
    ],
  },
  {
    id: 'jobs',
    actionId: 'jobs-hub',
    title: '岗位信息',
    description: '第三方来源岗位与企业入口',
    accent: 'jobs',
    icon: 'briefcase',
    size: 'small',
  },
  {
    id: 'fairs',
    actionId: 'fairs-hub',
    title: '招聘会',
    description: '场次、企业与现场导览',
    accent: 'fairs',
    icon: 'calendar',
    size: 'small',
  },
  {
    id: 'interview',
    actionId: 'interview-hub',
    title: 'AI 面试训练',
    description: '模拟问答与训练报告',
    accent: 'interview',
    icon: 'mic',
    size: 'small',
  },
  {
    id: 'policy',
    actionId: 'policy-hub',
    title: '政策服务',
    description: '官方来源政策与办事指引',
    accent: 'policy',
    icon: 'policy',
    size: 'small',
  },
  {
    id: 'toolbox',
    actionId: 'toolbox',
    title: '百宝箱',
    description: '后台审核后开放的扩展服务',
    accent: 'toolbox',
    icon: 'toolbox',
    size: 'small',
  },
  {
    id: 'campus',
    actionId: 'smart-campus',
    title: '智慧校园',
    description: '学校接入后开放',
    accent: 'campus',
    icon: 'campus',
    size: 'small',
  },
]
