import type { PublicKioskProfile } from '@ai-job-print/shared'

/**
 * GET /api/v1/public/kiosk-profile 在浏览器用例里的样子（契约：packages/shared/src/types/branding.ts 的 PublicKioskProfile）。
 *
 * 一体机在每个终端业务页挂载时读一次，之后每 3 分钟续读，会话 ready / failed 时也读。
 * 响应分两种：
 *   · 验过签（请求带着仍有效的终端会话票）：机构品牌、点位名、授权块（licenseState 非空）；
 *   · 没验过（没带票、票过期或验不过）：只给平台默认品牌，licenseState 与 currentSessionEndsAt 为 null，
 *     acceptsNewSessions 恒为 true——意思是「不知道、不拦」。授权闸门只认 licenseState 非空的那一种。
 *
 * ApiRouter 默认按「没验过」应答（见 api-router.ts），所以既有用例的品牌、入口与流程一概不变；
 * 要看贴牌或授权三态的用例自己覆盖（kiosk-license-gate.spec.ts 用一个带时钟的假服务端）。
 *
 * 这里的默认值是平台默认品牌与备案，写成字面量而不是 import 共享常量：用例要钉的是屏上看到的字，不是常量自己。
 */
export type KioskProfileOverrides = Partial<PublicKioskProfile>

export function kioskProfile(overrides: KioskProfileOverrides = {}): PublicKioskProfile {
  return {
    brandName: '职易达',
    brandMark: '职',
    logoUrl: null,
    filing: {
      icp: '鲁ICP备2026023517号-2',
      icpUrl: 'https://beian.miit.gov.cn/',
      police: '鲁公网安备37021402007308号',
      policeUrl: 'https://beian.mps.gov.cn/#/query/webSearch?code=37021402007308',
    },
    location: null,
    licenseState: null,
    acceptsNewSessions: true,
    currentSessionMayContinue: false,
    currentSessionEndsAt: null,
    noticeLine: null,
    ...overrides,
  }
}

/** 没验过签时服务端给的答复：平台默认品牌，不带任何授权状态。 */
export const UNVERIFIED_KIOSK_PROFILE: PublicKioskProfile = kioskProfile()

/** 接口外层的包装（与其它 /public 接口一致：{ success, data }）。 */
export function kioskProfileBody(profile: PublicKioskProfile): { success: true; data: PublicKioskProfile } {
  return { success: true, data: profile }
}
