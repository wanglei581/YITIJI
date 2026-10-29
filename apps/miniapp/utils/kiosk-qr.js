// utils/kiosk-qr.js
// 认一体机屏幕上的二维码。纯函数，顶层不碰 wx（node 测试里直接 require）。
//
// 新码（一体机直接出普通链接，微信「扫普通链接二维码打开小程序」规则直达对应页）：
//   传文件  https://<域名>/k/u/<scene>      scene    16–32 位 [A-Za-z0-9_-]   → pages/kiosk-send
//   登录    https://<域名>/k/l/<ticketId>   ticketId 32–96 位 [A-Za-z0-9_-]   → pages/kiosk-login
//   路径后面可以带一个 `/`，也可以带 `?…`、`#…`，都不影响。
// 旧码（旧版一体机、小程序内扫码，照旧要认）：
//   传文件  …#sessionId=…&token=…[&purpose=…]   参数在 # 后面
//   登录    …?ticketId=…
//
// 不按域名认：私有化部署的域名各不相同，码里的 scene / 票据本身才是凭据。
// 只认 http/https 链接，或以 /k/ 开头的相对路径；javascript:、小程序路径、裸字符串一律不认。

const SCENE_RE = /^[A-Za-z0-9_-]{16,32}$/
const TICKET_RE = /^[A-Za-z0-9_-]{32,96}$/
// 旧码的长度范围沿用小程序此前的识别规则（原 kiosk-login.js 里的三条正则）；
// 取值解码后再按字符集核一遍，解出 %、空格、引号这类字符的一律不认。
const LEGACY_TICKET_RE = /^[A-Za-z0-9_-]{20,200}$/
const LEGACY_SESSION_RE = /^[A-Za-z0-9_-]{8,200}$/
const LEGACY_TOKEN_RE = /^[A-Za-z0-9_.-]{8,400}$/
const MAX_LENGTH = 2048

function decode(value) {
  try {
    return decodeURIComponent(value)
  } catch (_) {
    return ''
  }
}

/** 拆成 path / query / hash。不是 http(s) 链接、也不是 /k/ 开头的相对路径，返回 null。 */
function splitLink(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text || text.length > MAX_LENGTH || /\s/.test(text)) return null
  const abs = /^https?:\/\/[^/?#]+(.*)$/i.exec(text)
  let rest = ''
  if (abs) rest = abs[1]
  else if (text.indexOf('/k/') === 0) rest = text
  else return null
  const hashAt = rest.indexOf('#')
  const head = hashAt >= 0 ? rest.slice(0, hashAt) : rest
  const queryAt = head.indexOf('?')
  return {
    absolute: !!abs,
    path: queryAt >= 0 ? head.slice(0, queryAt) : head,
    query: queryAt >= 0 ? head.slice(queryAt + 1) : '',
    hash: hashAt >= 0 ? rest.slice(hashAt + 1) : '',
  }
}

/** `a=1&b=2` → 取值表（未解码）。同名参数出现两次就说不清是哪一个，记成 null，按不认处理。 */
function paramsOf(text) {
  const out = Object.create(null)
  if (!text) return out
  text.split('&').forEach((pair) => {
    const eq = pair.indexOf('=')
    if (eq <= 0) return
    const key = pair.slice(0, eq)
    out[key] = Object.prototype.hasOwnProperty.call(out, key) ? null : pair.slice(eq + 1)
  })
  return out
}

function legacyValue(params, key, re) {
  const raw = params[key]
  if (typeof raw !== 'string' || !raw) return ''
  const value = decode(raw)
  return re.test(value) ? value : ''
}

/**
 * @param {string} raw 二维码里的完整内容（已经 decodeURIComponent 过一次的 options.q，或 wx.scanCode 的 result）
 * @returns {{kind:'upload-scene', scene:string}
 *   | {kind:'upload-session', sessionId:string, token:string}
 *   | {kind:'login', ticketId:string}
 *   | null}
 */
function parseKioskCode(raw) {
  const link = splitLink(raw)
  if (!link) return null

  const fresh = /^\/k\/([ul])\/([^/]+)\/?$/.exec(link.path)
  if (fresh) {
    const value = fresh[2]
    if (fresh[1] === 'u') return SCENE_RE.test(value) ? { kind: 'upload-scene', scene: value } : null
    return TICKET_RE.test(value) ? { kind: 'login', ticketId: value } : null
  }
  // 相对路径只认新码
  if (!link.absolute) return null

  // 旧上传码：参数在 # 后面（一体机 buildPhoneUploadUrl 这么拼）
  const hash = paramsOf(link.hash)
  const sessionId = legacyValue(hash, 'sessionId', LEGACY_SESSION_RE)
  const token = legacyValue(hash, 'token', LEGACY_TOKEN_RE)
  if (sessionId && token) return { kind: 'upload-session', sessionId, token }

  // 旧登录码：?ticketId=
  const ticketId = legacyValue(paramsOf(link.query), 'ticketId', LEGACY_TICKET_RE)
  if (ticketId) return { kind: 'login', ticketId }
  return null
}

module.exports = { parseKioskCode }
