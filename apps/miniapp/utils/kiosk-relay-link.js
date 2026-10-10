// 扫码接力入口的纯解析器；只解码参数，不保存凭据。
const SESSION_RE = /[#?&]sessionId=([A-Za-z0-9_%-]{8,200})/
const TOKEN_RE = /[#?&]token=([A-Za-z0-9_.%-]{8,400})/
const SCENE_RE = /[#?&]scene=([^&#?]*)/
const SCENE_PATTERN = /^[A-Za-z0-9_-]{16,32}$/

function sceneResult(value) {
  const scene = decodeURIComponent(value)
  return SCENE_PATTERN.test(scene) ? { kind: 'scene', scene } : { kind: 'invalid' }
}

function parseRelayText(text) {
  if (typeof text !== 'string' || !text) return { kind: 'invalid' }
  try {
    const session = text.match(SESSION_RE)
    const token = text.match(TOKEN_RE)
    if (session && token) {
      return {
        kind: 'credentials',
        sessionId: decodeURIComponent(session[1]),
        token: decodeURIComponent(token[1]),
      }
    }
    const param = text.match(SCENE_RE)
    if (param) return sceneResult(param[1])
    // 路径短码只认带主机名和路径的 http(s) 网址：一段裸文字、只有主机名的网址都不算，
    // 否则小程序内扫到任何 16–32 位字母数字的码都会被当成上传码。
    const url = text.split(/[?#]/)[0].match(/^https?:\/\/[^/]+\/(?:.*\/)?([^/]*)$/i)
    return url ? sceneResult(url[1]) : { kind: 'invalid' }
  } catch (_) {
    return { kind: 'invalid' }
  }
}

function parseMiniappCodePath(path) {
  if (typeof path !== 'string' || !path) return { kind: 'invalid' }
  try {
    const page = path.split(/[?#]/)[0].replace(/^\//, '')
    if (page !== 'pages/kiosk-send/kiosk-send') return { kind: 'invalid' }
    const param = path.match(SCENE_RE)
    return param ? sceneResult(param[1]) : { kind: 'invalid' }
  } catch (_) {
    return { kind: 'invalid' }
  }
}

module.exports = { parseRelayText, parseMiniappCodePath }
