import { createContext, useContext } from 'react'
import type { PartnerDataSourceCapabilities } from './api'

/**
 * 机构能力（`GET /partner/data-sources/capabilities`）的共享读取口。
 *
 * **唯一来源是服务端** `services/api/src/jobs/partner-capabilities.ts` 的
 * PARTNER_CAPABILITY_MATRIX——同一份矩阵既决定服务端拒写，也决定控制台的入口投影。
 * 前端不得再按 orgType 自己写一份判断（端点名字带 data-sources 是历史原因，
 * 它返回的是整套机构能力，不只是数据源接入方式）。
 *
 * 失败/未加载时一律**按放行处理**（fail-open）：入口可见可点。
 * 理由：能力接口是展示层优化，不是权限边界；一次网络抖动不该让机构的菜单凭空少几项，
 * 而真正的拦截始终在服务端（403 PARTNER_CAPABILITY_DENIED /
 * 400 ORG_TYPE_NOT_ALLOWED_FOR_POLICY / 403 PARTNER_NOT_SCHOOL）。
 *
 * Provider 在 ./CapabilitiesProvider.tsx（拆两个文件是为了让 react-refresh
 * 不对「同一文件既导出组件又导出 hook」告警）。
 */
export interface PartnerCapabilitiesState {
  status: 'loading' | 'ready' | 'error'
  capabilities: PartnerDataSourceCapabilities | null
}

export const PartnerCapabilitiesContext = createContext<PartnerCapabilitiesState>({
  status: 'loading',
  capabilities: null,
})

export function usePartnerCapabilities(): PartnerCapabilitiesState {
  return useContext(PartnerCapabilitiesContext)
}

type BooleanCapability = {
  [K in keyof PartnerDataSourceCapabilities]: PartnerDataSourceCapabilities[K] extends boolean ? K : never
}[keyof PartnerDataSourceCapabilities]

/**
 * 读一个布尔能力位。**未加载 / 加载失败一律返回 true**（见上方 fail-open 说明），
 * 因此 `false` 只会来自服务端明确说「这类机构不能做」。
 */
export function useCapability(key: BooleanCapability): boolean {
  const { capabilities } = usePartnerCapabilities()
  return capabilities ? capabilities[key] : true
}
