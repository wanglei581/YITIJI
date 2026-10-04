import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

/**
 * 第七批：告警副标题的终端号去重在告警门禁里测。
 * 这里核对宣传屏限额、文件预检、时长框和外链说明。限额数字从服务端源码解析，不在本文件手写。
 */
export function verifyBatch7Copy({ runFile, repoRoot, fail }) {
  const read = (file) => readFileSync(join(repoRoot, file), 'utf8')
  try {
    const mediaSrc = read('services/api/src/content/media-validation.ts')
    const contentSrc = read('services/api/src/content/content.service.ts')
    const uploadDto = read('services/api/src/content/dto/upload-ad-asset.dto.ts')
    const externalDto = read('services/api/src/content/dto/create-external-video.dto.ts')
    const updateDto = read('services/api/src/content/dto/update-ad-asset.dto.ts')
    const configDto = read('services/api/src/content/dto/save-config.dto.ts')
    const imageMb = envDefault(mediaSrc, 'AD_ASSET_MAX_IMAGE_MB')
    const videoMb = envDefault(mediaSrc, 'AD_ASSET_MAX_VIDEO_MB')
    const videoSec = envDefault(mediaSrc, 'AD_ASSET_MAX_VIDEO_SEC')
    assert.ok(/return \(Number\.isFinite\(n\) && n > 0 \? n : def\) \* 1024 \* 1024/.test(mediaSrc), '服务端图片/视频大小不再按 1024*1024 换算')
    const imageDefault = named(contentSrc, 'fallback image', /kind === 'video' \? Math\.min\(\d+, limits\.maxVideoDurationSec\) : (\d+)/)
    const videoDefault = named(contentSrc, 'fallback video', /kind === 'video' \? Math\.min\((\d+), limits\.maxVideoDurationSec\)/)
    const durationMin = constNumber(contentSrc, 'MIN_DURATION_SEC')
    const idleMin = constNumber(contentSrc, 'MIN_IDLE_TIMEOUT_SEC')
    const idleMax = constNumber(contentSrc, 'MAX_IDLE_TIMEOUT_SEC')
    const idleDefault = constNumber(contentSrc, 'DEFAULT_IDLE_TIMEOUT_SEC')
    const externalMax = constNumber(contentSrc, 'MAX_EXTERNAL_VIDEO_DURATION_SEC')
    const externalDefault = constNumber(contentSrc, 'DEFAULT_EXTERNAL_VIDEO_DURATION_SEC')
    const uploadMax = decoratorBefore(uploadDto, 'durationSec', 'Max')
    const uploadMin = decoratorBefore(uploadDto, 'durationSec', 'Min')
    const externalFieldMax = decoratorBefore(externalDto, 'durationSec', 'Max')
    const updateMax = decoratorBefore(updateDto, 'durationSec', 'Max')
    const configMax = decoratorBefore(configDto, 'idleTimeoutSec', 'Max')
    const configMin = decoratorBefore(configDto, 'idleTimeoutSec', 'Min')
    const durationMax = uploadMax
    assert.equal(externalMax, durationMax)
    assert.equal(externalFieldMax, durationMax)
    assert.equal(updateMax, durationMax)
    assert.equal(idleMax, durationMax)
    assert.equal(configMax, durationMax)
    assert.equal(uploadMin, durationMin)
    assert.equal(decoratorBefore(externalDto, 'durationSec', 'Min'), durationMin)
    assert.equal(decoratorBefore(updateDto, 'durationSec', 'Min'), durationMin)
    assert.equal(configMin, idleMin)

    const rules = runFile('apps/admin/src/routes/screensaver/assetUploadRules.ts')
    assert.equal(rules.SCREENSAVER_IMAGE_MAX_MB, imageMb)
    assert.equal(rules.SCREENSAVER_VIDEO_MAX_MB, videoMb)
    assert.equal(rules.SCREENSAVER_VIDEO_MAX_SEC, videoSec)
    assert.equal(rules.SCREENSAVER_DURATION_MIN_SEC, durationMin)
    assert.equal(rules.SCREENSAVER_DURATION_MAX_SEC, durationMax)
    assert.equal(rules.SCREENSAVER_IMAGE_DEFAULT_SEC, imageDefault)
    assert.equal(rules.SCREENSAVER_VIDEO_DEFAULT_SEC, videoDefault)
    assert.equal(rules.SCREENSAVER_EXTERNAL_DEFAULT_SEC, externalDefault)
    assert.equal(rules.SCREENSAVER_IDLE_MIN_SEC, idleMin)
    assert.equal(rules.SCREENSAVER_IDLE_MAX_SEC, idleMax)
    assert.equal(rules.SCREENSAVER_IDLE_DEFAULT_SEC, idleDefault)

    const limit = rules.screensaverUploadLimitText()
    for (const piece of ['JPG、PNG、WebP', 'MP4、WebM', `${imageMb} MB`, `${videoMb} MB`, `${videoSec} 秒`]) {
      assert.ok(limit.includes(piece), `上传限额说明与服务端不一致，缺少「${piece}」`)
    }
    const uploadHint = rules.dwellLimitHint('upload')
    const externalHint = rules.dwellLimitHint('external')
    const idleHint = rules.dwellLimitHint('idle')
    const range = (lo, hi) => `${lo}–${hi} 秒`
    assert.ok(uploadHint.includes(`图片停留 ${range(durationMin, durationMax)}，留空默认 ${imageDefault} 秒`) && uploadHint.includes(`视频停留 ${range(durationMin, videoSec)}，留空默认 ${videoDefault} 秒`), '上传时长说明与服务端范围 / 默认值不一致')
    assert.ok(externalHint.includes(range(durationMin, durationMax)) && externalHint.includes(`留空默认 ${externalDefault} 秒`), '外链时长说明与服务端范围 / 默认值不一致')
    assert.ok(idleHint.includes(range(idleMin, idleMax)) && idleHint.includes(`留空默认 ${idleDefault} 秒`), '终端无操作时长说明与服务端范围 / 默认值不一致')

    const exactImage = imageMb * 1024 * 1024
    const exactVideo = videoMb * 1024 * 1024
    assert.equal(rules.validateScreensaverUploadFile({ name: 'poster.png', type: 'image/png', size: exactImage }), null)
    assert.ok(rules.validateScreensaverUploadFile({ name: 'poster.png', type: 'image/png', size: exactImage + 1 })?.includes(`${imageMb} MB`))
    assert.equal(rules.validateScreensaverUploadFile({ name: 'clip.mp4', type: 'video/mp4', size: exactVideo }), null)
    assert.ok(rules.validateScreensaverUploadFile({ name: 'clip.mp4', type: 'video/mp4', size: exactVideo + 1 })?.includes(`${videoMb} MB`))
    for (const file of [
      { name: 'notes.txt', type: 'text/plain', size: 20 },
      { name: 'notes.txt', type: '', size: 20 },
      { name: 'notes.txt', type: 'image/png', size: 20 },
    ]) {
      const message = rules.validateScreensaverUploadFile(file)
      assert.ok(message?.includes('不支持这种文件') && message.includes('JPG、PNG、WebP'), `${file.name}/${file.type} 应被拦住`)
    }
    assert.equal(rules.uploadFormError({ name: 'notes.txt', type: 'text/plain', size: 8 }, ''), rules.validateScreensaverUploadFile({ name: 'notes.txt', type: 'text/plain', size: 8 }))
    assert.equal(rules.dwellDurationError('', 'image'), null)
    assert.equal(rules.dwellDurationError(String(durationMax), 'image'), null)
    assert.ok(rules.dwellDurationError(String(durationMax + 1), 'image')?.includes(String(durationMax)))
    assert.equal(rules.dwellDurationError(String(videoSec), 'video'), null)
    assert.ok(rules.dwellDurationError(String(videoSec + 1), 'video')?.includes(String(videoSec)))
    assert.equal(rules.dwellDurationError(String(durationMax), 'external'), null)
    assert.ok(rules.dwellDurationError(String(durationMax + 1), 'external')?.includes(String(durationMax)))
    assert.equal(rules.idleTimeoutError(''), null)
    assert.equal(rules.resolveIdleTimeoutSec(''), idleDefault)
    assert.ok(rules.idleTimeoutError(String(idleMax + 1))?.includes(String(idleMax)))
    assert.equal(rules.uploadFormError({ name: 'poster.png', type: 'image/png', size: 32 }, String(durationMax + 1))?.includes(String(durationMax)), true)

    const assets = read('apps/admin/src/routes/screensaver/AssetsTab.tsx')
    const terminals = read('apps/admin/src/routes/screensaver/TerminalsTab.tsx')
    const formState = read('apps/admin/src/routes/screensaver/terminalConfigState.ts')
    assert.ok(assets.includes('screensaverUploadLimitText()'), '上传素材卡片没有写限额')
    assert.ok(assets.includes("dwellLimitHint('upload')") && assets.includes("dwellLimitHint('external')"), '素材页两处时长框没有说明')
    assert.ok(terminals.includes("dwellLimitHint('idle')"), '终端配置的时长框没有说明')
    const uploadFn = sliceBetween(assets, 'const handleUpload', 'const handleAddExternal')
    assert.ok(uploadFn.indexOf('uploadFormError(file, duration)') >= 0 && uploadFn.indexOf('uploadFormError(file, duration)') < uploadFn.indexOf('screensaverService.uploadAsset'), '选了不合规文件仍会发上传请求')
    assert.match(uploadFn, /if \(problem\) \{[\s\S]*?return/)
    const externalFn = sliceBetween(assets, 'const handleAddExternal', 'const toggleStatus')
    assert.ok(externalFn.indexOf('dwellDurationError(extDuration, \'external\')') >= 0 && externalFn.indexOf('dwellDurationError(extDuration, \'external\')') < externalFn.indexOf('screensaverService.createExternalVideo'), '外链时长超限仍会提交')
    const saveFn = terminals.slice(terminals.indexOf('const save = useCallback'))
    assert.ok(saveFn.indexOf('idleTimeoutError(timeout)') >= 0 && saveFn.indexOf('idleTimeoutError(timeout)') < saveFn.indexOf('saveScreensaverTerminalForm('), '终端时长超限仍会提交')
    assert.ok(formState.includes('resolveIdleTimeoutSec(timeout)') && !/Math\.(min|max)\(/.test(formState), '终端时长不再静默夹到上限')
    assert.ok(!/HTTPS|iframe|直链/.test(rules.externalVideoHelp), '外链说明仍有 HTTPS / iframe / 直链')
    assert.match(rules.externalVideoTechNote, /HTTPS/)
    assert.match(rules.externalVideoTechNote, /iframe/)
    assert.match(rules.externalVideoTechNote, /直链/)
    assert.ok(assets.includes('{externalVideoHelp}') && assets.includes('title={externalVideoTechNote}'), '外链说明或技术说明悬停没有挂上')
    assert.ok(!/HTTPS|iframe|直链/.test(assets), '外链术语出现在页面正文里')
    const notice = read('apps/admin/src/routes/screensaver/AssetUploadNotice.tsx')
    for (const phrase of [
      '上传前请先看',
      '不要上传：招聘简章；写了用人单位和岗位、人数、薪资、条件或报名方式的图片或视频；列出企业或岗位的招聘会海报；企业或商业招聘网站的二维码。',
      '可以上传：机构介绍和服务时间；就业政策和补贴宣传；不指向具体单位和岗位的讲座、培训通知；本机使用指引。',
      '拿不准的先不放：只写时间地点的招聘会预告；机构招聘自己工作人员的公告；人才引进政策里附带的岗位表。',
      '图片和视频里的招聘信息，同样算发布招聘信息。',
    ]) {
      assert.ok(notice.includes(phrase), `「上传前请先看」原文变了：${phrase}`)
    }
    assert.ok(assets.indexOf('<AssetUploadNotice') >= 0 && assets.indexOf('<AssetUploadNotice') < assets.indexOf('>上传素材</h3>'), '「上传前请先看」不在上传卡片前面')
  } catch (error) {
    fail(error instanceof Error ? error.stack ?? error.message : String(error))
  }
}

function envDefault(source, key) {
  const matched = source.match(new RegExp(`process\\.env\\['${key}'\\],\\s*(\\d+)`))
  if (!matched) throw new Error(`解析不到 ${key} 的默认值`)
  return Number(matched[1])
}

function constNumber(source, name) {
  const matched = source.match(new RegExp(`const ${name} = (\\d+)`))
  if (!matched) throw new Error(`解析不到 ${name}`)
  return Number(matched[1])
}

function named(source, label, pattern) {
  const matched = source.match(pattern)
  if (!matched) throw new Error(`解析不到 ${label}`)
  return Number(matched[1])
}

function decoratorBefore(source, field, name) {
  const at = source.indexOf(field)
  if (at < 0) throw new Error(`找不到字段 ${field}`)
  const matched = [...source.slice(0, at).matchAll(new RegExp(`@${name}\\((\\d+)\\)`, 'g'))]
  if (matched.length === 0) throw new Error(`${field} 前面没有 @${name}`)
  return Number(matched.at(-1)[1])
}

function sliceBetween(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  if (from < 0 || to < 0) throw new Error(`找不到 ${start} … ${end}`)
  return source.slice(from, to)
}
