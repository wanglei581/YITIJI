/**
 * 年满 14 周岁声明：登录勾选另记 age-14-plus-login-v1，两版都认，导出按版本给原文。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:age-login-declaration
 */
import 'reflect-metadata'

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  BadRequestException,
  ForbiddenException,
  Logger,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common'
import { AiAccessService, type AiAccessConfig } from '../src/ai-access/ai-access.service'
import { MemberDataExportMapper } from '../src/member-privacy/member-data-export.mapper'
import { GrantAiConsentDto } from '../src/member-privacy/member-privacy.controller'
import {
  MemberPrivacyService,
  AGE_14_PLUS_CONSENT_COPY,
  AGE_14_PLUS_LOGIN_CONSENT_COPY,
  AGE_14_PLUS_LOGIN_CONSENT_VERSION,
  CURRENT_AGE_14_PLUS_CONSENT_VERSION,
  CURRENT_JOB_AI_CONSENT_VERSION,
  CURRENT_VOICE_RECORDING_CONSENT_VERSION,
  VOICE_RECORDING_CONSENT_COPY,
} from '../src/member-privacy/member-privacy.service'
import type { MemberAiConsentStatus } from '../src/member-privacy/member-privacy.types'
import { PrismaService } from '../src/prisma/prisma.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const LOGIN_VERSION = 'age-14-plus-login-v1'
const PROMPT_VERSION = 'age-14-plus-v1'
const UNKNOWN_VERSION = 'made-up-consent-version'
const DECLARED: AiAccessConfig = {
  loginGate: 'off',
  declarationEnforced: true,
  paused: false,
  maintenance: false,
}

Logger.overrideLogger({ log() {}, error() {}, warn() {}, debug() {}, verbose() {} })

const failures: string[] = []

function pass(msg: string): void {
  console.log(`  PASS ${msg}`)
}

function fail(msg: string): never {
  throw new Error(`VERIFY FAILED: ${msg}`)
}

function isVerifyFailure(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith('VERIFY FAILED:')
}

async function scenario(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run()
    pass(name)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`  FAIL ${name}: ${message}`)
    failures.push(`${name}: ${message}`)
  }
}

function validationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) => {
      const details: string[] = []
      const walk = (items: ValidationError[], parent = ''): void => {
        for (const item of items) {
          const path = parent ? `${parent}.${item.property}` : item.property
          for (const message of Object.values(item.constraints ?? {})) details.push(`${path}: ${message}`)
          if (item.children?.length) walk(item.children, path)
        }
      }
      walk(errors)
      return new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: details[0] ?? '请求参数校验失败',
          details,
        },
      })
    },
  })
}

function assertValidationFailed(error: unknown, label: string): void {
  if (!(error instanceof BadRequestException) || error.getStatus() !== 400) {
    fail(`${label} 不是 400`)
  }
  const body = error.getResponse() as { error?: { code?: string } }
  if (body.error?.code !== 'VALIDATION_FAILED') fail(`${label} 错误码是 ${body.error?.code ?? '空'}`)
}

function assertLoginGranted(status: MemberAiConsentStatus, label: string): void {
  if (!status.granted) fail(`${label} 未 granted`)
  if (status.grantedVersion !== LOGIN_VERSION) fail(`${label} grantedVersion=${status.grantedVersion}`)
  if (status.grantedSource !== 'login_checkbox') fail(`${label} grantedSource=${status.grantedSource}`)
  if (status.consentVersion !== PROMPT_VERSION) fail(`${label} consentVersion=${status.consentVersion}`)
  if (status.revokedAt) fail(`${label} 不该带着撤回时间`)
}

function loginCheckboxSentence(wxml: string): string {
  const start = wxml.indexOf('我已阅读并同意')
  const end = wxml.indexOf('周岁', start)
  if (start < 0 || end < 0) fail('勾选句里找不到「我已阅读并同意」到「周岁」')
  const slice = wxml.slice(start, end + '周岁'.length)
  return slice.replace(/<[^>]+>/g, '').replace(/[ \t]*\r?\n[ \t]*/g, '')
}

