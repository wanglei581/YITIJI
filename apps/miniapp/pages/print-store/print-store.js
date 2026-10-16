// pages/print-store/print-store.js
// 选择终端，并在本页选择彩色 / 长边双面。只认本次核定结果。
const api = require('../../utils/api')
const printParams = require('../../utils/print-params')

function decodeParam(value) {
  if (typeof value !== 'string' || !value) return ''
  try { return decodeURIComponent(value) } catch (e) { return value }
}

function quoteKey(fileId, terminalId, params) {
  return [fileId, terminalId, params.copies, params.colorMode, params.duplex].join('|')
}

function clearedQuote(state) {
  return {
    quoteState: state || 'idle', quoteReady: false, isFreeOrder: false,
    amountCents: null, amountYuan: '', quoteError: '', canConfirm: false,
  }
}

function yuanText(cents) {
  const frac = cents % 100
  return Math.floor(cents / 100) + '.' + (frac < 10 ? '0' : '') + frac
}

Page({
  data: {
    statusBarHeight: 20, fileId: '', fileName: '', copies: 1,
    colorMode: 'black_white', duplex: 'simplex', colorLabel: '黑白', duplexLabel: '单面',
    stores: [], picked: '', loading: true, loadError: '',
    capState: 'idle', capColor: false, capDuplex: false, capError: '',
    quoteState: 'idle', quoteReady: false, isFreeOrder: false,
    amountCents: null, amountYuan: '', quoteError: '', canConfirm: false,
  },

  onLoad(opts) {
    const q = opts || {}
    this._active = true
    this._seq = this._quoteSeq = this._listSeq = 0
    this._capRaw = null
    this._quotedKey = ''
    this._navigating = false
    this._skipNextShow = true
    this._paramsError = ''
    let normalized
    try { normalized = printParams.normalize({ copies: q.copies, colorMode: q.colorMode, duplex: q.duplex }) }
    catch (err) { this._paramsError = err.message; this.setData({ loading: false, loadError: err.message }); return }
    const text = printParams.labels(normalized)
    const gd = getApp().globalData || {}
    this.setData({
      statusBarHeight: gd.statusBarHeight || 20,
      fileId: typeof q.fileId === 'string' ? q.fileId : '',
      fileName: decodeParam(q.name),
      copies: normalized.copies, colorMode: normalized.colorMode, duplex: normalized.duplex,
      colorLabel: text.colorLabel, duplexLabel: text.duplexLabel,
    })
    this._loadTerminals(false)
  },

  onShow() {
    if (this._paramsError) return
    if (this._skipNextShow) { this._skipNextShow = false; return }
    this._refresh(true)
  },

  onHide() { this._active = false; this._dropInflight() },
  onUnload() { this._active = false; this._dropInflight() },
  reload() { this._refresh(false) },

  _dropInflight() {
    this._seq += 1
    this._quoteSeq += 1
    this._listSeq += 1
    this.setData(clearedQuote('idle'))
    this._capRaw = null
    this._quotedKey = ''
  },

  _refresh(silent) {
    if (this._paramsError) return
    this._active = true
    this._navigating = false
    this._dropInflight()
    this.setData(Object.assign(clearedQuote(this.data.picked ? 'pending' : 'idle'), {
      capState: this.data.picked ? 'loading' : 'idle', capColor: false, capDuplex: false, capError: '',
    }))
    this._loadTerminals(silent)
  },

  _loadTerminals(silent) {
    const seq = ++this._listSeq
    if (!silent || !(this.data.stores && this.data.stores.length)) this.setData({ loading: true, loadError: '' })
    api.getPublicTerminals().then(data => {
      if (!this._active || seq !== this._listSeq) return
      const list = Array.isArray(data) ? data : ((data && data.data) || [])
      let picked = this.data.picked
      if (picked && !list.some(item => item && item.id === picked)) picked = ''
      if (!picked && list.length === 1) picked = list[0].id
      this.setData({ stores: list, loading: false, loadError: '', picked })
      if (picked) this._loadCapabilities(picked)
      else this.setData(Object.assign(clearedQuote('idle'), { capState: 'idle', capColor: false, capDuplex: false, capError: '' }))
    }).catch((err) => {
      if (!this._active || seq !== this._listSeq) return
      const known = !!(this.data.stores && this.data.stores.length)
      this.setData({ loading: false, loadError: known ? '' : ((err && err.message) || '加载终端列表失败，请重试') })
      if (known && this.data.picked) this._loadCapabilities(this.data.picked)
    })
  },

  pick(e) {
    const id = e.currentTarget.dataset.id
    if (!id || id === this.data.picked || this._paramsError || !this._active) return
    if (!(this.data.stores || []).some(item => item && item.id === id)) return
    this.setData(Object.assign({ picked: id }, clearedQuote('pending'), {
      capState: 'loading', capColor: false, capDuplex: false, capError: '',
    }))
    this._loadCapabilities(id)
  },

  setParam(e) {
    if (this._paramsError || !this._active) return
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    if (ds.key !== 'colorMode' && ds.key !== 'duplex') {
      this._quoteSeq += 1
      this._quotedKey = ''
      this.setData(Object.assign(clearedQuote('fail'), { capError: '打印参数无法识别' }))
      return
    }
    if ((ds.key === 'colorMode' && ds.mode === 'color' && !this.data.capColor)
      || (ds.key === 'duplex' && ds.mode === 'duplex_long_edge' && !this.data.capDuplex)) return
    this._setIntent(ds.key === 'colorMode' ? { colorMode: ds.mode || '' } : { duplex: ds.mode || '' })
  },

  _intent() {
    return { copies: this.data.copies, colorMode: this.data.colorMode, duplex: this.data.duplex }
  },

  _setIntent(patch) {
    let normalized
    try { normalized = printParams.normalize(Object.assign({}, this._intent(), patch)) }
    catch (err) {
      this._quoteSeq += 1
      this._quotedKey = ''
      this.setData(Object.assign(clearedQuote('fail'), { capError: (err && err.message) || '打印参数无法识别' }))
      return
    }
    if (normalized.colorMode === this.data.colorMode && normalized.duplex === this.data.duplex && normalized.copies === this.data.copies && this.data.quoteReady) return
    const text = printParams.labels(normalized)
    const capError = printParams.capabilityError(this._capRaw, normalized)
    this._quoteSeq += 1
    this._quotedKey = ''
    this.setData(Object.assign(clearedQuote(capError ? 'idle' : 'pending'), {
      copies: normalized.copies, colorMode: normalized.colorMode, duplex: normalized.duplex,
      colorLabel: text.colorLabel, duplexLabel: text.duplexLabel, capError,
    }))
    if (!capError && this.data.picked && this.data.capState !== 'loading') this._requestQuote(this.data.picked, normalized)
  },

  _loadCapabilities(terminalId) {
    const seq = ++this._seq
    this._capRaw = null
    this._quoteSeq += 1
    this._quotedKey = ''
    this.setData(Object.assign(clearedQuote('pending'), {
      capState: 'loading', capColor: false, capDuplex: false, capError: '',
    }))
    const done = (raw) => {
      if (!this._active || seq !== this._seq || this.data.picked !== terminalId) return
      this._applyCapabilities(terminalId, raw)
    }
    api.getTerminalCapabilities(terminalId).then(raw => {
      const body = raw && Array.isArray(raw.capabilities) ? raw
        : (raw && raw.data && Array.isArray(raw.data.capabilities) ? raw.data : null)
      done(body)
    }).catch(() => done(null))
  },

  _applyCapabilities(terminalId, raw) {
    this._capRaw = raw
    const allowed = printParams.allowedCapabilities(raw)
    let normalized
    try { normalized = printParams.normalize(this._intent()) }
    catch (err) {
      this.setData(Object.assign(clearedQuote('fail'), {
        capState: raw ? 'ready' : 'fail', capColor: allowed.color, capDuplex: allowed.duplex,
        capError: (err && err.message) || '打印参数无法识别',
      }))
      return
    }
    const text = printParams.labels(normalized)
    const capError = printParams.capabilityError(raw, normalized)
    const capPatch = {
      capState: raw ? 'ready' : 'fail', capColor: allowed.color, capDuplex: allowed.duplex, capError,
      colorLabel: text.colorLabel, duplexLabel: text.duplexLabel,
    }
    if (capError) {
      this._quoteSeq += 1
      this._quotedKey = ''
      this.setData(Object.assign(clearedQuote('idle'), capPatch))
      return
    }
    this.setData(capPatch)
    this._requestQuote(terminalId, normalized)
  },

  _requestQuote(terminalId, normalized) {
    const store = this.data.stores.find(item => item && item.id === terminalId)
    if (!this._active || this._paramsError || !store || !store.isOnline) { this.setData(Object.assign(clearedQuote('fail'), { quoteError: '所选终端暂时离线，请选择其他终端' })); return }
    const quoteSeq = ++this._quoteSeq
    const fileId = this.data.fileId
    this._quotedKey = ''
    if (!fileId) {
      this.setData(Object.assign(clearedQuote('fail'), { quoteError: '缺少文件，暂时不能核定' }))
      return
    }
    this.setData(clearedQuote('pending'))
    api.quoteMyPrintOrder(fileId, printParams.quoteParams(normalized), undefined, { terminalId }).then(res => {
      if (!this._active || quoteSeq !== this._quoteSeq || this.data.picked !== terminalId) return
      const amountCents = res && res.amountCents
      if (!Number.isSafeInteger(amountCents) || amountCents < 0 || !Number.isSafeInteger(res.billablePages) || res.billablePages < 1) {
        this.setData(Object.assign(clearedQuote('fail'), { quoteError: '核定结果无法确认' }))
        return
      }
      let now
      try { now = printParams.normalize(this._intent()) }
      catch (e) {
        this.setData(Object.assign(clearedQuote('fail'), { quoteError: '打印参数无法识别' }))
        return
      }
      if (now.copies !== normalized.copies || now.colorMode !== normalized.colorMode || now.duplex !== normalized.duplex) {
        this.setData(clearedQuote('idle'))
        return
      }
      const blocked = printParams.capabilityError(this._capRaw, now)
      if (blocked) {
        this.setData(Object.assign(clearedQuote('idle'), { capError: blocked }))
        return
      }
      const isFreeOrder = amountCents === 0
      const store = (this.data.stores || []).find(item => item && item.id === terminalId)
      this._quotedKey = quoteKey(fileId, terminalId, normalized)
      this.setData({
        quoteState: 'ready', quoteReady: true, isFreeOrder, amountCents,
        amountYuan: isFreeOrder ? '' : yuanText(amountCents), quoteError: '',
        canConfirm: !!(store && store.isOnline),
      })
    }).catch(() => {
      if (!this._active || quoteSeq !== this._quoteSeq) return
      this._quotedKey = ''
      this.setData(Object.assign(clearedQuote('fail'), { quoteError: '核定没有完成，请重试' }))
    })
  },

  toPay() {
    if (!this._active || this._paramsError || this._navigating) return
    const store = (this.data.stores || []).find(item => item && item.id === this.data.picked)
    if (!store) { wx.showToast({ title: '请先选择终端', icon: 'none' }); return }
    if (!store.isOnline) {
      wx.showModal({ title: '该终端暂时离线', content: '所选终端暂时离线，请选择其他终端或稍后再试。', showCancel: false })
      return
    }
    let normalized
    try { normalized = printParams.normalize(this._intent()) }
    catch (e) { wx.showToast({ title: '请调整打印参数', icon: 'none' }); return }
    const capError = printParams.capabilityError(this._capRaw, normalized)
    const matched = this.data.quoteReady && this.data.quoteState === 'ready' && this._quotedKey === quoteKey(this.data.fileId, store.id, normalized)
    if (capError || !matched) {
      if (capError) {
        this._quoteSeq += 1
        this._quotedKey = ''
        this.setData(Object.assign(clearedQuote('idle'), { capError }))
      }
      wx.showToast({ title: capError ? '请改回黑白单面或更换终端' : '请等待核定完成', icon: 'none' })
      return
    }
    const enc = encodeURIComponent
    const url = '/pages/print-pay/print-pay?fileId=' + enc(this.data.fileId || '')
      + '&storeId=' + enc(store.id)
      + '&store=' + enc(store.displayName || '')
      + '&copies=' + enc(String(normalized.copies))
      + '&colorMode=' + enc(normalized.colorMode)
      + '&duplex=' + enc(normalized.duplex)
    this._navigating = true
    wx.navigateTo({ url, fail: () => { this._navigating = false } })
  },

  back() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } }) },
})
