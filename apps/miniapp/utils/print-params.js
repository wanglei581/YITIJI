// 打印参数纯函数。不请求接口，也不保存页面状态。
// duplex === 'duplex_long_edge' 表示长边翻页；短边不开放。

function missing(value) {
  return value === undefined || value === null
}

function normalize(input) {
  if (missing(input)) input = {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('打印参数无法识别')
  }
  const rawCopies = missing(input.copies) ? 1 : input.copies
  const copies = typeof rawCopies === 'string' && /^[1-9]\d?$/.test(rawCopies) ? Number(rawCopies) : rawCopies
  const colorMode = missing(input.colorMode) ? 'black_white' : input.colorMode
  const duplex = missing(input.duplex) ? 'simplex' : input.duplex
  if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > 99) {
    throw new Error('份数须为 1 到 99 的整数')
  }
  if (colorMode !== 'black_white' && colorMode !== 'color') {
    throw new Error('颜色只能是黑白或彩色')
  }
  if (duplex === 'duplex_short_edge') {
    throw new Error('短边翻页未开放')
  }
  if (duplex !== 'simplex' && duplex !== 'duplex_long_edge') {
    throw new Error('双面方式无法识别')
  }
  return { copies, colorMode, duplex }
}

function quoteParams(normalized) {
  const params = normalize(normalized)
  return {
    copies: params.copies,
    colorMode: params.colorMode,
    duplex: params.duplex,
    paperSize: 'A4',
    orientation: 'auto',
    quality: 'standard',
    scale: 'fit',
    pagesPerSheet: 1,
  }
}

function labels(normalized) {
  const params = normalize(normalized)
  return {
    colorLabel: params.colorMode === 'color' ? '彩色' : '黑白',
    duplexLabel: params.duplex === 'duplex_long_edge' ? '双面（长边翻页）' : '单面',
  }
}

function allowedCapabilities(raw) {
  const list = raw && Array.isArray(raw.capabilities) ? raw.capabilities : []
  const allow = (key) => {
    const rows = list.filter(item => item && item.capabilityKey === key)
    return rows.length === 1 && rows[0].status === 'available' && rows[0].configured === true
  }
  return { color: allow('color_print'), duplex: allow('duplex_print') }
}

function capabilityError(raw, normalized) {
  let params
  try { params = normalize(normalized) } catch (err) { return err.message }
  const { colorMode, duplex } = params
  if (colorMode === 'black_white' && duplex === 'simplex') return ''
  if (duplex === 'duplex_short_edge') {
    return '短边翻页未开放，请改回单面或更换终端'
  }
  const allowed = allowedCapabilities(raw)
  const blocked = []
  if (colorMode === 'color' && !allowed.color) blocked.push('彩色')
  if (duplex === 'duplex_long_edge' && !allowed.duplex) blocked.push('双面（长边翻页）')
  if (blocked.length) return '该终端未开放' + blocked.join('、') + '，请改回黑白单面，或更换终端'
  if (colorMode !== 'black_white' && colorMode !== 'color') return '颜色无法识别，请改回黑白或更换终端'
  if (duplex !== 'simplex' && duplex !== 'duplex_long_edge') return '双面方式无法识别，请改回单面或更换终端'
  return ''
}

module.exports = { normalize, quoteParams, labels, capabilityError, allowedCapabilities }