function assertCopyEqual(screen: string, expected: string): void {
  if (screen !== expected) {
    throw new Error(`不一致\n屏上：${screen}\n常量：${expected}`)
  }
}

function listWxml(dir: string, out: string[]): void {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.tmp') continue
    const full = join(dir, name)
    let info: ReturnType<typeof statSync>
    try {
      info = statSync(full)
    } catch {
      continue
    }
    if (info.isDirectory()) listWxml(full, out)
    else if (name.endsWith('.wxml')) out.push(full)
  }
}

function makeAccess(prisma: PrismaService): AiAccessService {
  const redis = {
    async get(key: string): Promise<string | null> {
      const prefix = 'member:session:'
      return key.startsWith(prefix) ? key.slice(prefix.length) : null
    },
  }
  const jwt = {
    verify(token: string): { sub: string; jti: string } {
      return { sub: token, jti: token }
    },
  }
  return new AiAccessService(redis as never, {} as never, jwt as never, prisma)
}

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()
  if (AGE_14_PLUS_LOGIN_CONSENT_VERSION !== LOGIN_VERSION) fail('登录版本常量不是 age-14-plus-login-v1')
  if (CURRENT_AGE_14_PLUS_CONSENT_VERSION !== PROMPT_VERSION) fail('当前版本常量不是 age-14-plus-v1')

  const prisma = new PrismaService()
  const privacy = new MemberPrivacyService(prisma)
  const mapper = new MemberDataExportMapper(prisma)
  const access = makeAccess(prisma)
  const pipe = validationPipe()
  const suffix = Date.now().toString(36)
  const ids: string[] = []
  const userId = (name: string): string => {
    const id = `agelogin_${name}_${suffix}`
    ids.push(id)
    return id
  }

  async function createUser(name: string): Promise<string> {
    const id = userId(name)
    await prisma.endUser.create({ data: { id, phoneHash: `h_${id}`, phoneEnc: `e_${id}` } })
    return id
  }

  async function ageRows(endUserId: string) {
    return prisma.userAiConsent.findMany({
      where: { endUserId, scope: 'age_14_plus' },
      orderBy: [{ grantedAt: 'asc' }, { id: 'asc' }],
    })
  }

  try {
    await scenario('1. 没有记录时带 source 写成登录版本', async () => {
      const endUserId = await createUser('s1')
      const before = await ageRows(endUserId)
      if (before.length !== 0) fail(`1. 对照：一开始有 ${before.length} 条`)
      const status = await privacy.grantConsent(endUserId, 'age_14_plus', null, 'login_checkbox')
      const after = await ageRows(endUserId)
      if (after.length !== 1) fail(`1. 库里是 ${after.length} 条`)
      if (after[0]?.consentVersion !== LOGIN_VERSION) fail(`1. 版本是 ${after[0]?.consentVersion}`)
      assertLoginGranted(status, '1')
      const job = (await privacy.getConsentStatus(endUserId)).find((item) => item.scope === 'job_ai')
      if (!job || job.granted || job.grantedVersion !== null || job.grantedSource !== null) {
        fail('1. 对照：没声明的 job_ai 也被标成已声明')
      }
      if (job.consentVersion !== CURRENT_JOB_AI_CONSENT_VERSION) fail('1. job_ai 当前版本变了')
    })

    await scenario('2. 已有登录版本时再带 source 不重复写', async () => {
      const endUserId = await createUser('s2')
      await privacy.grantConsent(endUserId, 'age_14_plus', null, 'login_checkbox')
      const mid = await ageRows(endUserId)
      if (mid.length !== 1 || mid[0]?.consentVersion !== LOGIN_VERSION) fail('2. 对照：第一次没有写成一条登录版本')
      const again = await privacy.grantConsent(endUserId, 'age_14_plus', null, 'login_checkbox')
      const after = await ageRows(endUserId)
      if (after.length !== 1) fail(`2. 库里变成 ${after.length} 条`)
      if (after[0]?.id !== mid[0]?.id) fail('2. 换成了另一条记录')
      assertLoginGranted(again, '2')
    })

    await scenario('3. 已有未撤回的 v1 时带 source 不写', async () => {
      const endUserId = await createUser('s3')
      await privacy.grantConsent(endUserId, 'age_14_plus', null)
      const before = await ageRows(endUserId)
      if (before.length !== 1 || before[0]?.consentVersion !== PROMPT_VERSION || before[0]?.revokedAt) {
        fail('3. 对照：预先不是一条未撤回的 v1')
      }
      const status = await privacy.grantConsent(endUserId, 'age_14_plus', null, 'login_checkbox')
      const after = await ageRows(endUserId)
      if (after.length !== 1) fail(`3. 条数变成 ${after.length}`)
      if (after[0]?.consentVersion !== PROMPT_VERSION || after[0]?.id !== before[0]?.id) fail('3. v1 被改写或换掉')
      if (!status.granted || status.grantedSource !== 'prompt' || status.grantedVersion !== PROMPT_VERSION) {
        fail(`3. 状态 granted=${status.granted} source=${status.grantedSource} version=${status.grantedVersion}`)
      }
      if (status.consentVersion !== PROMPT_VERSION) fail('3. consentVersion 不再是当前版本')
    })

    await scenario('4. 最新一条已撤回时带 source 新写登录版本', async () => {
      const endUserId = await createUser('s4')
      await privacy.grantConsent(endUserId, 'age_14_plus', null)
      const revoked = await privacy.revokeConsent(endUserId, 'age_14_plus')
      const before = await ageRows(endUserId)
      if (revoked.count !== 1 || before.length !== 1 || !before[0]?.revokedAt) {
        fail('4. 对照：最新一条没有撤回')
      }
      const status = await privacy.grantConsent(endUserId, 'age_14_plus', null, 'login_checkbox')
      const after = await ageRows(endUserId)
      if (after.length !== 2) fail(`4. 条数是 ${after.length}`)
      const oldRow = after.find((row) => row.consentVersion === PROMPT_VERSION)
      const loginRow = after.find((row) => row.consentVersion === LOGIN_VERSION)
      if (!oldRow?.revokedAt) fail('4. 旧的 v1 被改写')
      if (!loginRow || loginRow.revokedAt) fail('4. 没有新的未撤回登录版本')
      assertLoginGranted(status, '4')
    })

    await scenario('5. source 只配 age_14_plus，非法值和未知字段都是 400', async () => {
      const accepted = await pipe.transform(
        { scope: 'age_14_plus', source: 'login_checkbox' },
        { type: 'body', metatype: GrantAiConsentDto },
      ).then(() => true, (error: unknown) => {
        if (isVerifyFailure(error)) throw error
        return false
      })
      if (!accepted) fail('5. 对照：合法的登录勾选入参被拒了')
      const plain = await pipe.transform(
        { scope: 'age_14_plus' },
        { type: 'body', metatype: GrantAiConsentDto },
      ).then(() => true, () => false)
      if (!plain) fail('5. 对照：不带 source 的 age_14_plus 被拒了')

      const badBodies: Array<[string, object]> = [
        ['voice_recording 带 login_checkbox', { scope: 'voice_recording', source: 'login_checkbox' }],
        ['source 不是 login_checkbox', { scope: 'age_14_plus', source: 'other' }],
        ['不认识的字段', { scope: 'age_14_plus', source: 'login_checkbox', extraField: 'no' }],
      ]
      for (const [label, body] of badBodies) {
        try {
          await pipe.transform(body, { type: 'body', metatype: GrantAiConsentDto })
          fail(`5. ${label} 没有 400`)
        } catch (error) {
          if (isVerifyFailure(error)) throw error
          assertValidationFailed(error, `5. ${label}`)
        }
      }

      const endUserId = await createUser('s5')
      const before = await prisma.userAiConsent.count({ where: { endUserId } })
      if (before !== 0) fail('5. 对照：服务端拒绝前库里已有记录')
      try {
        await privacy.grantConsent(endUserId, 'voice_recording', null, 'login_checkbox')
        fail('5. 服务端接受了 voice_recording 带 source')
      } catch (error) {
        if (isVerifyFailure(error)) throw error
        assertValidationFailed(error, '5. 服务端 voice_recording 带 source')
      }
      const after = await prisma.userAiConsent.count({ where: { endUserId } })
      if (after !== 0) fail('5. 拒绝时仍写了记录')
    })

    await scenario('6. 不带 source 照旧追加 v1', async () => {
      const endUserId = await createUser('s6')
      const before = await ageRows(endUserId)
      if (before.length !== 0) fail('6. 对照：一开始不是空的')
      const status = await privacy.grantConsent(endUserId, 'age_14_plus', null)
      const once = await ageRows(endUserId)
      if (once.length !== 1 || once[0]?.consentVersion !== PROMPT_VERSION) {
        fail(`6. 写成了 ${once.length} 条 ${once[0]?.consentVersion}`)
      }
      if (!status.granted || status.grantedSource !== 'prompt' || status.grantedVersion !== PROMPT_VERSION) {
        fail(`6. 状态 source=${status.grantedSource} version=${status.grantedVersion}`)
      }
      if (status.consentVersion !== PROMPT_VERSION) fail('6. consentVersion 变了')
      await privacy.grantConsent(endUserId, 'age_14_plus', null)
      const twice = await ageRows(endUserId)
      if (twice.length !== 2 || twice.some((row) => row.consentVersion !== PROMPT_VERSION)) {
        fail('6. 不带 source 没有再追加一条 v1')
      }
    })

    await scenario('7. 只有登录版本时年龄声明和一体机闸门都放行', async () => {
      const endUserId = await createUser('s7')
      const emptyId = await createUser('s7empty')
      await privacy.grantConsent(endUserId, 'age_14_plus', null, 'login_checkbox')
      const only = await ageRows(endUserId)
      if (only.length !== 1 || only[0]?.consentVersion !== LOGIN_VERSION || only[0]?.revokedAt) {
        fail('7. 对照：不是只有一条未撤回的登录版本')
      }
      const event = await prisma.$transaction((tx) =>
        privacy.requireActiveConsentInTransaction(tx, endUserId, 'age_14_plus'))
      if (event.consentVersion !== LOGIN_VERSION || event.revokedAt) fail('7. requireActiveConsent 没认登录版本')
      await access.enforce('generate', false, { headers: { authorization: `Bearer ${endUserId}` } }, DECLARED)

      let requireBlocked = false
      try {
        await prisma.$transaction((tx) => privacy.requireActiveConsentInTransaction(tx, emptyId, 'age_14_plus'))
      } catch (error) {
        requireBlocked = error instanceof ForbiddenException
          && JSON.stringify(error.getResponse()).includes('USER_AI_CONSENT_REQUIRED')
      }
      if (!requireBlocked) fail('7. 对照：没有记录的人没有被 requireActiveConsent 拦住')

      let gateBlocked = false
      try {
        await access.enforce('generate', false, { headers: { authorization: `Bearer ${emptyId}` } }, DECLARED)
      } catch (error) {
        gateBlocked = error instanceof ForbiddenException
          && JSON.stringify(error.getResponse()).includes('AI_DECLARATION_REQUIRED')
      }
      if (!gateBlocked) fail('7. 对照：没有记录的人被一体机闸门放行了')
    })

    await scenario('8. 导出按版本给原文，不认识的版本是 null', async () => {
      const endUserId = await createUser('s8')
      const samples = [
        { scope: 'age_14_plus', consentVersion: PROMPT_VERSION },
        { scope: 'age_14_plus', consentVersion: LOGIN_VERSION },
        { scope: 'voice_recording', consentVersion: 'voice-recording-v1' },
        { scope: 'job_ai', consentVersion: UNKNOWN_VERSION },
      ]
      for (const sample of samples) {
        await prisma.userAiConsent.create({ data: { endUserId, ...sample } })
      }
      const envelope = await mapper.build({ endUserId, requestId: `age-login-${suffix}` })
      const consents = envelope.sections.consents
      if (consents.length !== samples.length) fail(`8. 导出了 ${consents.length} 条，对照是 ${samples.length} 条`)
      const textOf = (version: string): unknown => {
        const found = consents.filter((row) => row['consentVersion'] === version)
        if (found.length !== 1) fail(`8. 版本 ${version} 导出了 ${found.length} 条`)
        if (!('declarationText' in found[0]!)) fail(`8. 版本 ${version} 没有 declarationText`)
        return found[0]!['declarationText']
      }
      if (textOf(PROMPT_VERSION) !== AGE_14_PLUS_CONSENT_COPY) fail('8. v1 原文不对')
      if (textOf(LOGIN_VERSION) !== AGE_14_PLUS_LOGIN_CONSENT_COPY) fail('8. 登录版本原文不对')
      if (textOf('voice-recording-v1') !== VOICE_RECORDING_CONSENT_COPY) fail('8. 录音同意原文不对')
      if (CURRENT_VOICE_RECORDING_CONSENT_VERSION !== 'voice-recording-v1') fail('8. 录音版本常量变了')
      if (textOf(UNKNOWN_VERSION) !== null) fail(`8. 其它版本应是 null，实际 ${String(textOf(UNKNOWN_VERSION))}`)
      if (textOf(LOGIN_VERSION) === textOf(PROMPT_VERSION)) fail('8. 登录版本和弹框版本给了同一句')
    })

    await scenario('9. 登录勾选原文和小程序登录页逐字一致', async () => {
      const repoRoot = resolve(__dirname, '../../..')
      const files: string[] = []
      listWxml(repoRoot, files)
      const pages = files.filter((file) => {
        const text = readFileSync(file, 'utf8')
        return text.includes('我已阅读并同意') && text.includes('并确认已年满')
      })
      const launch = resolve(repoRoot, 'apps/miniapp/pages/launch/launch.wxml')
      if (!pages.includes(launch)) fail(`9. 没找到登录页，扫到 ${pages.length} 个`)
      for (const file of pages) {
        const wxml = readFileSync(file, 'utf8')
        assertCopyEqual(loginCheckboxSentence(wxml), AGE_14_PLUS_LOGIN_CONSENT_COPY)
        const broken = wxml.replace('并确认已年满 14 周岁', '并确认已年满 15 周岁')
        if (broken === wxml) fail(`9. 阳性对照没有改到 ${file} 里的字`)
        let reported = false
        try {
          assertCopyEqual(loginCheckboxSentence(broken), AGE_14_PLUS_LOGIN_CONSENT_COPY)
        } catch (error) {
          reported = error instanceof Error && error.message.includes('不一致')
        }
        if (!reported) fail(`9. 改坏一个字后比较没有报不一致：${file}`)
      }
      pass(`9. 比过 ${pages.length} 个登录勾选页`)
    })
  } finally {
    await prisma.userAiConsent.deleteMany({ where: { endUserId: { in: ids } } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined)
    await prisma.onModuleDestroy()
  }

  if (failures.length > 0) {
    console.error(`\nVERIFY FAILED (${failures.length})`)
    process.exit(1)
  }
  console.log('\nALL PASS (9)')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
