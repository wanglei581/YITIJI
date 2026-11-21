// utils/invoice-model.js
// 会员自助开票纯逻辑模块（零 wx 依赖，可直接由 Node 单元测试执行）。
// 校验口径与后端 services/api/src/invoices/invoice-title.ts 及 licenses/credit-code.ts 同源。

const { userMessageOf } = require('./user-error');

const USCC_CHARSET = '0123456789ABCDEFGHJKLMNPQRTUWXY';
const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
const USCC_FORMAT = /^[0-9A-HJ-NPQRTUWXY]{18}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INVOICE_COPY = {
  pageTitle: '自助开票',
  subtitle: '为本人实付大于 0 的订单申请电子发票（普通发票）',
  loginTitle: '请先登录小程序',
  loginDesc: '登录后可查看本人付费订单并申请电子发票',
  emptyTitle: '暂无可开票订单',
  emptyDesc: '目前没有需要开发票的付费订单。免费订单或已退款订单不能开票。',
  switchedTitle: '账号已切换',
  switchedDesc: '当前账号已变更，已清空页面表单与开票记录，请重新查看本人订单。',
  signedOutDesc: '登录已失效，请重新登录后查看可开票订单。',
  amountLabel: '实付金额',
  privacyNote: '抬头、税号和邮箱仅在本次提交时发送到服务端，不会保存在本机缓存。个人不需要提供身份证号。',
  specialNote: '开出的是电子发票（普通发票），开好后发送到填写的邮箱。如需专用发票，请拨打服务电话（号码在首页底部「经营者信息」里）。',
  submitSuccess: '开票申请已提交，开好后电子发票将发到你填写的邮箱',
  detailLoading: '正在读取开票申请详情…',
  loadError: '开票订单加载失败，请稍后重试',
  loadMoreError: '更多订单加载失败，请重试',
  submitError: '开票申请提交失败，请检查填写内容后重试',
  detailError: '开票申请详情读取失败，请稍后重试',
  titlePersonalLabel: '个人姓名',
  titleCompanyLabel: '单位名称',
  titlePersonalPlaceholder: '请输入个人姓名',
  titleCompanyPlaceholder: '请输入单位名称（80 字以内）',
  taxIdLabel: '统一社会信用代码',
  taxIdPlaceholder: '18 位数字与大写字母（含校验位）',
  emailLabel: '接收电子发票邮箱',
  emailPlaceholder: '例如 name@example.com',
  accountUnavailable: '当前账号暂不可用，请确认账号状态后再试',
  notAllowedFallback: '这一单当前不能申请开票',
};

const ORDER_KIND_LABEL = {
  print: '打印订单',
  service: 'AI 服务单',
};

const INVOICE_STATUS_META = {
  none:      { label: '可申请', tone: 'teal' },
  submitted: { label: '已提交', tone: 'wheat' },
  issued:    { label: '已开票', tone: 'ok' },
  returned:  { label: '已退回', tone: 'danger' },
};

/**
 * 统一社会信用代码（GB 32100-2015）：18 位，数字与指定大写字母，末位 mod-31 校验位。
 * 与 services/api/src/licenses/credit-code.ts 保持完全一致。
 */
function normalizeCreditCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!USCC_FORMAT.test(code)) return null;
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    sum += USCC_CHARSET.indexOf(code[i]) * USCC_WEIGHTS[i];
  }
  const check = (31 - (sum % 31)) % 31;
  return USCC_CHARSET[check] === code[17] ? code : null;
}

function isValidInvoiceEmail(value) {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  return email.length > 0 && email.length <= 120 && EMAIL_PATTERN.test(email);
}

function emptyInvoiceForm() {
  return {
    titleType: 'personal',
    title: '',
    taxId: '',
    email: '',
  };
}

/**
 * 校验并构造 POST /me/invoice-requests 请求体。
 * 个人抬头不携带 taxId 字段，避免服务端触发 INVOICE_TAX_ID_FORBIDDEN。
 */
function validateInvoiceForm(input = {}) {
  const orderKind = input.orderKind;
  if (orderKind !== 'print' && orderKind !== 'service') {
    return { ok: false, field: 'order', message: '请先选择要开票的订单。' };
  }
  const orderId = typeof input.orderId === 'string' ? input.orderId.trim() : '';
  if (!orderId || orderId.length > 80) {
    return { ok: false, field: 'order', message: '订单编号无效，请返回重试。' };
  }
  const titleType = input.titleType;
  if (titleType !== 'personal' && titleType !== 'company') {
    return { ok: false, field: 'titleType', message: '抬头要选个人或单位。' };
  }
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) {
    return { ok: false, field: 'title', message: '抬头。个人写姓名，单位写单位名称。' };
  }
  if (title.length > 80) {
    return { ok: false, field: 'title', message: '抬头请控制在 80 个字以内。' };
  }
  const rawTax = typeof input.taxId === 'string' ? input.taxId.trim() : '';
  let normalizedTax = null;
  if (titleType === 'personal') {
    if (rawTax) {
      return { ok: false, field: 'taxId', message: '个人不用填税号。' };
    }
  } else {
    if (!rawTax) {
      return { ok: false, field: 'taxId', message: '单位请填写名称和统一社会信用代码。' };
    }
    normalizedTax = normalizeCreditCode(rawTax);
    if (!normalizedTax) {
      return {
        ok: false,
        field: 'taxId',
        message: '统一社会信用代码需为 18 位（数字与大写字母，末位校验位正确）',
      };
    }
  }
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  if (!isValidInvoiceEmail(email)) {
    return { ok: false, field: 'email', message: '接收邮箱格式不对。电子发票发到这个邮箱。' };
  }
  const payload = { orderKind, orderId, titleType, title, email };
  if (titleType === 'company') payload.taxId = normalizedTax;
  return { ok: true, payload };
}

