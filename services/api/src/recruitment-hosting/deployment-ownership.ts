/**
 * 招聘锁（合规边界 §1.1，产品负责人 2026-10-12：可以加招聘锁）。
 *
 * 部署归属只认原样的 customer_private（只去首尾空格，不转大小写）。
 * 不写、空串、写错、大小写不符、认不出，一律按我方云。
 * 托管开没开只调 `isRecruitmentContentHostingEnabled`，不另写一套。
 *
 * 不加「许可证有效期至」：现在没有私有化客户。加上就要做运行期到期判定和后台
 * 30 天提醒。条文第 3 条允许按改动量定。证号真伪与有效期在合同里核，本软件不核验。
 *
 * 文案只许说「自报」「本软件未核验」。不得出现「已核验」「已认证」「持证」「认证」。
 */
import { isRecruitmentContentHostingEnabled } from './recruitment-hosting'

export const DEPLOYMENT_OWNERSHIP_ENV = 'DEPLOYMENT_OWNERSHIP'
export const VENDOR_CLOUD_OWNERSHIP = 'vendor_cloud'
export const CUSTOMER_PRIVATE_OWNERSHIP = 'customer_private'
export const RECRUITMENT_OPERATOR_NAME_ENV = 'RECRUITMENT_OPERATOR_NAME'
export const RECRUITMENT_OPERATOR_LICENSE_NO_ENV = 'RECRUITMENT_OPERATOR_LICENSE_NO'

export type DeploymentOwnership = typeof VENDOR_CLOUD_OWNERSHIP | typeof CUSTOMER_PRIVATE_OWNERSHIP
export type RecruitmentLockVerdict = 'ok' | 'locked_vendor_cloud' | 'operator_self_report_missing'

export interface OperatorSelfReport {
  name: string
  /** 编号全文，只去掉首尾空格，便于和纸质证比对。 */
  licenseNumber: string
}

export interface RecruitmentLockEvaluation {
  ownership: DeploymentOwnership
  hostingEnabled: boolean
  verdict: RecruitmentLockVerdict
  /** 仅「客户私有化部署 + 托管开 + 名称与编号都非空」时有值。 */
  selfReport: OperatorSelfReport | null
}

export type RecruitmentLockEnv = {
  [key: string]: string | undefined
}

function trimmed(env: RecruitmentLockEnv, key: string): string {
  return env[key]?.trim() ?? ''
}

export function resolveDeploymentOwnership(env: RecruitmentLockEnv): DeploymentOwnership {
  const raw = trimmed(env, DEPLOYMENT_OWNERSHIP_ENV)
  if (raw === CUSTOMER_PRIVATE_OWNERSHIP) return CUSTOMER_PRIVATE_OWNERSHIP
  return VENDOR_CLOUD_OWNERSHIP
}

export function evaluateRecruitmentLock(env: RecruitmentLockEnv = process.env): RecruitmentLockEvaluation {
  const ownership = resolveDeploymentOwnership(env)
  const hostingEnabled = isRecruitmentContentHostingEnabled(env as NodeJS.ProcessEnv)
  const name = trimmed(env, RECRUITMENT_OPERATOR_NAME_ENV)
  const licenseNumber = trimmed(env, RECRUITMENT_OPERATOR_LICENSE_NO_ENV)
  const selfReport =
    ownership === CUSTOMER_PRIVATE_OWNERSHIP && hostingEnabled && name && licenseNumber
      ? { name, licenseNumber }
      : null

  let verdict: RecruitmentLockVerdict = 'ok'
  if (ownership === VENDOR_CLOUD_OWNERSHIP && hostingEnabled) verdict = 'locked_vendor_cloud'
  else if (ownership === CUSTOMER_PRIVATE_OWNERSHIP && hostingEnabled && !selfReport) {
    verdict = 'operator_self_report_missing'
  }

  return { ownership, hostingEnabled, verdict, selfReport }
}

/** 后台卡片与启动日志里的自报句共用这一处。编号是全文。 */
export function operatorSelfReportNoticeText(report: OperatorSelfReport): string {
  return `运营单位自报：${report.name}，人力资源服务许可证编号 ${report.licenseNumber}。本软件未核验。`
}

/** 端口起来之后打的一行。三种合法状态的字不变。非生产才会出现的两种不合规状态写成 WARN，并写明非生产。 */
export function recruitmentLockStartupLine(lock: RecruitmentLockEvaluation): string {
  if (lock.ownership === CUSTOMER_PRIVATE_OWNERSHIP && lock.hostingEnabled && lock.selfReport) {
    return `[INFO] RECRUITMENT_OPERATOR_SELF_REPORTED: 部署归属=客户私有化部署；招聘内容托管=开；${operatorSelfReportNoticeText(lock.selfReport)}`
  }
  if (lock.hostingEnabled && lock.ownership === VENDOR_CLOUD_OWNERSHIP) {
    return '[WARN] RECRUITMENT_LOCK: 非生产环境：部署归属=我方云；招聘内容托管=开（生产环境会拒绝启动）'
  }
  if (lock.hostingEnabled && lock.ownership === CUSTOMER_PRIVATE_OWNERSHIP) {
    return '[WARN] RECRUITMENT_LOCK: 非生产环境：部署归属=客户私有化部署；招聘内容托管=开；运营单位自报缺项（生产环境会拒绝启动）'
  }
  const hostingWord = lock.hostingEnabled ? '开' : '关'
  if (lock.ownership === CUSTOMER_PRIVATE_OWNERSHIP) {
    return `[INFO] RECRUITMENT_LOCK: 部署归属=客户私有化部署；招聘内容托管=${hostingWord}`
  }
  return `[INFO] RECRUITMENT_LOCK: 部署归属=我方云；招聘内容托管=${hostingWord}`
}

export function recruitmentLockProductionError(verdict: RecruitmentLockVerdict): Error | null {
  if (verdict === 'locked_vendor_cloud') {
    return new Error(
      'PRODUCTION_RECRUITMENT_HOSTING_LOCKED: 部署归属按我方云处理（DEPLOYMENT_OWNERSHIP 未设、写错或为 vendor_cloud）时，不能打开招聘内容托管 RECRUITMENT_CONTENT_HOSTING_ENABLED',
    )
  }
  if (verdict === 'operator_self_report_missing') {
    return new Error(
      'PRODUCTION_RECRUITMENT_OPERATOR_SELF_REPORT_MISSING: 客户私有化部署打开招聘内容托管时，必须同时填写 RECRUITMENT_OPERATOR_NAME 和 RECRUITMENT_OPERATOR_LICENSE_NO',
    )
  }
  return null
}
