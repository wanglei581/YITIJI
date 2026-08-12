// ============================================================
// SmartCampusGuard — 智慧校园子页统一门禁
//
// 背景（2026-08-11 补）：
// useSmartCampusConfig 的设计意图写得很明确——「智慧校园承载校园专属入口，
// 机器搬离校园后绝不能残留」，因此默认 OFF、不持久化。
// 但 SmartCampusHomePage 之外的子页（/welcome、/service/:key、/freshman-insights）
// 此前**完全不检查配置**，路由注释称「保留直接访问容错」。
// 结果：终端关闭智慧校园、甚至机器已搬离校园后，仍可通过深链接看到校园内容页——
// 与 hook 的设计意图直接矛盾，属门禁缺口。
//
// 本组件把 SmartCampusHomePage 已有的判断收敛成统一守卫，行为与其保持一致：
// 总开关关闭 → 空态 + 返回首页，不渲染任何校园内容。
//
// 闪烁说明：hook 用进程内 cached 避免同会话跨页面闪烁，
// 从首页点进来时 cached 已有值不会闪；只有「直接深链接进入」才会先看到空态——
// 而那正是本守卫要拦截的场景。
// ============================================================

import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { PartyPopperIcon } from 'lucide-react'
import { Button, Card } from '@ai-job-print/ui'
import type { KioskSmartCampusConfig } from '@ai-job-print/shared'
import { useSmartCampusConfig } from '../../hooks/useSmartCampusConfig'

type ModuleKey = keyof KioskSmartCampusConfig['modules']

interface Props {
  /** 需要额外校验的模块开关；省略则只校验总开关 */
  module?: ModuleKey
  children: ReactNode
}

export function SmartCampusGuard({ module, children }: Props) {
  const navigate = useNavigate()
  const config = useSmartCampusConfig()

  const blocked = !config.enabled || (module ? !config.modules[module] : false)
  if (!blocked) return <>{children}</>

  return (
    <div className="grid min-h-screen place-items-center p-10">
      <Card className="kproto-card flex flex-col items-center justify-center gap-4 p-10 text-center">
        <PartyPopperIcon className="h-12 w-12 text-neutral-400" aria-hidden="true" />
        <p className="text-lg text-neutral-500">本机暂未开启智慧校园服务</p>
        <Button size="lg" onClick={() => navigate('/')}>
          返回首页
        </Button>
      </Card>
    </div>
  )
}
