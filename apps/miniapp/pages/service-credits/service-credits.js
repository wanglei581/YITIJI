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

function memberIdOf(sessionKey) {
  return typeof sessionKey === 'string' ? sessionKey.split('#g')[0] : '';
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
    baselineReady: false,
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
    this._creditsSeq = 0;
    this._appliedCreditsSeq = 0;
    this._baselineSnapshot = null;
    this._pollTimer = null;
    this._pollResolve = null;
    const subscribe = auth && (auth.subscribeSessionChange || auth.onSessionChange);
    this._unsubSession = typeof subscribe === 'function'
      ? subscribe(() => { if (!this._unloaded) this._enforceIdentity(); })
      : null;
    this.setData({
      statusBarHeight: (app && app.globalData && app.globalData.statusBarHeight) || 20,
      clientSupported: vpayModel.supportsVirtualPayment(wx),
    });
  },

  /** 会员身份 + 会话代次组合键：同会员登出重登也触发代次变更、立即解锁并清场。 */
  _sessionKey() {
    const base = memberIdentityKey(auth);
    if (!isMemberIdentity(base)) return base;
    const gen = typeof auth.sessionGeneration === 'function' ? auth.sessionGeneration() : 0;
    return `${base}#g${gen}`;
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
    this._creditsSeq += 1;
    this._appliedCreditsSeq = this._creditsSeq;
    this._clearPollTimer();
    this._baselineSnapshot = null;
    const blank = emptySummary();
    this.setData({
      loading: false,
      loadedOnce: false,
      baselineReady: false,
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

  /**
   * 核验当前会员身份与会话代次，会话变化时同步清场（含活动定时器与 buyingKind）。
   * @returns {{ usable: boolean, changed: boolean }}
   */
  _enforceIdentity() {
    const sessionKey = this._sessionKey();
    const usable = isMemberIdentity(sessionKey);
    const prevKey = this._guard.identity();
    if (this._guard.setIdentity(sessionKey)) {
      const prevMember = memberIdOf(prevKey);
      const nextMember = memberIdOf(sessionKey);
      const hadMember = isMemberIdentity(prevMember);
      const switched = hadMember && isMemberIdentity(nextMember) && prevMember !== nextMember;
      const notice = switched
        ? vpayModel.VPAY_COPY.switchedDesc
        : (hadMember && !usable ? vpayModel.VPAY_COPY.signedOutDesc : '');
      this._resetAll(notice);
      this.setData({ isLoggedIn: usable });
      return { usable, changed: hadMember };
    }
    if (!usable && (this.data.totalCount || this.data.records.length || this.data.buyingKind || this.data.baselineReady || this.data.isLoggedIn)) {
      this._resetAll('');
      this.setData({ isLoggedIn: false });
      return { usable: false, changed: true };
    }
    return { usable, changed: false };
  },

  _accepts(token) {
    return this._guard.accepts(token, this._sessionKey());
  },

  _applyCredits(summarized, seq) {
    if (typeof seq === 'number' && seq < this._appliedCreditsSeq) return false;
    if (typeof seq === 'number') this._appliedCreditsSeq = seq;
    this._baselineSnapshot = vpayModel.createCreditsBaseline(summarized);
    this.setData({
      totalCount: summarized.total,
      summary: summarized.summary,
      records: summarized.records,
      loading: false,
      loadedOnce: true,
      baselineReady: true,
      error: '',
    });
    return true;
  },

  onShow() {
    this._guard.activate();
    const status = this._enforceIdentity();
    this.setData({
      isLoggedIn: status.usable,
      clientSupported: vpayModel.supportsVirtualPayment(wx),
    });
    if (status.usable && !this.data.buyingKind) {
      this._loadCredits();
    }
  },

  onHide() {
    // 常规列表请求在切后台时作废；同账号唤起微信收银台期间由 buySeq + sessionKey 独立守卫继续确认。
    this._guard.deactivate();
  },

  onUnload() {
    this._unloaded = true;
    if (this._unsubSession) {
      this._unsubSession();
      this._unsubSession = null;
    }
    this._buySeq += 1;
    this._creditsSeq += 1;
    this._appliedCreditsSeq = this._creditsSeq;
    this._clearPollTimer();
    this._guard.deactivate();
    this._baselineSnapshot = null;
    this.data.records = [];
    this.data.buyingKind = '';
    this.data.baselineReady = false;
  },

  onPullDownRefresh() {
    const stop = () => wx.stopPullDownRefresh();
    if (!this._enforceIdentity().usable || this.data.buyingKind) { stop(); return; }
    this._loadCredits().then(stop, stop);
  },

  _loadCredits() {
    if (!this._enforceIdentity().usable) return Promise.resolve();
    const token = this._guard.issue('credits');
    const readSeq = (this._creditsSeq += 1);
    this.setData({ loading: true, error: '' });
    return vpayApi.listServiceCredits()
      .then((res) => {
        this._enforceIdentity();
        if (!this._accepts(token)) return;
        // 共享版本守卫：购买发起或更新结果落地后，更早发起的普通列表迟到响应一律丢弃。
        if (readSeq < this._creditsSeq || readSeq < this._appliedCreditsSeq) return;
        this._applyCredits(vpayModel.summarizeCredits(res), readSeq);
      })
      .catch((err) => {
        this._enforceIdentity();
        if (!this._accepts(token)) return;
        if (readSeq < this._creditsSeq || readSeq < this._appliedCreditsSeq) return;
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
    const status = this._enforceIdentity();
    if (!status.usable || status.changed) return;
    // 首次权益基线尚未成功拉取前禁止购买，杜绝把既有旧权益误判为本次新到账。
    if (!this.data.baselineReady || !this._baselineSnapshot) return;
    if (!vpayModel.supportsVirtualPayment(wx)) {
      this.setData({
        clientSupported: false,
        buyNotice: vpayModel.VPAY_COPY.unsupportedClientNotice,
        buyNoticeTone: 'warn',
      });
      return;
    }

    const startSessionKey = this._sessionKey();
    const buySeq = (this._buySeq += 1);
    // 推进共享权益版本，作废任何早于本次购买发起、仍在途的普通列表请求。
    this._creditsSeq += 1;
    const baseline = this._baselineSnapshot;

    const isStale = () => {
      if (this._unloaded || this._buySeq !== buySeq) return true;
      if (this._sessionKey() !== startSessionKey) return true;
      return false;
    };

    this.setData({
      loading: false,
      buyingKind: kind,
      buyNotice: '',
      buyNoticeTone: 'info',
    });

    return vpayModel.buyServiceCredit({
      serviceKind: kind,
      baseline,
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
        if (!this._unloaded && this._buySeq === buySeq && this.data.buyingKind) {
          this.setData({ buyingKind: '' });
        }
        return result;
      }
      if (!result || result.status === 'stale') {
        if (!this._unloaded && this.data.buyingKind) this.setData({ buyingKind: '' });
        return result;
      }

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
        if (result.credits) {
          const applySeq = (this._creditsSeq += 1);
          this._applyCredits(result.credits, applySeq);
        }
        this.setData({
          buyingKind: '',
          buyNotice: result.message,
          buyNoticeTone: 'ok',
        });
        return result;
      }
      if (result.status === 'pending_confirm') {
        if (result.credits) {
          const applySeq = (this._creditsSeq += 1);
          this._applyCredits(result.credits, applySeq);
        }
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
