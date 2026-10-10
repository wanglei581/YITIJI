import 'reflect-metadata'
import { HttpException, Logger, ValidationPipe } from '@nestjs/common'
import { MiniappCodeController, MINIAPP_CODE_PAGES } from '../src/miniapp-code/miniapp-code.controller'
import { MiniappCodeService, type MiniappEnvVersion } from '../src/miniapp-code/miniapp-code.service'

/** 只替换进程内 fetch，不监听端口、不访问真实微信或数据库。 */
const FAKE_APPID = 'fake-miniapp-appid'
const FAKE_SECRET = 'fake-miniapp-secret-runtime-only'
const FAKE_TOKEN = 'fake-miniapp-token-runtime-only'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
const PAGE = 'pages/kiosk-send/kiosk-send'
const SCENE = 'k=KSK-001&to=plan'
const MESSAGE_41030 = '小程序还没发布，或这一页不在已发布的版本里，暂时出不了小程序码'
const ENV_KEYS = ['NODE_ENV', 'WECHAT_MINIAPP_ENV_VERSION', 'WECHAT_MINIAPP_APPID', 'WECHAT_MINIAPP_APPSECRET']
let passCount = 0

function check(name: string, ok: boolean): void {
  if (!ok) throw new Error(name)
  passCount += 1
  console.log(`  PASS ${name}`)
}

function hasNoCredentials(value: string): boolean {
  return [FAKE_APPID, FAKE_SECRET, FAKE_TOKEN].every((credential) => !value.includes(credential))
}

type CodeRequest = { page: string; scene: string; check_path: boolean; env_version: MiniappEnvVersion }
type Harness = { requests: CodeRequest[]; logs: string[]; tokenCalls: () => number }

async function isolated(
  nodeEnv: string,
  configuredVersion: string | undefined,
  run: (harness: Harness) => Promise<void>,
  wxError = false,
): Promise<void> {
  const envBefore = ENV_KEYS.map((key) => [key, process.env[key]] as const)
  const fetchBefore = globalThis.fetch
  const warnBefore = Logger.prototype.warn
  // 每个用例模拟一个新进程；用例内仍验证跨服务实例的进程级去重。
  const warningState = MiniappCodeService as unknown as { productionVersionWarningLogged: boolean }
  const warningBefore = warningState.productionVersionWarningLogged
  const requests: CodeRequest[] = []
  const logs: string[] = []
  let tokenCalls = 0
  try {
    warningState.productionVersionWarningLogged = false
    process.env['NODE_ENV'] = nodeEnv
    if (configuredVersion === undefined) delete process.env['WECHAT_MINIAPP_ENV_VERSION']
    else process.env['WECHAT_MINIAPP_ENV_VERSION'] = configuredVersion
    process.env['WECHAT_MINIAPP_APPID'] = FAKE_APPID
    process.env['WECHAT_MINIAPP_APPSECRET'] = FAKE_SECRET
    Logger.prototype.warn = (message: unknown, ...params: unknown[]) => {
      logs.push(JSON.stringify([message, ...params]))
    }
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input))
      if (url.origin !== 'https://api.weixin.qq.com') throw new Error('桩拒绝未知主机')
      if (url.pathname === '/cgi-bin/token' && init?.method === 'GET') {
        tokenCalls += 1
        return Response.json({ access_token: FAKE_TOKEN, expires_in: 7200 })
      }
      if (url.pathname === '/wxa/getwxacodeunlimit' && init?.method === 'POST') {
        requests.push(JSON.parse(String(init.body)) as CodeRequest)
        return wxError ? Response.json({ errcode: 41030 }) : new Response(JPEG)
      }
      throw new Error('桩拒绝未知请求')
    }
    await run({ requests, logs, tokenCalls: () => tokenCalls })
  } finally {
    for (const [key, value] of envBefore) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    globalThis.fetch = fetchBefore
    Logger.prototype.warn = warnBefore
    warningState.productionVersionWarningLogged = warningBefore
  }
}

const versionCases: Array<[string, string | undefined, MiniappEnvVersion]> = [
  ['test', undefined, 'release'],
  ['test', 'release', 'release'],
  ['test', 'trial', 'trial'],
  ['test', 'develop', 'develop'],
  ['test', 'beta', 'release'],
  ['test', '', 'release'],
  ['test', ' trial ', 'trial'],
  ['production', 'trial', 'release'],
  ['production', 'develop', 'release'],
  ['production', undefined, 'release'],
  ['production', 'release', 'release'],
  // 生产里带空白的体验版写法同样被忽略并告警（非生产时它会被认成体验版，见上面那一例）。
  ['production', ' trial ', 'release'],
  ['production', 'beta', 'release'],
]

