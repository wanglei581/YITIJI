// pages/invoice-center/invoice-center.js
// 会员自助开票中心（一页一分包）。
// 严格禁止将税号、邮箱或表单草稿写入 wx.setStorageSync / 本地缓存：
// 表单仅驻留页面内存，提交成功、取消、切后台（onHide）、离页（onUnload）或会话变更时立即清空。

const app = getApp();
const auth = require('../../utils/auth');
const invoiceApi = require('../../utils/api-invoice');
const invoiceModel = require('../../utils/invoice-model');
const { createLifecycleGuard, memberIdentityKey, isMemberIdentity } = require('../../utils/page-guard');

const PAGE_LIMIT = 20;

function memberIdOf(sessionKey) {
  return typeof sessionKey === 'string' ? sessionKey.split('#g')[0] : '';
}

Page({
  data: {
    statusBarHeight: 20,
    copy: invoiceModel.INVOICE_COPY,
    isLoggedIn: false,
    identityNotice: '',
    loading: false,
    loadedOnce: false,
    loadingMore: false,
    error: '',
    moreError: '',
    orders: [],
    nextCursor: null,

    selectedOrder: null,
    form: invoiceModel.emptyInvoiceForm(),
    formError: '',
    submitting: false,

    detailLoading: false,
    detailError: '',
    detail: null,
  },

  onLoad(options) {
    this._unloaded = false;
    this._guard = createLifecycleGuard();
    this._guard.activate();
    this._submitting = false;
    this._submitToken = null;
    const rawKind = options && typeof options.orderKind === 'string' ? options.orderKind.trim() : '';
    const rawId = options && typeof options.orderId === 'string' ? decodeURIComponent(options.orderId).trim() : '';
    const validKind = (rawKind === 'print' || rawKind === 'service') ? rawKind : '';
    this._preselect = (rawId && validKind) ? { orderKind: validKind, orderId: rawId } : null;
    const subscribe = auth && (auth.subscribeSessionChange || auth.onSessionChange);
    this._unsubSession = typeof subscribe === 'function'
      ? subscribe(() => { if (!this._unloaded) this._enforceIdentity(); })
      : null;
    this.setData({ statusBarHeight: (app && app.globalData && app.globalData.statusBarHeight) || 20 });
  },

  /** 会员身份 + 会话代次组合键：同会员登出后重登也会推进代次并作废旧会话响应。 */
  _sessionKey() {
    const base = memberIdentityKey(auth);
    if (!isMemberIdentity(base)) return base;
    const gen = typeof auth.sessionGeneration === 'function' ? auth.sessionGeneration() : 0;
    return `${base}#g${gen}`;
  },

  _resetAll(notice, clearPreselect) {
    this._submitting = false;
    this._submitToken = null;
    if (clearPreselect !== false) this._preselect = null;
    this.setData({
      orders: [],
      nextCursor: null,
      loading: false,
      loadedOnce: false,
      loadingMore: false,
      error: '',
      moreError: '',
      selectedOrder: null,
      form: invoiceModel.emptyInvoiceForm(),
      formError: '',
      submitting: false,
      detailLoading: false,
      detailError: '',
      detail: null,
      identityNotice: notice || '',
    });
  },

  _clearForm(closeSelection) {
    const patch = {
      form: invoiceModel.emptyInvoiceForm(),
      formError: '',
      submitting: false,
    };
    if (closeSelection) patch.selectedOrder = null;
    this.setData(patch);
  },

  /**
   * 核验当前会员身份与会话代次，并在会话变更/失效时立即清场。
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
        ? invoiceModel.INVOICE_COPY.switchedDesc
        : (hadMember && !usable ? invoiceModel.INVOICE_COPY.signedOutDesc : '');
      this._resetAll(notice, hadMember);
      this.setData({ isLoggedIn: usable });
      return { usable, changed: hadMember };
    }
    if (!usable && (this.data.orders.length || this.data.selectedOrder || this.data.detail || this.data.isLoggedIn)) {
      this._resetAll('', true);
      this.setData({ isLoggedIn: false });
      return { usable: false, changed: true };
    }
    return { usable, changed: false };
  },

  _accepts(token) {
    return this._guard.accepts(token, this._sessionKey());
  },

  onShow() {
    this._guard.activate();
    const status = this._enforceIdentity();
    this.setData({ isLoggedIn: status.usable });
    if (status.usable) this._loadOrders(false);
  },

  onHide() {
    this._guard.deactivate();
    this._submitting = false;
    this._submitToken = null;
    this._clearForm(true);
  },

  onUnload() {
    this._unloaded = true;
    if (this._unsubSession) {
      this._unsubSession();
      this._unsubSession = null;
    }
    this._guard.deactivate();
    this._submitting = false;
    this._submitToken = null;
    this._preselect = null;
    // 页面卸载时不调 setData，直接清空内存引用避免敏感字段滞留。
    this.data.form = invoiceModel.emptyInvoiceForm();
    this.data.selectedOrder = null;
    this.data.detail = null;
    this.data.orders = [];
  },

  onPullDownRefresh() {
    const stop = () => wx.stopPullDownRefresh();
    if (!this._enforceIdentity().usable) { stop(); return; }
    this._loadOrders(false).then(stop, stop);
  },

  _loadOrders(append) {
    const status = this._enforceIdentity();
    if (!status.usable || (append && status.changed)) return Promise.resolve();
    if (append && !this.data.nextCursor) return Promise.resolve();
    const token = this._guard.issue('orders');
    const cursor = append ? this.data.nextCursor : null;
    this.setData(append
      ? { loadingMore: true, moreError: '' }
      : { loading: true, error: '', moreError: '' });

    return invoiceApi.listInvoiceOrders({ limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) })
      .then((page) => {
        this._enforceIdentity();
        if (!this._accepts(token)) return;
        const incoming = (Array.isArray(page && page.items) ? page.items : []).map(invoiceModel.toInvoiceOrderView);
        const orders = append ? invoiceModel.mergeInvoiceOrderViews(this.data.orders, incoming) : incoming;
        this.setData({
          orders,
          nextCursor: (page && page.nextCursor) || null,
          loading: false,
          loadedOnce: true,
          loadingMore: false,
          error: '',
          moreError: '',
        });
        this._applyPreselect(orders);
      })
      .catch((err) => {
        this._enforceIdentity();
        if (!this._accepts(token)) return;
        const msg = invoiceModel.describeInvoiceError(
          err,
          append ? invoiceModel.INVOICE_COPY.loadMoreError : invoiceModel.INVOICE_COPY.loadError,
        );
        if (append) {
          this.setData({ loadingMore: false, moreError: msg });
        } else {
          this.setData({ loading: false, loadedOnce: true, error: msg });
        }
      });
  },

  /** 严格按 orderKind + orderId 精确匹配预选订单（分页加载后仍继续查找直到命中或用户手动选择）。 */
  _applyPreselect(orders) {
    const target = this._preselect;
    if (!target) return;
    const match = orders.find((row) => row.orderKind === target.orderKind && row.orderId === target.orderId);
    if (!match) return;
    this._preselect = null;
    if (match.canRequest) {
      this._openFormForOrder(match);
    } else if (match.requestId) {
      this._loadDetail(match.requestId);
    }
  },

  _openFormForOrder(order) {
    if (!order || !order.canRequest) return;
    this.setData({
      selectedOrder: order,
      form: invoiceModel.emptyInvoiceForm(),
      formError: '',
      detail: null,
      detailError: '',
    });
  },

  retryLoad() {
    this._loadOrders(false);
  },

  loadMore() {
    if (this.data.nextCursor && !this.data.loadingMore) {
      this._loadOrders(true);
    }
  },

  openForm(e) {
    const status = this._enforceIdentity();
    if (!status.usable || status.changed) return;
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!key) return;
    const order = this.data.orders.find((row) => row.key === key);
    if (!order || !order.canRequest) return;
    this._preselect = null;
    this._openFormForOrder(order);
  },

  selectTitleType(e) {
    const status = this._enforceIdentity();
    if (!status.usable || status.changed || !this.data.selectedOrder) return;
    const type = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type;
    if (type !== 'personal' && type !== 'company') return;
    const nextForm = Object.assign({}, this.data.form, { titleType: type });
    if (type === 'personal') nextForm.taxId = '';
    this.setData({ form: nextForm, formError: '' });
  },

  onFormInput(e) {
    const status = this._enforceIdentity();
    if (!status.usable || status.changed || !this.data.selectedOrder) return;
    const field = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.field;
    if (field !== 'title' && field !== 'taxId' && field !== 'email') return;
    const val = (e && e.detail && typeof e.detail.value === 'string') ? e.detail.value : '';
    const nextForm = Object.assign({}, this.data.form, { [field]: val });
    this.setData({ form: nextForm, formError: '' });
  },

  cancelForm() {
    this._preselect = null;
    this._clearForm(true);
  },

  submitForm() {
    if (this._submitting) return;
    const status = this._enforceIdentity();
    if (!status.usable || status.changed) return;
    const order = this.data.selectedOrder;
    if (!order) return;
    const check = invoiceModel.validateInvoiceForm({
      orderKind: order.orderKind,
      orderId: order.orderId,
      titleType: this.data.form.titleType,
      title: this.data.form.title,
      taxId: this.data.form.taxId,
      email: this.data.form.email,
    });
    if (!check.ok) {
      this.setData({ formError: check.message });
      return;
    }

    this._submitting = true;
    const token = this._guard.issue('submit');
    this._submitToken = token;
    this.setData({ submitting: true, formError: '' });

    invoiceApi.submitInvoiceRequest(check.payload)
      .then((res) => {
        if (this._submitToken === token) this._submitting = false;
        this._enforceIdentity();
        if (!this._accepts(token)) return;
        // 提交成功立即清空内存表单，绝不持久化税号与邮箱。
        this._clearForm(true);
        wx.showToast({ title: '申请已提交', icon: 'success' });
        this._loadOrders(false);
        if (res && res.id) this._loadDetail(res.id);
      })
      .catch((err) => {
        if (this._submitToken === token) this._submitting = false;
        this._enforceIdentity();
        if (!this._accepts(token)) return;
        const msg = invoiceModel.describeInvoiceError(err, invoiceModel.INVOICE_COPY.submitError);
        this.setData({ submitting: false, formError: msg });
      });
  },

  viewDetail(e) {
    const status = this._enforceIdentity();
    if (!status.usable || status.changed) return;
    const requestId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.requestId;
    if (!requestId) return;
    this._preselect = null;
    this._loadDetail(requestId);
  },

  _loadDetail(requestId) {
    if (!this._enforceIdentity().usable) return;
    const token = this._guard.issue('detail');
    this.setData({ detailLoading: true, detailError: '', detail: null });
    invoiceApi.getInvoiceRequest(requestId)
      .then((raw) => {
        this._enforceIdentity();
        if (!this._accepts(token)) return;
        this.setData({
          detailLoading: false,
          detailError: '',
          detail: invoiceModel.toInvoiceRequestDetailView(raw),
        });
      })
      .catch((err) => {
        this._enforceIdentity();
        if (!this._accepts(token)) return;
        this.setData({
          detailLoading: false,
          detail: null,
          detailError: invoiceModel.describeInvoiceError(err, invoiceModel.INVOICE_COPY.detailError),
        });
      });
  },

  closeDetail() {
    this.setData({ detail: null, detailError: '', detailLoading: false });
  },

  resubmitFromDetail() {
    const status = this._enforceIdentity();
    if (!status.usable || status.changed) return;
    const detail = this.data.detail;
    if (!detail || !detail.canResubmit) return;
    const matched = this.data.orders.find(
      (row) => row.orderKind === detail.orderKind && row.orderId === detail.orderId,
    );
    const target = matched && matched.canRequest
      ? matched
      : {
          key: `${detail.orderKind}:${detail.orderId}`,
          orderKind: detail.orderKind,
          orderKindLabel: detail.orderKindLabel,
          orderId: detail.orderId,
          amountText: detail.amountText,
          canRequest: true,
          invoiceStatus: 'returned',
        };
    this._preselect = null;
    this._openFormForOrder(target);
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/me/me' }); } });
  },

  toLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' });
  },
});
