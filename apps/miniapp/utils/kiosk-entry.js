// 定向入口只读取公开终端编号与办理意图；终端编号只用于本机比对。
const storage = require('./storage')
const TERMINAL_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/
const TTL = 12 * 60 * 60 * 1000
const ENTRY_PAGES = [
  'pages/resume-build/resume-build',
  'pages/resume-upload/resume-upload',
  'pages/self-explore/self-explore',
  'pages/interview-entry/interview-entry',
  'pages/job-materials/job-materials',
  'pages/assistant/assistant',
]

function validTerminal(value) {
  if (typeof value !== 'string') return ''
  const match = value.match(TERMINAL_RE)
  return match && match[0] === value ? value : ''
}

function validTo(value) {
  return ['opt', 'fit', 'plan'].indexOf(value) >= 0 ? value : ''
}

function parseFields(text) {
  const result = { terminalCode: '', to: '' }
  for (const field of text.split('&')) {
    const equal = field.indexOf('=')
    const key = field.slice(0, equal)
    if (equal < 0 || (key !== 'k' && key !== 'to')) continue
    const value = field.slice(equal + 1)
    if (key === 'k') result.terminalCode = validTerminal(value)
    else result.to = validTo(value)
  }
  return result
}

function parseEntryScene(raw) {
  try {
    return typeof raw === 'string' ? parseFields(decodeURIComponent(raw)) : parseFields('')
  } catch (_) {
    return parseFields('')
  }
}

function absorb(options) {
  const opts = options || {}
  const result = parseEntryScene(opts.scene)
  if (typeof opts.q === 'string') {
    try {
      const url = decodeURIComponent(opts.q)
      const queryAt = url.indexOf('?')
      const query = queryAt < 0 ? '' : url.slice(queryAt + 1).split('#')[0]
      const fromUrl = parseFields(query)
      if (!result.terminalCode) result.terminalCode = fromUrl.terminalCode
      if (!result.to) result.to = fromUrl.to
    } catch (_) {}
  }
  // 页内「去上传简历」使用普通页面参数，仍只接受同一份意图白名单。
  if (!result.to) result.to = validTo(opts.to)
  if (result.terminalCode) {
    storage.set(storage.KEYS.KIOSK_ENTRY, { terminalCode: result.terminalCode, ts: Date.now() })
  }
  return result
}

function recallTerminal(now = Date.now()) {
  const saved = storage.get(storage.KEYS.KIOSK_ENTRY)
  if (!saved) return ''
  const terminalCode = validTerminal(saved.terminalCode)
  const age = now - saved.ts
  if (terminalCode && Number.isFinite(saved.ts) && Number.isFinite(now) && age >= 0 && age < TTL) {
    return terminalCode
  }
  storage.remove(storage.KEYS.KIOSK_ENTRY)
  return ''
}

function parseEntryCodePath(path) {
  if (typeof path !== 'string' || !path) return { kind: 'invalid' }
  const cut = path.search(/[?#]/)
  const page = (cut < 0 ? path : path.slice(0, cut)).replace(/^\//, '')
  if (ENTRY_PAGES.indexOf(page) < 0) return { kind: 'invalid' }
  // 扫码结果里的 scene 可能编过码，也可能没编（那样 & 后面的一项会散成并列参数）：
  // 两种都逐项重读，只把认得的两项重新拼好带过去；读不出来就照常进页，只是不带。
  const query = cut < 0 || path[cut] !== '?' ? '' : path.slice(cut + 1).split('#')[0]
  const found = { terminalCode: '', to: '' }
  for (const part of query.split('&')) {
    const got = part.indexOf('scene=') === 0 ? parseEntryScene(part.slice(6)) : parseFields(part)
    if (got.terminalCode) found.terminalCode = got.terminalCode
    if (got.to) found.to = got.to
  }
  const scene = [found.terminalCode && 'k=' + found.terminalCode, found.to && 'to=' + found.to].filter(Boolean).join('&')
  return { kind: 'entry', url: '/' + page + (scene ? '?scene=' + encodeURIComponent(scene) : '') }
}

/** 上传页地址；有原意图就带着，解析失败后回去重传也不丢。 */
function uploadUrl(to) {
  return '/pages/resume-upload/resume-upload' + (validTo(to) ? '?to=' + to : '')
}

function openParsedResult(to, taskId, navigation) {
  // 解析页只是过场：和原来去诊断页一样换页，返回时回到上传页，不停在「解析完成」。
  // 优化带任务编号（同诊断页 tapOptimize）；对照、规划读刚存下的解析任务（同 AI 工具页 tapEntry）。
  const url = to === 'opt' ? `/pages/resume-optimize/resume-optimize?taskId=${taskId}`
    : to === 'fit' ? '/pages/job-fit/job-fit'
      : to === 'plan' ? '/pages/career-plan/career-plan'
        : `/pages/resume-diagnose/resume-diagnose?taskId=${encodeURIComponent(taskId)}`
  navigation.redirectTo({ url })
}

module.exports = { parseEntryScene, absorb, recallTerminal, parseEntryCodePath, validTo, uploadUrl, openParsedResult }
