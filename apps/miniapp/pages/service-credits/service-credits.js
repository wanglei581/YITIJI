// pages/service-credits/service-credits.js
// 会员一体机 AI 服务次数展示与微信虚拟支付单次购买页（一页一分包）。
// 零硬编码价格/道具 ID/AppKey，零外部付款引导，不伪造本地到账次数。

const app = getApp();
const auth = require('../../utils/auth');
const vpayApi = require('../../utils/api-virtual-pay');
const vpayModel = require('../../utils/virtual-pay-model');
const { createLifecycleGuard, memberIdentityKey, isMemberIdentity } = require('../../utils/page-guard');

function emptySummary() {
  return vpayModel.summarizeCredits([]);
}

Page({
  data: {
    statusBarHeight: 20,
    copy: vpayModel.VPAY_COPY,
    catalog: vpayModel.SERVICE_CATALOG,
    isLoggedIn: false,
    identityNotice: '',
    loading: false,
    loadedOnce: false,
    error: '',
    totalCount: 0,
    summary: emptySummary().summary,
    records: [],
    clientSupported: true,
    purchaseUnavailable: false,
    purchaseUnavailableText: '',
    buyingKind: '',
    buyNotice: '',
    buyNoticeTone: 'info',
  },

  onLoad() {
    this._guard = createLifecycleGuard();
    this._guard.activate();
    this._unloaded = false;
    this._buySeq = 0;
    this._counts = { resume_optimize: 0, mock_interview: 0 };
    this._pollTimer = null;
    this._pollResolve = null;
    this.setData({
      statusBarHeight: (app && app.globalData && app.globalData.statusBarHeight) || 20,
      clientSupported: vpayModel.supportsVirtualPayment(wx),
    });
  },

  _identityKey() {
    return memberIdentityKey(auth);
  },

  _clearPollTimer() {
    if (this._pollTimer !== null) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._pollResolve) {
      const done = this._pollResolve;
      this._pollResolve = null;
      done();
    }
  },

  _sleep(ms) {
    return new Promise((resolve) => {
      this._clearPollTimer();
      this._pollResolve = resolve;
      this._pollTimer = setTimeout(() => {
        this._pollTimer = null;
        this._pollResolve = null;
        resolve();
      }, ms);
    });
  },

  _resetAll(notice) {
    this._buySeq += 1;
    this._clearPollTimer();
    this._counts = { resume_optimize: 0, mock_interview: 0 };
    const blank = emptySummary();
    this.setData({
      loading: false,
      loadedOnce: false,
      error: '',
      totalCount: 0,
      summary: blank.summary,
      records: [],
      purchaseUnavailable: false,
      purchaseUnavailableText: '',
      buyingKind: '',
      buyNotice: '',
      buyNoticeTone: 'info',
      identityNotice: notice || '',
    });
  },

  _enforceIdentity() {
    const identity = this._identityKey();
    const usable = isMemberIdentity(identity);
    const prevIdentity = this._guard.identity();
    if (this._guard.setIdentity(identity)) {
      const switched = isMemberIdentity(prevIdentity) && isMemberIdentity(identity) && prevIdentity !== identity;
      const notice = switched
        ? vpayModel.VPAY_COPY.switchedDesc
        : (isMemberIdentity(prevIdentity) && !usable ? vpayModel.VPAY_COPY.signedOutDesc : '');
      this._resetAll(notice);
      this.setData({ isLoggedIn: usable });
      return usable;
    }
    if (!usable && (this.data.totalCount || this.data.records.length || this.data.buyingKind || this.data.isLoggedIn)) {
      this._resetAll('');
      this.setData({ isLoggedIn: false });
    }
    return usable;
  },

  _accepts(token) {
    return this._guard.accepts(token, this._identityKey());
  },

  _applyCredits(summarized) {
    this._counts = Object.assign({ resume_optimize: 0, mock_interview: 0 }, summarized.counts);
    this.setData({
      totalCount: summarized.total,
      summary: summarized.summary,
      records: summarized.records,
      loading: false,
      loadedOnce: true,
      error: '',
    });
  },

  onShow() {
    this._guard.activate();
    const usable = this._enforceIdentity();
    this.setData({
      isLoggedIn: usable,
      clientSupported: vpayModel.supportsVirtualPayment(wx),
    });
    if (usable && !this.data.buyingKind) {
      this._loadCredits();
    }
  },

  onHide() {
    // 常规列表请求在切后台时作废；正在进行的同一账号虚拟支付由 buySeq + identity + sessionGeneration 独立守卫。
    this._guard.deactivate();
  },

  onUnload() {
    this._unloaded = true;
    this._buySeq += 1;
    this._clearPollTimer();
    this._guard.deactivate();
    this._counts = { resume_optimize: 0, mock_interview: 0 };
    this.data.records = [];
    this.data.buyingKind = '';
  },

  onPullDownRefresh() {
    const stop = () => wx.stopPullDownRefresh();
    if (!this._enforceIdentity()) { stop(); return; }
    this._loadCredits().then(stop, stop);
  },

  _loadCredits() {
    if (!this._enforceIdentity()) return Promise.resolve();
    const token = this._guard.issue('credits');
    this.setData({ loading: true, error: '' });
    return vpayApi.listServiceCredits()
      .then((res) => {
        this._enforceIdentity();
        if (!this._accepts(token)) return;
        this._applyCredits(vpayModel.summarizeCredits(res));
      })
      .catch((err) => {
        this._enforceIdentity();
        if (!this._accepts(token)) return;
        this.setData({
          loading: false,
          loadedOnce: true,
          error: vpayModel.describeVpayError(err, vpayModel.VPAY_COPY.loadError),
        });
      });
  },

  retryLoad() {
    this._loadCredits();
  },

  tapBuy(e) {
    const kind = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.kind;
    if (!vpayModel.isSupportedServiceKind(kind) || this.data.buyingKind || this.data.purchaseUnavailable) return;
    if (!this._enforceIdentity()) return;
    if (!vpayModel.supportsVirtualPayment(wx)) {
      this.setData({
        clientSupported: false,
        buyNotice: vpayModel.VPAY_COPY.unsupportedClientNotice,
        buyNoticeTone: 'warn',
      });
      return;
    }

    const startIdentity = this._identityKey();
    const startGen = typeof auth.sessionGeneration === 'function' ? auth.sessionGeneration() : 0;
    const buySeq = this._buySeq + 1;
    this._buySeq = buySeq;
    const baselineCounts = Object.assign({}, this._counts);

    const isStale = () => {
      if (this._unloaded || this._buySeq !== buySeq) return true;
      if (this._identityKey() !== startIdentity) return true;
      if (typeof auth.sessionGeneration === 'function' && auth.sessionGeneration() !== startGen) return true;
      return false;
    };

    this.setData({
      buyingKind: kind,
      buyNotice: '',
      buyNoticeTone: 'info',
    });

    return vpayModel.buyServiceCredit({
      serviceKind: kind,
      baselineCounts,
      wxObj: wx,
      api: vpayApi,
      isStale,
      sleep: (ms) => this._sleep(ms),
      onStatus: (st) => {
        if (isStale()) return;
        this.setData({
          buyNotice: (st && st.message) || vpayModel.VPAY_COPY.confirmingNotice,
          buyNoticeTone: 'info',
        });
      },
    }).then((result) => {
      if (isStale()) {
        this._enforceIdentity();
        return result;
      }
      if (!result || result.status === 'stale') return result;

      if (result.status === 'unsupported') {
        this.setData({
          buyingKind: '',
          clientSupported: false,
          buyNotice: result.message,
          buyNoticeTone: 'warn',
        });
        return result;
      }
      if (result.status === 'unavailable') {
        this.setData({
          buyingKind: '',
          purchaseUnavailable: true,
          purchaseUnavailableText: result.message,
          buyNotice: result.message,
          buyNoticeTone: 'warn',
        });
        return result;
      }
      if (result.status === 'confirmed') {
        if (result.credits) this._applyCredits(result.credits);
        this.setData({
          buyingKind: '',
          buyNotice: result.message,
          buyNoticeTone: 'ok',
        });
        return result;
      }
      if (result.status === 'pending_confirm') {
        if (result.credits) this._applyCredits(result.credits);
        this.setData({
          buyingKind: '',
          buyNotice: result.message,
          buyNoticeTone: 'info',
        });
        return result;
      }
      this.setData({
        buyingKind: '',
        buyNotice: result.message || vpayModel.VPAY_COPY.buyError,
        buyNoticeTone: result.status === 'cancelled' ? 'info' : 'warn',
      });
      return result;
    });
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/me/me' }); } });
  },

  toLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' });
  },
});
