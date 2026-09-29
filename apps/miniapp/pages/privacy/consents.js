// pages/privacy/consents.js
// 隐私页「年龄声明与录音同意」一节：取数、文案、撤回录音同意。只服务隐私页，不进 utils/。
//
// 数据来源：登录着以服务端 /me/ai-consents 为准（服务端对会员只认那里的记录），
// 没登录只有本机那一份（utils/ai-access.js）。读服务端失败时如实说读不到，不拿本机记录冒充。

const api = require('../../utils/api')
const auth = require('../../utils/auth')
const aiAccess = require('../../utils/ai-access')

// 个人信息请求的处理时限（D5，律师再核）。与法务试运行版隐私政策第五条一致，改之前先改法务文档。
const PRIVACY_REQUEST_DAYS = 15

function fmtDate(value) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function localAt(scope) {
  const at = aiAccess.declaredAt(scope)
  return at ? fmtDate(at) : ''
}

function ageRow(on, date, source) {
  return {
    on,
    text: on
      ? `已声明${date ? `（${date}${source}）` : ''}`
      : '还没有声明：第一次用 AI、上传简历或录音时会先问你',
  }
}

function voiceRow(on, date, source, revoked) {
  if (on) return { on, text: `已同意${date ? `（${date}${source}）` : ''}：语音说简历、模拟面试、向小青语音提问共用` }
  return { on, text: revoked ? '已撤回：录音入口会先问你，不同意就改用手打' : '还没有同意：第一次录音前会先问你' }
}

/**
 * @returns {Promise<{ loaded: boolean, error: string, age: object, voice: object }>}
 */
function load() {
  if (!auth.isLoggedIn()) {
    return Promise.resolve({
      loaded: true,
      error: '',
      age: ageRow(aiAccess.isDeclared(aiAccess.AGE_SCOPE), localAt(aiAccess.AGE_SCOPE), '，本机'),
      voice: voiceRow(aiAccess.isDeclared(aiAccess.VOICE_SCOPE), localAt(aiAccess.VOICE_SCOPE), '，本机', false),
    })
  }
  return api.getAiConsentStatus().then((rows) => {
    const find = (scope) => rows.find((r) => r && r.scope === scope) || null
    const age = find(aiAccess.AGE_SCOPE)
    const voice = find(aiAccess.VOICE_SCOPE)
    return {
      loaded: true,
      error: '',
      age: ageRow(!!(age && age.granted), age && age.granted ? fmtDate(age.grantedAt) : '', ''),
      voice: voiceRow(!!(voice && voice.granted), voice && voice.granted ? fmtDate(voice.grantedAt) : '', '', !!(voice && voice.revokedAt)),
    }
  }, () => ({
    loaded: true,
    error: '暂时读不到账号里的记录，请稍后下拉刷新',
    age: { on: false, text: '' },
    voice: { on: false, text: '' },
  }))
}

/** 录音同意写的五件事，给「查看 / 撤回」弹框用。 */
function voiceConsentText() {
  return aiAccess.VOICE_CONSENT_ITEMS.map((line, i) => `${i + 1}. ${line}`).join('\n')
}

/**
 * 点「录音单独同意」这一行：没同意时只看五件事；已同意时可以撤回。
 * 撤回失败如实说没撤成（服务端没撤掉，本机也不先说撤了）。
 * @param page 隐私页实例：用它的 busy 防连点、撤回后重读这一节。
 */
function promptVoice(page) {
  const granted = !!(page.data.consents.voice && page.data.consents.voice.on)
  wx.showModal({
    title: granted ? '撤回录音同意' : '录音单独同意',
    content: `${voiceConsentText()}\n\n${granted
      ? '撤回后，录音入口会先问你，不同意就改用手打，功能还在。'
      : '第一次录音前会先问你，不同意就改用手打。'}`,
    confirmText: granted ? '确认撤回' : '知道了',
    showCancel: granted,
    cancelText: '保留',
    success: (r) => {
      if (!granted || !r.confirm) return
      page.setData({ busy: '正在撤回…' })
      api.revokeVoiceConsent()
        .then(() => {
          page.setData({ busy: '' })
          wx.showToast({ title: '已撤回录音同意', icon: 'none' })
          page.loadConsents()
        })
        .catch(() => {
          page.setData({ busy: '' })
          wx.showModal({ title: '撤回没有完成', content: '这一次没撤成，录音同意还在。请检查网络后再试。', showCancel: false })
        })
    },
  })
}

/** 公众平台上填的「小程序用户隐私保护指引」，与官方隐私弹窗里是同一份。 */
function openPrivacyGuide() {
  const fallback = (content) => wx.showModal({ title: '暂时打不开', content, showCancel: false })
  if (typeof wx.openPrivacyContract !== 'function') {
    fallback('当前微信版本较旧，升级微信后可以查看。也可以先看《隐私政策》。')
    return
  }
  wx.openPrivacyContract({
    fail() { fallback('隐私保护指引暂时打不开，请稍后再试。也可以先看《隐私政策》。') },
  })
}

module.exports = { PRIVACY_REQUEST_DAYS, load, promptVoice, openPrivacyGuide }
