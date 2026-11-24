/**
 * 求职材料轻工具箱（pages/print-toolbox + utils/material-canvas）
 * 与简历高定排版预设（utils/resume-style-presets + resume-build / resume-optimize）单测：
 * - 纯画布几何计算（A4 比例、正反槽位不重叠、一寸 8 张 / 二寸 4 张证件照参考拼版、斜向水印网格、文件名）
 * - 工具箱隐私/会话隔离（未登录拦截不上传、退出/换号清敏感图且丢弃迟到上传回调、缺失 fileId 不跳转）
 * - 工具箱合规边界（绝不调用未声明相册写入 API，绝不出现夸大安全/已打印文案）
 * - 简历 3 套高定排版预设严格输出整数 columns (1 | 2)，PDF 导出实发 layout，非 PDF 导出省略 layout
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { deferred, flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
const canvasMath = requireMiniapp('./material-canvas.js')
const presets = requireMiniapp('./resume-style-presets.js')

test('material-canvas：单图水印画布尺寸、contain/cover 裁切与 A4 正反槽位', () => {
  const s1 = canvasMath.computeSingleCanvasSize(3200, 1600)
  assert.deepEqual(s1, { width: 1600, height: 800 })
  const s2 = canvasMath.computeSingleCanvasSize(800, 600)
  assert.deepEqual(s2, { width: 800, height: 600 })

  const contained = canvasMath.computeContainRect(2000, 1000, 100, 200, 800, 600)
  assert.equal(contained.w, 800)
  assert.equal(contained.h, 400)
  assert.equal(contained.x, 100)
  assert.equal(contained.y, 300)

  const cropWide = canvasMath.computeCoverCrop(1000, 500, 250, 350)
  assert.equal(cropWide.sy, 0)
  assert.equal(cropWide.sh, 500)
  assert.ok(cropWide.sx > 0 && cropWide.sw < 1000)

  const slots = canvasMath.computeDuplexSlots()
  assert.equal(slots.width, canvasMath.A4_WIDTH)
  assert.equal(slots.height, canvasMath.A4_HEIGHT)
  assert.ok(slots.front.y + slots.front.h < slots.back.y, '正反槽位不得重叠')
  assert.ok(slots.back.y + slots.back.h < slots.height, '底边距需留白')
})

test('material-canvas：一寸 8 张 / 二寸 4 张参考拼版与斜向水印网格', () => {
  const g1 = canvasMath.computePhotoGrid('one_inch')
  assert.equal(g1.cells.length, 8)
  for (const c of g1.cells) {
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= g1.width && c.y + c.h <= g1.height)
  }

  const g2 = canvasMath.computePhotoGrid('two_inch')
  assert.equal(g2.cells.length, 4)
  for (const c of g2.cells) {
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= g2.width && c.y + c.h <= g2.height)
  }

  const emptyWm = canvasMath.computeWatermarkSpec(1240, 1754, '   \n\t ')
  assert.equal(emptyWm.points.length, 0)

  const wm = canvasMath.computeWatermarkSpec(1240, 1754, '  仅供入职审核使用  ')
  assert.equal(wm.text, '仅供入职审核使用')
  assert.ok(wm.points.length > 0 && wm.fontSize >= 22 && wm.angleRad < 0)

  const d = new Date(2026, 10, 25)
  assert.equal(canvasMath.safeExportFilename('watermark', 'one_inch', d), '用途水印材料_20261125.jpg')
  assert.equal(canvasMath.safeExportFilename('duplex', 'one_inch', d), '正反合一A4_20261125.jpg')
  assert.equal(canvasMath.safeExportFilename('photo', 'one_inch', d), '一寸照A4拼版_20261125.jpg')
  assert.equal(canvasMath.safeExportFilename('photo', 'two_inch', d), '二寸照A4拼版_20261125.jpg')
})

function setupToolbox({ user = { id: 'u-a' }, apiOverrides = {}, wxOverrides = {} } = {}) {
  let currentUser = user
  const listeners = new Set()
  const calls = { upload: [], nav: [], toast: [], modal: [], chooseMedia: [] }

  const auth = {
    isLoggedIn: () => Boolean(currentUser),
    getUser: () => currentUser,
    subscribeSessionChange(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    _switchUser(nextUser) {
      currentUser = nextUser
      listeners.forEach((fn) => fn({ reason: nextUser ? 'switch' : 'logout' }))
    },
  }

  const api = {
    uploadPrintFile: (filePath, filename) => {
      calls.upload.push({ filePath, filename })
      return Promise.resolve({ fileId: 'file-mat-1', filename })
    },
    ...apiOverrides,
  }

  const wx = {
    navigateTo: (o) => calls.nav.push(o.url),
    switchTab: (o) => calls.nav.push(o.url),
    navigateBack: () => {},
    showToast: (o) => calls.toast.push(o.title),
    showModal: (o) => calls.modal.push(o),
    showLoading: () => {},
    hideLoading: () => {},
    chooseMedia: (o) => calls.chooseMedia.push(o),
    createSelectorQuery: () => ({
      in() { return this },
      select() { return this },
      fields() { return this },
      exec(cb) { cb([null]) },
    }),
    ...wxOverrides,
  }

  const def = loadPageDefinition('pages/print-toolbox/print-toolbox.js', {
    wx,
    modules: { auth, api },
  })
  const page = instantiate(def)
  page.onLoad({})
  page.onShow()
  return { page, calls, auth }
}

test('print-toolbox：未登录点上传只弹登录引导，不发上传请求', async () => {
  const { page, calls } = setupToolbox({ user: null })
  page.setData({ previewPath: 'wxfile://tmp/out.jpg' })
  page.tapUploadToPrint()
  await flush()
  assert.equal(calls.upload.length, 0)
  assert.equal(calls.modal.length, 1)
  assert.match(calls.modal[0].title, /需要登录/)
})

test('print-toolbox：已登录上传成功后跳 print-upload；缺 fileId 不跳转', async () => {
  const { page, calls } = setupToolbox({ user: { id: 'u-1' } })
  page.setData({ activeTool: 'duplex', previewPath: 'wxfile://tmp/duplex.jpg' })
  await page.tapUploadToPrint()
  assert.equal(calls.upload.length, 1)
  assert.match(calls.upload[0].filename, /^正反合一A4_\d{8}\.jpg$/)
  assert.equal(calls.nav.length, 1)
  assert.match(calls.nav[0], /^\/pages\/print-upload\/print-upload\?fileId=file-mat-1&name=/)

  const bad = setupToolbox({
    user: { id: 'u-1' },
    apiOverrides: { uploadPrintFile: () => Promise.resolve({ filename: 'x.jpg' }) },
  })
  bad.page.setData({ previewPath: 'wxfile://tmp/x.jpg' })
  await bad.page.tapUploadToPrint()
  assert.equal(bad.calls.nav.length, 0)
  assert.ok(bad.calls.toast.some((t) => /文件编号/.test(t)))
})

test('print-toolbox：切换账号或退出登录时立即清空敏感预览并丢弃迟到上传回调', async () => {
  const pending = deferred()
  const { page, calls, auth } = setupToolbox({
    user: { id: 'u-a' },
    apiOverrides: { uploadPrintFile: () => pending.promise },
  })
  page.setData({
    frontPath: 'wxfile://tmp/id-front.jpg',
    backPath: 'wxfile://tmp/id-back.jpg',
    previewPath: 'wxfile://tmp/id-out.jpg',
  })
  const uploadPromise = page.tapUploadToPrint()

  auth._switchUser({ id: 'u-b' })
  assert.equal(page.data.frontPath, '')
  assert.equal(page.data.backPath, '')
  assert.equal(page.data.previewPath, '')
  assert.equal(page.data.uploading, false)

  pending.resolve({ fileId: 'stale-file', filename: 'stale.jpg' })
  await uploadPromise
  await flush()
  assert.equal(calls.nav.length, 0, '迟到的旧账号上传响应不得触发新账号跳转')
})

test('print-toolbox：清空图片或退出后同号重登，迟到的选图回调一律丢弃不恢复敏感图', async () => {
  const { page, calls, auth } = setupToolbox({ user: { id: 'u-a' } })
  page.chooseSlot({ currentTarget: { dataset: { slot: 'front' } } })
  page.chooseSlot({ currentTarget: { dataset: { slot: 'back' } } })
  assert.equal(calls.chooseMedia.length, 2)

  // 1) 手动清空后迟到回调不得写回
  page.tapClearImages()
  calls.chooseMedia[0].success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/late-front.jpg' }] })
  calls.chooseMedia[1].success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/late-back.jpg' }] })
  await flush()
  assert.equal(page.data.frontPath, '')
  assert.equal(page.data.backPath, '')

  // 2) 退出再以同一账号登录，迟到的选图回调同样作废
  page.chooseSlot({ currentTarget: { dataset: { slot: 'front' } } })
  auth._switchUser(null)
  auth._switchUser({ id: 'u-a' })
  calls.chooseMedia[2].success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/relogin-late.jpg' }] })
  await flush()
  assert.equal(page.data.frontPath, '')
})

test('print-toolbox：重绘失败或修改水印文字后立即清空旧预览，绝不上传过期成图', async () => {
  const { page, calls } = setupToolbox({ user: { id: 'u-a' } })
  page.setData({
    frontPath: 'wxfile://tmp/src.jpg',
    previewPath: 'wxfile://tmp/old-preview.jpg',
  })

  // 1) 修改水印文字立即作废旧预览
  page.onWatermarkInput({ detail: { value: '仅供新公司入职使用' } })
  assert.equal(page.data.previewPath, '')
  page.tapUploadToPrint()
  assert.equal(calls.upload.length, 0)

  // 2) 已有旧预览时触发重绘失败，必须清空旧 previewPath 且阻止上传
  page.setData({ previewPath: 'wxfile://tmp/stale-before-fail.jpg', renderError: '' })
  await page._renderPreview()
  await flush()
  assert.equal(page.data.previewPath, '')
  assert.ok(page.data.renderError.length > 0)
  page.tapUploadToPrint()
  assert.equal(calls.upload.length, 0, '重绘失败后不得上传旧预览')
})

test('print-toolbox：隐私 API 与诚实文案静态守卫', () => {
  const jsSrc = fs.readFileSync(path.join(MINIAPP, 'pages/print-toolbox/print-toolbox.js'), 'utf8')
  const wxmlSrc = fs.readFileSync(path.join(MINIAPP, 'pages/print-toolbox/print-toolbox.wxml'), 'utf8')
  const joined = `${jsSrc}\n${wxmlSrc}`
  assert.equal(/saveImageToPhotosAlbum|writePhotosAlbum/.test(joined), false, '禁止调用未声明的相册写入权限')
  for (const banned of ['隐私已保护', '防止盗用', '全程仅本机处理', '已打印']) {
    assert.equal(joined.includes(banned), false, `禁止夸大或误导文案: ${banned}`)
  }
})

test('resume-style-presets：3 套预设严格输出整数 columns 与合法枚举', () => {
  assert.equal(presets.PRESETS.length, 3)
  for (const p of presets.PRESETS) {
    const out = presets.applyPreset(p.key)
    assert.equal(typeof out.columns, 'number')
    assert.ok(out.columns === 1 || out.columns === 2)
    assert.equal(presets.matchPresetKey(out), p.key)
  }
  const cloned = presets.cloneLayout({ columns: '2', accent: 'invalid' })
  assert.strictEqual(cloned.columns, 2)
  assert.equal(cloned.accent, 'blue')
})

test('resume-build：切换高定排版预设后 PDF 导出实传 layout，非 PDF 导出省略 layout', async () => {
  const exportBodies = []
  const auth = { isLoggedIn: () => true, getUser: () => ({ id: 'u-1' }) }
  const api = {
    exportGeneratedResume: (body) => {
      exportBodies.push(body)
      return Promise.resolve({ fileId: 'f-1', filename: 'resume.pdf' })
    },
  }
  const wx = {
    navigateTo: () => {},
    showToast: () => {},
    showModal: () => {},
    showLoading: () => {},
    hideLoading: () => {},
    pageScrollTo: () => {},
  }
  const def = loadPageDefinition('pages/resume-build/resume-build.js', {
    wx,
    modules: { auth, api },
  })
  const page = instantiate(def)
  page.onLoad({})
  page._resumeRaw = {
    basic: { name: '林清晏' },
    intention: { position: '产品经理' },
    summary: '3 年 B 端产品经验',
    education: [],
    experience: [],
    projects: [],
    skills: ['需求分析'],
    certificates: [],
  }

  page.pickStylePreset({ currentTarget: { dataset: { key: 'campus' } } })
  assert.equal(page.data.layout.columns, 2)
  assert.equal(page.data.layout.accent, 'green')

  page.tapExport()
  await flush()
  assert.equal(exportBodies.length, 1)
  assert.strictEqual(exportBodies[0].format, 'pdf')
  assert.strictEqual(exportBodies[0].layout.columns, 2)
  assert.equal(exportBodies[0].layout.accent, 'green')
  assert.equal(exportBodies[0].layout.margin, 'narrow')

  page.pickOption({ currentTarget: { dataset: { opt: 'format', val: 'docx' } } })
  page.pickStylePreset({ currentTarget: { dataset: { key: 'state' } } })
  assert.equal(page.data.layout.accent, 'green', '非 PDF 格式点预设不应改变状态')

  page.tapExport()
  await flush()
  assert.equal(exportBodies.length, 2)
  assert.equal(exportBodies[1].format, 'docx')
  assert.equal('layout' in exportBodies[1], false, '非 PDF 导出不得传 layout')
})

test('resume-optimize：切换高定排版预设后 PDF 导出实传 layout，非 PDF 导出省略 layout', async () => {
  const exportBodies = []
  const api = {
    exportGeneratedResume: (body) => {
      exportBodies.push(body)
      return Promise.resolve({
        fileId: 'f-opt-1',
        filename: 'opt.pdf',
        printFileUrl: '/api/v1/files/f-opt-1/download?sig=x',
        mimeType: 'application/pdf',
        pageCount: 1,
        sizeBytes: 12000,
      })
    },
    getFilePreviewUrl: () => Promise.resolve({ url: '' }),
    listResumeExportVersions: () => Promise.resolve({ items: [] }),
  }
  const wx = {
    navigateTo: () => {},
    showToast: () => {},
    showModal: () => {},
    showLoading: () => {},
    hideLoading: () => {},
    downloadFile: () => {},
    openDocument: () => {},
    getStorageSync: () => null,
    setStorageSync: () => {},
    removeStorageSync: () => {},
  }
  const def = loadPageDefinition('pages/resume-optimize/resume-optimize.js', {
    wx,
    modules: { api },
  })
  const page = instantiate(def)
  page.setData({
    taskId: 'task-1',
    format: 'pdf',
    opt: {
      optimizedResume: {
        basic: { name: '周明远' },
        intention: { position: '后端开发' },
        summary: '熟悉分布式系统',
        education: [],
        experience: [],
        projects: [],
        skills: ['TypeScript'],
        certificates: [],
      },
    },
  })

  page.pickStylePreset({ currentTarget: { dataset: { key: 'state' } } })
  assert.equal(page.data.layoutPresetKey, 'state')
  page._doExport('2026-11-25T00:00:00.000Z')
  await flush()

  assert.equal(exportBodies.length, 1)
  assert.equal(exportBodies[0].format, 'pdf')
  assert.strictEqual(exportBodies[0].layout.columns, 1)
  assert.equal(exportBodies[0].layout.accent, 'blue')
  assert.equal(exportBodies[0].layout.fontScale, 'large')
  assert.equal(exportBodies[0].layout.lineSpacing, 'relaxed')
  assert.equal(exportBodies[0].layout.margin, 'wide')

  page.setData({ format: 'docx', exporting: false })
  page._doExport('2026-11-25T00:00:00.000Z')
  await flush()
  assert.equal(exportBodies.length, 2)
  assert.equal(exportBodies[1].format, 'docx')
  assert.equal('layout' in exportBodies[1], false, '非 PDF 优化导出不得传 layout')
})
