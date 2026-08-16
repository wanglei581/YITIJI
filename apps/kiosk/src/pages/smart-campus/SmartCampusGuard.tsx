// ============================================================
// SmartCampusGuard — 智慧校园子页统一门禁
//
// 背景（2026-08-11 补）：
// 智慧校园配置的设计意图写得很明确——「智慧校园承载校园专属入口，
// 机器搬离校园后绝不能残留」，因此默认 OFF、不持久化。
// 但 SmartCampusHomePage 之外的子页（/welcome、/service/:key、/freshman-insights）
// 此前**完全不检查配置**，路由注释称「保留直接访问容错」。
// 结果：终端关闭智慧校园、甚至机器已搬离校园后，仍可通过深链接看到校园内容页——
// 与 hook 的设计意图直接矛盾，属门禁缺口。
//
// 总开关由父级 SmartCampusCapabilityBoundary 统一校验；本组件只消费父级同一份
// 已验证快照并执行 welcome/luggage/panorama 子模块门禁，避免二次请求形成状态撕裂。
// ============================================================

import type { ReactNode } from 'react'
import { Button, Card } from '@ai-job-print/ui'
import { PartyPopperIcon } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import type { KioskSmartCampusConfig } from '@ai-job-print/shared'
import { useSmartCampusCapabilitySnapshot } from '../../auth/KioskCapabilityGuard'

type ModuleKey = keyof KioskSmartCampusConfig['modules']

interface Props {
  /** 需要额外校验的模块开关；省略则只校验总开关 */
  module?: ModuleKey
  children: ReactNode
}

export function SmartCampusGuard({ module, children }: Props) {
  const navigate = useNavigate()
  const { key } = useParams<{ key?: string }>()
  const { config, enabled } = useSmartCampusCapabilitySnapshot()
  const serviceModule = key === 'luggage' || key === 'panorama' ? key : undefined
  const requiredModule = module ?? serviceModule

  const blocked = !enabled || (requiredModule ? !config.modules[requiredModule] : false)
  if (!blocked) return <>{children}</>
  return (
    <div className="grid min-h-screen place-items-center p-10" data-kiosk-screen="capability-gate">
      <Card className="kproto-card flex flex-col items-center justify-center gap-4 p-10 text-center">
        <PartyPopperIcon className="h-12 w-12 text-neutral-400" aria-hidden="true" />
        <p className="text-lg text-neutral-500">本机暂未开启这项智慧校园服务</p>
        <Button size="lg" onClick={() => navigate('/smart-campus')}>返回智慧校园</Button>
      </Card>
    </div>
  )
}