async function versionChecks(): Promise<void> {
  for (const [nodeEnv, configured, expected] of versionCases) {
    const label = `${nodeEnv} / ${configured === undefined ? '未配置' : JSON.stringify(configured)}`
    await isolated(nodeEnv, configured, async ({ requests, logs, tokenCalls }) => {
      const service = new MiniappCodeService()
      const controller = new MiniappCodeController(service)
      const capabilities = controller.capabilities().data
      check(`${label}：能力探测返回实际版本`, capabilities.available && capabilities.envVersion === expected)
      const direct = await service.generate(PAGE, SCENE)
      check(`${label}：服务返回实际版本与 JPEG`, direct.envVersion === expected && direct.image.equals(Buffer.from(JPEG)) && direct.mimeType === 'image/jpeg')
      const created = (await controller.create({ page: PAGE, scene: SCENE })).data
      check(`${label}：出码接口返回实际版本与图片`, created.envVersion === expected && created.dataUri === `data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`)
      check(`${label}：两次实际微信请求版本正确`, requests.length === 2 && requests.every((request) => request.env_version === expected))
      check(`${label}：两次实际微信请求检查页面正确`, requests.every((request) => request.check_path === (expected === 'release')))
      check(`${label}：页面与 scene 原样传递且 token 缓存`, requests.every((request) => request.page === PAGE && request.scene === SCENE) && tokenCalls() === 1)
      const shouldWarn = nodeEnv === 'production' && ['trial', 'develop'].includes((configured ?? '').trim())
      check(`${label}：两次出码的告警数量与文字`, shouldWarn
        ? logs.length === 1 && logs[0]!.includes('生产环境只出正式版小程序码，已忽略 WECHAT_MINIAPP_ENV_VERSION 里的体验版或开发版配置')
        : logs.length === 0)
      if (shouldWarn) {
        const another = new MiniappCodeService()
        await another.generate(PAGE, SCENE)
        check(`${label}：另一个服务实例也不重复告警`, logs.length === 1 && requests.length === 3 && requests[2]!.env_version === 'release' && requests[2]!.check_path === true)
      }
      check(`${label}：日志不泄露凭据`, hasNoCredentials(logs.join('\n')))
    })
  }
}

async function wxErrorChecks(): Promise<void> {
  await isolated('test', 'release', async ({ logs, requests }) => {
    const controller = new MiniappCodeController(new MiniappCodeService())
    let caught: unknown
    try { await controller.create({ page: PAGE, scene: SCENE }) } catch (error) { caught = error }
    check('HTTP 200 + 41030：抛出 502 而非图片', caught instanceof HttpException && caught.getStatus() === 502 && requests.length === 1)
    const response = (caught as HttpException).getResponse() as { error: { message: string; wxErrcode: number } }
    check('41030：错误文案准确', response.error.message === MESSAGE_41030)
    check('41030：保留 wxErrcode', response.error.wxErrcode === 41030)
    check('41030：日志与错误均不泄露凭据', hasNoCredentials(JSON.stringify(response) + logs.join('\n') + (caught as Error).message))
  }, true)
}

async function validationChecks(): Promise<void> {
  // 从真实控制器的装饰器元数据取 DTO，避免复制一份校验规则导致恒绿。
  const metatype = Reflect.getMetadata('design:paramtypes', MiniappCodeController.prototype, 'create')?.[0]
  check('控制器具有真实请求 DTO 元数据', typeof metatype === 'function')
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  async function accepted(page: string, scene: string): Promise<boolean> {
    try {
      await pipe.transform({ page, scene }, { type: 'body', metatype })
      return true
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 400) return false
      throw error
    }
  }
  const expectedPages = [
    'pages/resume-build/resume-build', 'pages/resume-upload/resume-upload',
    'pages/self-explore/self-explore', 'pages/interview-entry/interview-entry',
    'pages/job-materials/job-materials', 'pages/assistant/assistant', PAGE,
  ]
  check('导出的页面名单恰好为指定七页', JSON.stringify(MINIAPP_CODE_PAGES) === JSON.stringify(expectedPages))
  for (const page of expectedPages) check(`页面校验放行 ${page}`, await accepted(page, SCENE))
  for (const page of ['pages/index/index', `${PAGE}?x=1`, `/${PAGE}`]) {
    check(`页面校验以 400 拒绝 ${page}`, !(await accepted(page, SCENE)))
  }
  check('scene 校验以 400 拒绝 33 位', !(await accepted(PAGE, 'a'.repeat(33))))
  check('scene 校验放行 k=KSK-001&to=plan', await accepted(PAGE, SCENE))
  check('scene 校验放行 24 位短码', await accepted(PAGE, 'a'.repeat(24)))
}

void (async () => {
  try {
    await versionChecks()
    await wxErrorChecks()
    await validationChecks()
    console.log(`小程序码运行时：${passCount} PASS，0 FAIL`)
  } catch (error) {
    // 失败也不输出未经筛选的异常或可能含凭据的请求内容。
    const message = error instanceof Error && hasNoCredentials(error.message) ? error.message : '异常内容已隐藏'
    console.error(`小程序码运行时：${passCount} PASS，1 FAIL：${message}`)
    process.exitCode = 1
  }
})()
