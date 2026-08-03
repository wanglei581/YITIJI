// 首页 prototype-v1 图标：逐字节移植 docs/design/kiosk-proto-2026-07/01-home.html 的内联 SVG。
// 全部 24×24 线性、stroke 1.6（badge 星标为 fill）。不复用 KIcon sprite，以保证图标形式 1:1。
// 键名对应原型语义；GROUP_ICON 按服务组 id、TILE_ICON 按磁贴标题查找（两者均为守卫锁定的稳定值）。
import type { ReactNode } from 'react'

const P: Record<string, ReactNode> = {
  // 服务组头图标
  'group-resume': <><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4M10 12l2 2 4-4" /></>,
  'group-jobs': <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 12h18M12 11v2" /></>,
  'group-fairs': <><path d="M12 21s-7-6.1-7-11a7 7 0 0114 0c0 4.9-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  'group-print': <><path d="M6 9V3h12v6M6 18h-2a1 1 0 01-1-1v-6a1 1 0 011-1h16a1 1 0 011 1v6a1 1 0 01-1 1h-2M6 15h12v6H6z" /></>,
  'group-interview': <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></>,
  'group-policy': <><path d="M5 4h14v16l-3.5-2-3.5 2-3.5-2L5 20z" /><path d="M9 9h6M9 13h6" /></>,
  // AI简历服务磁贴
  'diagnose': <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8.5 11l1.8 1.8 3.4-3.4" /></>,
  'optimize': <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></>,
  'materials-book': <><path d="M4 5a2 2 0 012-2h5v18H6a2 2 0 01-2-2zM11 3h7a2 2 0 012 2v14a2 2 0 01-2 2h-7" /></>,
  'compass': <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>,
  'printer': <><path d="M6 9V3h12v6M6 18h-2a1 1 0 01-1-1v-6a1 1 0 011-1h16a1 1 0 011 1v6a1 1 0 01-1 1h-2M6 15h12v6H6z" /></>,
  'briefcase': <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 12h18" /></>,
  // 岗位信息磁贴
  'job-fulltime': <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" /></>,
  'cap': <><path d="M12 3L2 8l10 5 10-5z" /><path d="M6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5" /></>,
  'clock': <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  'grid': <><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></>,
  'company': <><path d="M4 21V5a2 2 0 012-2h8a2 2 0 012 2v16M4 21h16M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /></>,
  'star': <><path d="M12 2l2.6 6.6 6.4.6-5 4.3 1.6 6.5L12 16.8 6.4 20l1.6-6.5-5-4.3 6.4-.6z" /></>,
  // 招聘会磁贴
  'fair-social': <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0112 0M16 4.5a3 3 0 010 7M21 20a6 6 0 00-4.5-5.8" /></>,
  'qr': <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14h1M14 20h1M20 20h1v1" /></>,
  // 打印扫描磁贴
  'id-copy': <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3" /></>,
  'scan': <><path d="M3 8V5a2 2 0 012-2h3M16 3h3a2 2 0 012 2v3M21 16v3a2 2 0 01-2 2h-3M8 21H5a2 2 0 01-2-2v-3M3 12h18" /></>,
  'convert': <><path d="M4 7h13l-3-3M20 17H7l3 3" /></>,
  'id-photo': <><circle cx="12" cy="9" r="3.5" /><path d="M5 20a7 7 0 0114 0" /></>,
  // 顶栏 / 登录 / 底部导航
  'user': <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></>,
  'nav-home': <><path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10" /></>,
  'nav-assistant': <><path d="M21 12a8 8 0 01-8 8H4l2-3a8 8 0 1115-5z" /><path d="M9 12h.01M13 12h.01M17 12h.01" /></>,
  // 动态专区 / 合规提示
  'zone-toolbox': <><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M9 8V6a3 3 0 016 0v2M3 13h18M12 12v3" /></>,
  'zone-campus': <><path d="M12 3L2 8l10 5 10-5z" /><path d="M6 10.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-5.5M22 8v5" /></>,
  'arrow': <><path d="M9 6l6 6-6 6" /></>,
  'info': <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></>,
}

const FILL_ICONS = new Set(['star'])

export function ProtoIcon({ name }: { name: string }) {
  const path = P[name]
  if (!path) return null
  const isFill = FILL_ICONS.has(name)
  return (
    <svg viewBox="0 0 24 24" fill={isFill ? 'currentColor' : 'none'} stroke={isFill ? 'none' : 'currentColor'} strokeWidth={1.6}>
      {path}
    </svg>
  )
}
