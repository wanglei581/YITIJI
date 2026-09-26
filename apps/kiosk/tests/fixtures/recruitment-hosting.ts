/**
 * 招聘内容托管（next-tasks 3.13）的终端配置片段。
 *
 * 服务端 GET /terminals/:id/config 恒下发这两个字段（terminals-admin.service.ts
 * getKioskTerminalConfig）；托管关闭时同时把 jobBoard.enabled 压成 false、reason 写 global_off。
 *
 * - ON：客户私有化部署（b）。岗位 / 招聘会 / 企业 / 校招 / 线下机构页照今天的样子工作，
 *   既有用例测的就是这一态。
 * - OFF：我们云上的默认（托管 a）。一体机不摆任何招聘入口，直达地址落到诚实说明页。
 */
export const RECRUITMENT_HOSTING_ON = {
  jobBoard: { enabled: true, globalEnabled: true, terminalEnabled: null, reason: 'open' },
  recruitmentHosting: { enabled: true, deploymentEnabled: true, reason: 'open' },
} as const

export const RECRUITMENT_HOSTING_OFF = {
  jobBoard: { enabled: false, globalEnabled: false, terminalEnabled: null, reason: 'global_off' },
  recruitmentHosting: { enabled: false, deploymentEnabled: false, reason: 'deployment_off' },
} as const

/** 一份形状合法、百宝箱与智慧校园都关着的终端配置，招聘托管按参数给。 */
export function terminalConfigWithHosting(
  hosting: typeof RECRUITMENT_HOSTING_ON | typeof RECRUITMENT_HOSTING_OFF,
  configVersion = 'recruitment-hosting-fixture',
): Record<string, unknown> {
  return {
    smartCampus: {
      enabled: false,
      modules: { welcome: false, bigdata: false, luggage: false, panorama: false },
      items: [],
    },
    toolbox: { enabled: false, items: [] },
    ...hosting,
    configVersion,
    refreshIntervalMs: 300000,
    serverTime: '2026-09-26T00:00:00.000Z',
  }
}
