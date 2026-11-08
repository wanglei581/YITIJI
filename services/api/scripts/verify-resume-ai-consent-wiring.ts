/**
 * 职业规划、版式调整、模拟面试的简历 AI 授权服务必须由模块装配注入。
 *
 * 漏导入 MemberPrivacyModule，或把该参数标成 @Optional()，本门禁失败。
 * 直接 new 的测试不走这里；这里证明真实 AppModule 装配下四处置拿到同一个服务。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:resume-ai-consent-wiring
 */
process.env['OCR_PROVIDER'] = process.env['OCR_PROVIDER'] ?? 'disabled'
require('dotenv').config()

import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { OPTIONAL_DEPS_METADATA } from '@nestjs/common/constants'
import { CareerPlanController } from '../src/ai/career-plan.controller'
import { CareerPlanService } from '../src/ai/resume/career-plan.service'
import { ResumeLayoutAdjustController } from '../src/ai/resume-layout-adjust.controller'
import { MockInterviewService } from '../src/mock-interview/mock-interview.service'
import { MemberPrivacyService } from '../src/member-privacy/member-privacy.service'

const SITES = [
  ['CareerPlanController', CareerPlanController],
  ['CareerPlanService', CareerPlanService],
  ['ResumeLayoutAdjustController', ResumeLayoutAdjustController],
  ['MockInterviewService', MockInterviewService],
] as const

function assertRequired(label: string, ctor: abstract new (...args: never[]) => object): number {
  const types = (Reflect.getMetadata('design:paramtypes', ctor) ?? []) as unknown[]
  const optional = (Reflect.getMetadata(OPTIONAL_DEPS_METADATA, ctor) ?? []) as number[]
  const index = types.indexOf(MemberPrivacyService)
  if (index < 0) {
    throw new Error(`${label} 构造参数元数据里没有 MemberPrivacyService（依赖会在漏注册时静默变成 undefined）`)
  }
  if (optional.includes(index)) {
    throw new Error(`${label} 把授权服务标成了可选注入`)
  }
  return index
}

async function main(): Promise<void> {
  for (const [label, ctor] of SITES) assertRequired(label, ctor)
  const { AppModule } = await import('../src/app.module')
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false })
  try {
    const privacy = app.get(MemberPrivacyService)
    if (!(privacy instanceof MemberPrivacyService)) throw new Error('应用容器里没有 MemberPrivacyService')
    for (const [label, token] of SITES) {
      const instance = app.get(token) as { privacy?: MemberPrivacyService }
      if (instance.privacy !== privacy) {
        throw new Error(`${label} 未注入授权服务（privacy=${instance.privacy === undefined ? 'undefined' : '其他实例'}）`)
      }
    }
    console.log('verify:resume-ai-consent-wiring：4 处授权服务均已注入')
  } finally {
    await app.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