function formatCentsYuan(amountCents) {
  const n = Number(amountCents);
  if (!Number.isFinite(n) || n < 0) return '—';
  return `¥${(n / 100).toFixed(2)}`;
}

function formatDateTimeLocal(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function toInvoiceOrderView(item = {}) {
  const orderKind = item.orderKind === 'service' ? 'service' : 'print';
  const orderId = String(item.orderId || '');
  const invoiceStatus = Object.prototype.hasOwnProperty.call(INVOICE_STATUS_META, item.invoiceStatus)
    ? item.invoiceStatus
    : 'none';
  const meta = INVOICE_STATUS_META[invoiceStatus];
  const canRequest = item.canRequest === true;
  const requestId = typeof item.requestId === 'string' && item.requestId ? item.requestId : '';
  const statusLabel = (!canRequest && invoiceStatus === 'none') ? '暂不可开' : meta.label;
  const statusTone = (!canRequest && invoiceStatus === 'none') ? 'neutral' : meta.tone;
  return {
    key: `${orderKind}:${orderId}`,
    orderKind,
    orderKindLabel: ORDER_KIND_LABEL[orderKind] || '订单',
    orderId,
    amountCents: Number.isFinite(Number(item.amountCents)) ? Number(item.amountCents) : 0,
    amountText: formatCentsYuan(item.amountCents),
    canRequest,
    blockCode: item.blockCode || null,
    blockMessage: typeof item.blockMessage === 'string' ? item.blockMessage : '',
    invoiceStatus,
    statusLabel,
    statusTone,
    requestId,
    canViewDetail: Boolean(requestId),
    requestButtonLabel: invoiceStatus === 'returned' ? '重新申请开票' : '申请开票',
  };
}

function mergeInvoiceOrderViews(existing, incoming) {
  const seen = new Set();
  const out = [];
  for (const row of [...(existing || []), ...(incoming || [])]) {
    if (!row || !row.key || seen.has(row.key)) continue;
    seen.add(row.key);
    out.push(row);
  }
  return out;
}

/**
 * 申请详情视图：严格只消费服务端打码字段 taxIdMasked / emailMasked，不持有完整税号或邮箱。
 */
function toInvoiceRequestDetailView(raw = {}) {
  const status = Object.prototype.hasOwnProperty.call(INVOICE_STATUS_META, raw.status) ? raw.status : 'submitted';
  const meta = INVOICE_STATUS_META[status];
  const orderKind = raw.orderKind === 'service' ? 'service' : 'print';
  const titleType = raw.titleType === 'company' ? 'company' : 'personal';
  return {
    id: String(raw.id || ''),
    orderKind,
    orderKindLabel: ORDER_KIND_LABEL[orderKind] || '订单',
    orderId: String(raw.orderId || ''),
    titleType,
    titleTypeLabel: titleType === 'company' ? '单位' : '个人',
    title: typeof raw.title === 'string' ? raw.title : '—',
    taxIdMasked: typeof raw.taxIdMasked === 'string' && raw.taxIdMasked ? raw.taxIdMasked : '',
    emailMasked: typeof raw.emailMasked === 'string' && raw.emailMasked ? raw.emailMasked : '',
    amountCents: Number.isFinite(Number(raw.amountCents)) ? Number(raw.amountCents) : 0,
    amountText: formatCentsYuan(raw.amountCents),
    status,
    statusLabel: meta.label,
    statusTone: meta.tone,
    invoiceNo: typeof raw.invoiceNo === 'string' && raw.invoiceNo ? raw.invoiceNo : '',
    returnReason: typeof raw.returnReason === 'string' && raw.returnReason ? raw.returnReason : '',
    issuedAtText: raw.issuedAt ? formatDateTimeLocal(raw.issuedAt) : '',
    createdAtText: formatDateTimeLocal(raw.createdAt),
    canResubmit: status === 'returned',
  };
}

function describeInvoiceError(err, fallback) {
  const code = err && err.code;
  if (code === 'ACCOUNT_UNAVAILABLE') {
    return userMessageOf(err, INVOICE_COPY.accountUnavailable);
  }
  if (code === 'INVOICE_NOT_ALLOWED') {
    return userMessageOf(err, INVOICE_COPY.notAllowedFallback);
  }
  return userMessageOf(err, fallback || INVOICE_COPY.submitError);
}

function buildInvoiceCenterUrl(orderKind, orderId) {
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  if (!id) return '/pages/invoice-center/invoice-center';
  const kind = orderKind === 'service' ? 'service' : 'print';
  return `/pages/invoice-center/invoice-center?orderKind=${encodeURIComponent(kind)}&orderId=${encodeURIComponent(id)}`;
}

module.exports = {
  INVOICE_COPY,
  ORDER_KIND_LABEL,
  INVOICE_STATUS_META,
  normalizeCreditCode,
  isValidInvoiceEmail,
  emptyInvoiceForm,
  validateInvoiceForm,
  formatCentsYuan,
  formatDateTimeLocal,
  toInvoiceOrderView,
  mergeInvoiceOrderViews,
  toInvoiceRequestDetailView,
  describeInvoiceError,
  buildInvoiceCenterUrl,
};
