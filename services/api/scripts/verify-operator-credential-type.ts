/**
 * 运营单位自报的证照类型二选一。
 *
 * 1. 没设类型 → 许可证句
 * 2. public_employment_registration → 登记信息句
 * 3. 非法值 → 预检报 PRODUCTION_RECRUITMENT_OPERATOR_CREDENTIAL_TYPE_INVALID，输出不含该值
 * 4. 登记类型但没填内容 → 仍报 PRODUCTION_RECRUITMENT_OPERATOR_SELF_REPORT_MISSING
 *
 * 预检脚本打印的就是 assertProductionRuntimeGates 抛出的 Error.message。
 * 这里同时打源码闸门和预检脚本，预检脚本吃 dist，跑之前要先构建 API。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertProductionRuntimeGates, type ProductionRuntimeEnv } from '../src/config/production-runtime-gates'
import {
  evaluateRecruitmentLock,
  operatorSelfReportNoticeText,
  type RecruitmentLockEnv,
} from '../src/recruitment-hosting/deployment-ownership'

const NAME = '示例职业介绍所'
const CONTENT = '鲁人社证字〔2026〕第001号'
const LICENSE_SENTENCE = `运营单位自报：${NAME}，人力资源服务许可证编号 ${CONTENT}。本软件未核验。`
const REG_SENTENCE = `运营单位自报：${NAME}，公共就业服务机构登记信息 ${CONTENT}。本软件未核验。`
const BAD_TYPE = 'zz-not-a-credential-type'
const INVALID_CODE = 'PRODUCTION_RECRUITMENT_OPERATOR_CREDENTIAL_TYPE_INVALID'
const MISSING_CODE = 'PRODUCTION_RECRUITMENT_OPERATOR_SELF_REPORT_MISSING'

const FONT_OK = {
  ok: true as const,
  path: '/verify/NotoSansCJK-Regular.ttc',
  family: 'NotoSansCJKsc-Regular',
  tried: ['/verify/NotoSansCJK-Regular.ttc'],
}

function fail(message: string): never {
  throw new Error(message)
}

function privateEnv(extra: RecruitmentLockEnv = {}): RecruitmentLockEnv {
  return {
    DEPLOYMENT_OWNERSHIP: 'customer_private',
    RECRUITMENT_CONTENT_HOSTING_ENABLED: 'true',
    RECRUITMENT_OPERATOR_NAME: NAME,
    RECRUITMENT_OPERATOR_LICENSE_NO: CONTENT,
    ...extra,
  }
}

function productionEnv(extra: RecruitmentLockEnv): ProductionRuntimeEnv {
  return { NODE_ENV: 'production', ...privateEnv(extra) }
}

function gateMessage(env: ProductionRuntimeEnv): string {
  try {
    assertProductionRuntimeGates(env, FONT_OK)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return ''
}

function runPreflight(envBody: string): { status: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'credential-type-preflight-'))
  const envFile = join(dir, '.env')
  writeFileSync(envFile, envBody, 'utf8')
  try {
    const result = spawnSync(process.execPath, [
      join(__dirname, 'preflight-production-gates.mjs'),
      '--env-file',
      envFile,
    ], { encoding: 'utf8' })
    return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const unset = evaluateRecruitmentLock(privateEnv())
if (
  unset.selfReport?.credentialType !== 'hr_service_license'
  || operatorSelfReportNoticeText(unset.selfReport) !== LICENSE_SENTENCE
) {
  fail(`没设类型时应为许可证句，实际 ${unset.selfReport ? operatorSelfReportNoticeText(unset.selfReport) : 'null'}`)
}
const blankType = evaluateRecruitmentLock(privateEnv({ RECRUITMENT_OPERATOR_CREDENTIAL_TYPE: '  ' }))
if (
  blankType.selfReport?.credentialType !== 'hr_service_license'
  || operatorSelfReportNoticeText(blankType.selfReport) !== LICENSE_SENTENCE
) {
  fail(`空类型时应为许可证句，实际 ${blankType.selfReport ? operatorSelfReportNoticeText(blankType.selfReport) : 'null'}`)
}
console.log('  PASS 没设或空类型 → 人力资源服务许可证编号句')

const registered = evaluateRecruitmentLock(privateEnv({
  RECRUITMENT_OPERATOR_CREDENTIAL_TYPE: 'public_employment_registration',
}))
if (
  registered.selfReport?.credentialType !== 'public_employment_registration'
  || operatorSelfReportNoticeText(registered.selfReport) !== REG_SENTENCE
) {
  fail(`登记类型时应为登记信息句，实际 ${registered.selfReport ? operatorSelfReportNoticeText(registered.selfReport) : 'null'}`)
}
console.log('  PASS public_employment_registration → 公共就业服务机构登记信息句')

const invalidMessage = gateMessage(productionEnv({ RECRUITMENT_OPERATOR_CREDENTIAL_TYPE: BAD_TYPE }))
const preflight = runPreflight([
  'RECRUITMENT_CONTENT_HOSTING_ENABLED=true',
  'DEPLOYMENT_OWNERSHIP=customer_private',
  `RECRUITMENT_OPERATOR_NAME=${NAME}`,
  `RECRUITMENT_OPERATOR_LICENSE_NO=${CONTENT}`,
  `RECRUITMENT_OPERATOR_CREDENTIAL_TYPE=${BAD_TYPE}`,
  '',
].join('\n'))
const preflightOutput = preflight.output
if (
  !invalidMessage.includes(INVALID_CODE)
  || invalidMessage.includes(BAD_TYPE)
  || preflight.status === 0
  || !preflightOutput.includes(INVALID_CODE)
  || preflightOutput.includes(BAD_TYPE)
) {
  fail(
    `非法类型应预检失败且不回显该值。闸门=${invalidMessage} status=${preflight.status} output=${preflightOutput.slice(0, 500)}`,
  )
}
console.log(`  PASS 非法类型 → 预检 ${INVALID_CODE}，输出不含该值`)

const missingMessage = gateMessage(productionEnv({
  RECRUITMENT_OPERATOR_CREDENTIAL_TYPE: 'public_employment_registration',
  RECRUITMENT_OPERATOR_LICENSE_NO: undefined,
}))
if (!missingMessage.includes(MISSING_CODE) || missingMessage.includes(INVALID_CODE)) {
  fail(`登记类型但没填内容应报缺项，实际 ${missingMessage}`)
}
console.log(`  PASS 登记类型但没填内容 → ${MISSING_CODE}`)

console.log('\nverify:operator-credential-type 通过')
