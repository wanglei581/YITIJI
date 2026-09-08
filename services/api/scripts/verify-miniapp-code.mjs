#!/usr/bin/env node
/**
 * verify:miniapp-code —— 小程序码生成的行为与红线。
 *
 * 背景：产品负责人 2026-09-08 明确「整个项目操作和小程序都是相关联的」，
 * 一体机的二维码应当**扫码直达小程序**而不是打开网页 —— 网页是第三个入口，
 * 会把用户从主入口踢出去并丢掉小程序登录态。
 *
 * 本门禁钉住三件事：
 * ① **fail-closed**：任何失败都不得回落到网页链接（那是伪造能力，CLAUDE.md §9）；
 * ② **不泄密**：日志与错误响应不得出现 AppSecret / access_token；
 * ③ **判成功看魔数不看状态码**：微信失败时也返回 HTTP 200 + JSON
 *    （2026-09-08 实测 errcode 41030 就是 200），只看状态码会把错误当成图片。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../src/miniapp-code')
const service = readFileSync(resolve(root, 'miniapp-code.service.ts'), 'utf8')
const controller = readFileSync(resolve(root, 'miniapp-code.controller.ts'), 'utf8')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}

// ── 一、fail-closed：不得回落到网页 ─────────────────────────────────────
check(
  '未配置凭据时抛错而不是回落',
  /MINIAPP_NOT_CONFIGURED/.test(service) && /if \(!this\.isConfigured\(\)\)/.test(service),
  '未配置时必须明确拒绝',
)
check(
  '源码中不存在任何 http(s) 网页回落地址',
  !/https?:\/\/(?!api\.weixin\.qq\.com)/.test(service.replace(/^\s*\*.*$/gm, '')),
  '除微信接口外不得出现任何 URL —— 出现即可能是网页回落',
)
check(
  '微信报错时抛 HttpException 而不是返回空/占位',
  /throw new HttpException\(\s*\{\s*error:\s*\{\s*code:\s*'MINIAPP_CODE_FAILED'/.test(service),
)

// ── 二、判成功必须看 PNG 魔数（微信失败也是 HTTP 200）─────────────────
// ⚠️ 本条第一版写的是「按 PNG 魔数判定」—— 那是照着实现的**假设**写的断言，
// 而实测微信返回的是 JPEG（FF D8 FF）。断言忠实地钉住了错误假设，变异测试也拦不住，
// 因为变异是围绕这条断言做的。改成钉「JPEG 与 PNG 都认」+「MIME 随实际返回」。
check(
  'JPEG 与 PNG 两种魔数都认',
  /0xff && body\[1\] === 0xd8/.test(service) && /0x89 && body\[1\] === 0x50/.test(service),
  '微信当前返回 JPEG；只认 PNG 会把每一次成功都当成失败',
)
check(
  'MIME 由实际字节推导，不写死',
  /mimeType:\s*'image\/jpeg'\s*\|\s*'image\/png'/.test(service) && /const mimeType = imageMime\(body\)/.test(service),
  '写死 image/png 会让前端拼出错误的 data URI',
)
check(
  '不是图片就走错误分支（不看 HTTP 状态码）',
  /if \(mimeType\) return/.test(service) && !/if \(response\.ok\) return/.test(service),
  '微信失败时也是 HTTP 200，只看状态码会把错误 JSON 当图片下发',
)
check(
  '解析失败分支存在（非图片即当作错误）',
  /parseWxError/.test(service) && service.indexOf('imageMime(body)') < service.indexOf('parseWxError'),
  '图片判定必须在错误解析之前，且两条路径都要有',
)

// ── 三、不泄密 ────────────────────────────────────────────────────────
{
  const logLines = service.split('\n').filter((l) => /logger\.(warn|log|error|debug)/.test(l))
  const leaks = logLines.filter((l) => /secret|access_?token|appsecret/i.test(l) && !/errcode/i.test(l))
  check('日志不打印密钥或 access_token', leaks.length === 0, leaks.join(' | '))
}
check(
  '错误响应体不含 token/secret 字段',
  !/error:\s*\{[^}]*(secret|accessToken|access_token)/i.test(service),
)

// ── 四、token 必须缓存（微信有频次限制）───────────────────────────────
// 只查名字出现过是不够的：删掉字段声明后，其余位置的 this.cachedToken 仍会命中，
// 断言照样绿（2026-09-08 变异测试实测漏过）。要钉**声明**与**命中即返回**两处行为。
check(
  'access_token 有缓存字段',
  /private\s+cachedToken:\s*\{[^}]*expiresAt:\s*number[^}]*\}\s*\|\s*null/.test(service),
  '缺少缓存字段声明',
)
check(
  '缓存命中时直接返回，不再打微信',
  /const cached = this\.cachedToken[\s\S]{0,120}?return cached\.value/.test(service),
  '有字段但每次仍去换 token，等于没缓存',
)
check(
  '缓存留了提前量，不卡在边界',
  /TOKEN_SAFETY_MARGIN_MS/.test(service),
  '按 expires_in 原值缓存会在边界上用到刚失效的 token',
)
check(
  '并发换取共享同一次请求',
  /tokenInflight/.test(service),
  '并发打微信换 token 会触发频控',
)

// ── 五、入参约束（微信对 scene 有硬限制）──────────────────────────────
check('scene 长度与字符集受限', /SCENE_MAX_LENGTH/.test(service) && /SCENE_PATTERN/.test(service))
check(
  'page 只允许 pages/ 路径',
  // 源码里的正则字面量是 `^pages\/...`（斜杠被转义），断言必须照实匹配，
  // 写成 `^pages/` 会永远不命中 —— 2026-09-08 第一次就写错了。
  controller.includes('^pages\\/'),
  '任意 page 会被微信 check_path 拒，且可能被用来探测小程序结构',
)
check('生成接口有限流', /@Throttle\(/.test(controller))

// ── 六、能力探测端点存在（一体机据此显示诚实状态）─────────────────────
check(
  '有 capabilities 端点',
  /capabilities\(\)/.test(controller) && /available/.test(controller),
  '没有它，一体机只能靠请求失败来猜，用户会先看到坏二维码',
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? '✅ ALL PASS' : `❌ ${failed.length} 项失败`} — 小程序码生成`)
process.exit(failed.length === 0 ? 0 : 1)
