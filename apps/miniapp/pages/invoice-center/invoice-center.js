// pages/invoice-center/invoice-center.js
// 会员自助开票中心（一页一分包）。
// 严格禁止将税号、邮箱或表单草稿写入 wx.setStorageSync / 本地缓存：
// 表单仅驻留页面内存，提交成功、取消、切后台（onHide）、离页（onUnload）或切换账号时立即清空。

const app = getApp();
const auth = require('../../utils/auth');
const invoiceApi = require('../../utils/api-invoice');
const invoiceModel = require('../../utils/invoice-model');
const { createLifecycleGuard, memberIdentityKey, isMemberIdentity } = require('../../utils/page-guard');

const PAGE_LIMIT = 20;

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
    this._guard = createLifecycleGuard();
    this._guard.activate();
    this._submitting = false;
    const rawKind = options && typeof options.orderKind === 'string' ? options.orderKind.trim() : '';
    const rawId = options && typeof options.orderId === 'string' ? decodeURIComponent(options.orderId).trim() : '';
    this._preselect = rawId
      ? { orderKind: rawKind === 'service' ? 'service' : 'print', orderId: rawId }
      : null;
    this.setData({ statusBarHeight: (app && app.globalData && app.globalData.statusBarHeight) || 20 });
  },

  _identityKey() {
    return memberIdentityKey(auth);
  },

  _resetAll(notice, clearPreselect) {
    this._submitting = false;
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

  _enforceIdentity() {
    const identity = this._identityKey();
    const usable = isMemberIdentity(identity);
    const prevIdentity = this._guard.identity();
    if (this._guard.setIdentity(identity)) {
      const switched = isMemberIdentity(prevIdentity) && isMemberIdentity(identity) && prevIdentity !== identity;
      const notice = switched
        ? invoiceModel.INVOICE_COPY.switchedDesc
        : (isMemberIdentity(prevIdentity) && !usable ? invoiceModel.INVOICE_COPY.signedOutDesc : '');
      this._resetAll(notice, isMemberIdentity(prevIdentity));
      this.setData({ isLoggedIn: usable });
      return usable;
    }
    if (!usable && (this.data.orders.length || this.data.selectedOrder || this.data.detail || this.data.isLoggedIn)) {
      this._resetAll('');
      this.setData({ isLoggedIn: false });
    }
    return usable;
  },

  _accepts(token) {
    return this._guard.accepts(token, this._identityKey());
  },

  onShow() {
    this._guard.activate();
    const usable = this._enforceIdentity();
    this.setData({ isLoggedIn: usable });
    if (usable) this._loadOrders(false);
  },

  onHide() {
    this._guard.deactivate();
    this._submitting = false;
    this._clearForm(true);
  },

  onUnload() {
    this._guard.deactivate();
    this._submitting = false;
    this._preselect = null;
    // 页面卸载时不调 setData，直接清空内存引用避免敏感字段滞留。
    this.data.form = invoiceModel.emptyInvoiceForm();
    this.data.selectedOrder = null;
    this.data.detail = null;
    this.data.orders = [];
  },

  onPullDownRefresh() {
    const stop = () => wx.stopPullDownRefresh();
    if (!this._enforceIdentity()) { stop(); return; }
    this._loadOrders(false).then(stop, stop);
  },

  _loadOrders(append) {
    if (!this._enforceIdentity()) return Promise.resolve();
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
        if (!append) this._applyPreselect(orders);
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

  _applyPreselect(orders) {
    const target = this._preselect;
    if (!target) return;
    const match = orders.find((row) => row.orderId === target.orderId && row.orderKind === target.orderKind)
      || orders.find((row) => row.orderId === target.orderId);
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
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!key) return;
    const order = this.data.orders.find((row) => row.key === key);
    if (!order || !order.canRequest) return;
    this._openFormForOrder(order);
  },

  selectTitleType(e) {
    const type = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type;
    if (type !== 'personal' && type !== 'company') return;
    const nextForm = Object.assign({}, this.data.form, { titleType: type });
    if (type === 'personal') nextForm.taxId = '';
    this.setData({ form: nextForm, formError: '' });
  },

  onFormInput(e) {
    const field = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.field;
    if (field !== 'title' && field !== 'taxId' && field !== 'email') return;
    const val = (e && e.detail && typeof e.detail.value === 'string') ? e.detail.value : '';
    const nextForm = Object.assign({}, this.data.form, { [field]: val });
    this.setData({ form: nextForm, formError: '' });
  },

  cancelForm() {
    this._clearForm(true);
  },

  submitForm() {
    if (this._submitting || !this.data.selectedOrder) return;
    if (!this._enforceIdentity()) return;
    const order = this.data.selectedOrder;
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
    const requestId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.requestId;
    if (!requestId) return;
    this._loadDetail(requestId);
  },

  _loadDetail(requestId) {
    if (!this._enforceIdentity()) return;
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
    this._openFormForOrder(target);
  },

  back() {
    wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/me/me' }); } });
  },

  toLogin() {
    wx.navigateTo({ url: '/pages/launch/launch' });
  },
});
