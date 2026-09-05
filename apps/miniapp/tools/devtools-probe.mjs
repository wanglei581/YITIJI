#!/usr/bin/env node
/**
 * 微信开发者工具自动化探针。**不是门禁**——它需要开发者工具在本机运行，
 * 所以不进 CI、不挂 verify:static 链；它是「人要看一眼」时的替代手段。
 *
 * **为什么放在 tools/ 而不是 scripts/**：verify-ci-gate-coverage.mjs 按**路径**枚举
 * 门禁脚本（apps 下各端的 scripts 目录里的 .mjs），**不看文件名**——放进 scripts/ 就会被算成
 * 「注意：这里刻意不写那个 glob 的字面形式——它含有 星号+斜杠，会提前闭合本块注释。」
 * 「未接线门禁」，把 MAX_UNWIRED 1/1 顶破、CI 直接红。豁免表的合法类别只有
 * broken-pending-deletion / broken-pending-fix，探针两头都不沾，不能登记，
 * 也不该为它抬上限或强行起一个 verify:* 名（那会让它进 CI，而 CI 上没有开发者工具）。
 *
 * 为什么值得留在仓库里：2026-09-03 这一轮用它抓出 15 处版式缺陷，
 * **没有一处是 111 条静态门禁报的，也没有一处目测能发现**。
 * 静态门禁覆盖逻辑、合规文案、数据契约；能不能显示出来它一概不知道。
 *
 * 用法：
 *   node tools/devtools-probe.mjs --route /pages/store-select/store-select \
 *     --data '{"loading":false,"stores":[...]}' --shot /tmp/a.png \
 *     --measure '.actionbar .btn'
 *
 * ── 踩过的坑，别再踩一遍 ────────────────────────────────────────
 * 1. `cli auto` 执行完就退出，端口随之关闭。必须让它和探针在**同一个进程组**里活着，
 *    或常驻后台；分两次调用会连不上。
 * 2. `page.setData()` 在这个 automator/开发者工具组合下**挂死超时**。
 *    改用 `evaluate` 里 `getCurrentPages()` 拿页面实例再 setData。
 * 3. `screenshot()` **抓不到 canvas 原生层**——WXML 能截到，画布内容截不到。
 *    验画布用 `getImageData()` 数非空像素（机器可断言），或 `toDataURL()` 直接导出。
 * 4. `cli auto` 会附到**已经开着的窗口**。若 IDE 里开着别的项目，自动化连的是那个，
 *    路由全部报 `getPageMetaByWebviewId is null`。看 auto 日志里的 `✔ Using AppID:` 确认。
 * 5. 模拟器**改不了宽度**。验窄屏规则的办法是临时把 `@media` 断点改宽、量完复原。
 * 6. 注入数据要按页面**真实的 data 形状**。self-explore 的雷达读的是 `result.dims`
 *    不是顶层 `dims`，灌错位置会静默不画，还以为是产品 bug。
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import net from 'node:net'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i > -1 ? process.argv[i + 1] : fallback
}

const portOpen = (p) => new Promise((res) => {
  const s = net.connect(p, '127.0.0.1')
  s.on('connect', () => { s.destroy(); res(true) })
  s.on('error', () => res(false))
})

async function main() {
  const route = arg('route')
  if (!route) {
    console.error('用法: --route /pages/x/x [--data <json>] [--shot <png>] [--measure <selector>] [--canvas <id>]')
    process.exit(2)
  }
  let automator
  try {
    // miniprogram-automator 是 CommonJS（main: ./out/index，无扩展名），
    // ESM 的裸 import 和 NODE_PATH 都解析不到它。用 createRequire 走 CJS 解析：
    // MP_AUTOMATOR 给安装目录（含 package.json 的那层）即可，不必猜入口文件。
    const require_ = createRequire(import.meta.url)
    const spec = process.env.MP_AUTOMATOR || 'miniprogram-automator'
    automator = require_(spec)
    automator = automator.default || automator
  } catch {
    console.error('缺 miniprogram-automator。它是**开发期工具**，不要装进 apps/miniapp')
    console.error('（package.json 的 dependencies 必须保持为空，有静态门禁盯着）。')
    console.error('装到别处再用 NODE_PATH 指过来，例如：')
    console.error('  mkdir -p /tmp/mp && cd /tmp/mp && npm i miniprogram-automator')
    console.error('  MP_AUTOMATOR=/tmp/mp/node_modules/miniprogram-automator \\')
    console.error('    node tools/devtools-probe.mjs --route /pages/x/x')
    process.exit(2)
  }

  const port = Number(arg('port', '9500'))
  const child = spawn(CLI, ['auto', '--project', ROOT, '--auto-port', String(port)],
    { stdio: 'ignore', detached: false })

  try {
    for (let i = 0; i < 24 && !(await portOpen(port)); i += 1) await sleep(5000)
    if (!(await portOpen(port))) throw new Error(`端口 ${port} 未就绪，开发者工具起来了吗？`)
    await sleep(8000)

    const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` })
    await sleep(3000)
    await mp.reLaunch(route)
    await sleep(3500)

    const data = arg('data')
    if (data) {
      const r = await mp.evaluate((payload) => {
        const ps = getCurrentPages()
        const p = ps[ps.length - 1]
        if (!p) return { ok: false, why: 'no page' }
        p.setData(JSON.parse(payload))   // 走 evaluate，不用 page.setData（坑 2）
        return { ok: true, route: p.route }
      }, data)
      console.log('inject:', JSON.stringify(r))
      await sleep(2500)
    }

    const sel = arg('measure')
    if (sel) {
      const m = await mp.evaluate((s) => new Promise((res) => {
        const q = wx.createSelectorQuery()
        q.selectAll(s).boundingClientRect()
        q.exec((r) => {
          const info = wx.getWindowInfo ? wx.getWindowInfo() : {}
          res({
            W: info.windowWidth, H: info.windowHeight,
            boxes: (r[0] || []).map((b) => ({
              l: Math.round(b.left), r: Math.round(b.right),
              w: Math.round(b.width), h: Math.round(b.height),
            })),
          })
        })
      }), sel)
      console.log('measure:', JSON.stringify(m))
      // 溢出断言：任何盒子右缘超出视口即失败
      const over = (m.boxes || []).filter((b) => b.r > m.W)
      if (over.length) {
        console.error(`FAIL: ${over.length} 个盒子右缘超出视口 ${m.W}`)
        process.exitCode = 1
      }
    }

    const canvasId = arg('canvas')
    if (canvasId) {
      // 画布验证不能靠截图（坑 3）
      const px = await mp.evaluate((id) => new Promise((res) => {
        wx.createSelectorQuery().select('#' + id).fields({ node: true }).exec((r) => {
          const n = r && r[0] && r[0].node
          if (!n) return res({ probe: 'no node' })
          try {
            const d = n.getContext('2d').getImageData(0, 0, n.width, n.height).data
            let nonBlank = 0
            for (let i = 3; i < d.length; i += 4) if (d[i] > 8) nonBlank += 1
            res({ probe: 'ok', w: n.width, h: n.height, nonBlankPct: Math.round(nonBlank / (d.length / 4) * 1000) / 10 })
          } catch (e) { res({ probe: 'err:' + e.message }) }
        })
      }), canvasId)
      console.log('canvas:', JSON.stringify(px))
      if (px.probe === 'ok' && px.nonBlankPct < 1) {
        console.error('FAIL: 画布几乎全空，绘制没生效')
        process.exitCode = 1
      }
    }

    // --capsule：把选择器命中的盒子和微信胶囊做相交判定。
    // 胶囊是系统绘制的，压在页面之上；自定义顶栏的右侧按钮若落进它的矩形，
    // 用户点不到——而这在模拟器截图上**看起来完全正常**（胶囊是另一层）。
    // app.js 已经在用同一个 API 算导航栏高度，仓内有先例。
    const capsuleSel = arg('capsule')
    if (capsuleSel) {
      const cap = await mp.evaluate((s) => new Promise((res) => {
        const c = wx.getMenuButtonBoundingClientRect()
        wx.createSelectorQuery().selectAll(s).boundingClientRect((r) => {
          res({ capsule: { l: c.left, r: c.right, t: c.top, b: c.bottom }, boxes: r || [] })
        }).exec()
      }), capsuleSel)
      const c = cap.capsule
      const hit = (cap.boxes || []).filter((b) =>
        b.left < c.r && b.right > c.l && b.top < c.b && b.bottom > c.t)
      console.log('capsule:', JSON.stringify({
        capsule: { l: Math.round(c.l), r: Math.round(c.r), t: Math.round(c.t), b: Math.round(c.b) },
        boxes: (cap.boxes || []).map((b) => ({
          l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) })),
        overlapping: hit.length,
      }))
      if (hit.length) {
        console.error(`FAIL: ${hit.length} 个可点元素与微信胶囊重叠，用户点不到`)
        process.exitCode = 1
      }
    }

    const shot = arg('shot')
    if (shot) {
      await mp.screenshot({ path: path.resolve(shot) })
      console.log('shot:', shot, '（注意：canvas 原生层不会出现在截图里，见坑 3）')
    }

    await mp.disconnect()
  } finally {
    try { child.kill() } catch { /* 已退出 */ }
  }
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1) })
