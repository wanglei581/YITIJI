// utils/file-url.js
// 服务端签名文件链接的绝对化，以及「打开一份本人文件」的共用流程。
//
// services/api/src/files/signing.ts 的 signFileUrl() 返回的是**相对路径**
// （/api/v1/files/:id/content?...），而 wx.downloadFile / wx.previewImage /
// wx.openDocument 只接受绝对地址。直接把服务端返回值丢给这些 API 必然失败。
//
// 抽成共享工具而非各页自写：print-preview 与 documents 都需要它，
// 两处各写一份迟早漂移——本项目今天已因硬编码清单漂移吃过亏。
const config = require('./config');

function absoluteUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${config.baseUrl}${raw.charAt(0) === '/' ? '' : '/'}${raw}`;
}

/**
 * wx.downloadFile 失败时给出可读原因。
 * 未在公众平台配置「downloadFile 合法域名」是最常见的原因，
 * 而微信原始报错对用户毫无意义。
 */
function readableDownloadError(errMsg) {
  const text = String(errMsg || '');
  if (/domain list|合法域名|not in domain/i.test(text)) {
    return '暂时无法打开原文：该功能需要在小程序后台配置下载域名。你仍可返回列表重新发起打印。';
  }
  return '打开原文失败，请检查网络后重试。';
}

// ── 打开一份本人文件（PDF / Office）──────────────────────────────────────────
// 预览链接是服务端现签的短期链接（services/api/src/files/files.service.ts getAccessUrl）：
// 存储在 COS 时是 COS 预签名地址，本地存储时是 /content 的 HMAC 地址；有效期取
// TENCENT_COS_SIGN_URL_EXPIRES_SECONDS（最长 30 分钟），文件快到期时更短。过期后
// 本地存储回 401、COS 回 403。页面进来时取的链接可能已经过期，所以每次打开前都现取一条；
// 下载回 401 / 403 时再重取一次，只重取一次，不循环。
// 注意：COS 预签名地址的域名也要在公众平台「downloadFile 合法域名」里，否则 downloadFile
// 直接失败（errMsg 含 url not in domain list），这一类按 domain 归类，不重试。
// 链接本身不显示、不写日志；不使用任何公开的永久地址。
// wx 由调用方传入（页面传自己的 wx），这样页面和测试用的是同一份实现。

const OPENABLE_DOC_TYPES = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];

const MIME_DOC_TYPES = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

const PREVIEW_FAILURE_TEXT = {
  domain: '小程序后台还没有配置文件下载域名，暂时无法打开原文。可以先返回，到一体机上查看或打印。',
  expired: '预览链接已过期，重新获取后仍没有打开。请返回后重新进入再试。',
  denied: '没有权限查看这份文件，或者文件已经被清理。',
  timeout: '下载原文超时，请检查网络后重试。',
  unsupported: '微信自带阅读器打不开这种文件。',
  network: '打开原文失败，请检查网络后重试。',
  noUrl: '服务端没有返回可用的预览链接，请稍后重试。',
  fetch: '预览链接获取失败，请稍后重试。',
};

function extOfName(name) {
  const clean = String(name || '').split('?')[0].trim();
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1).toLowerCase().slice(0, 8);
}

/** 交给 wx.openDocument 的 fileType：先看服务端 mime，再看文件名，最后看下载下来的临时文件。认不出就不传。 */
function openableTypeOf(meta) {
  const m = meta || {};
  const mime = String(m.mimeType || '').split(';')[0].trim().toLowerCase();
  if (MIME_DOC_TYPES[mime]) return MIME_DOC_TYPES[mime];
  const byName = extOfName(m.name);
  if (OPENABLE_DOC_TYPES.indexOf(byName) >= 0) return byName;
  const byTemp = extOfName(m.tempFilePath);
  if (OPENABLE_DOC_TYPES.indexOf(byTemp) >= 0) return byTemp;
  return '';
}

/** 下载结果归类。downloadFile 的 fail 只带 errMsg；success 带 statusCode。 */
function classifyDownload(result) {
  if (result.failed) {
    const text = String(result.errMsg || '');
    if (/domain list|合法域名|not in domain/i.test(text)) return 'domain';
    if (/timeout/i.test(text)) return 'timeout';
    return 'network';
  }
  if (result.statusCode === 401 || result.statusCode === 403) return 'expired';
  if (result.statusCode === 404 || result.statusCode === 410) return 'denied';
  return 'network';
}

/** 取链接失败：request 层已经给了中文原因（未登录、文件不存在等）就照用；英文原话不给用户看。 */
function readableFetchError(err) {
  const msg = err && err.message ? String(err.message) : '';
  if (/[一-龥]/.test(msg)) return msg;
  return PREVIEW_FAILURE_TEXT.fetch;
}

function downloadOnce(wxApi, url) {
  return new Promise((resolve) => {
    wxApi.downloadFile({
      url,
      success: (dl) => resolve({ failed: false, statusCode: dl && dl.statusCode, tempFilePath: dl && dl.tempFilePath }),
      fail: (e) => resolve({ failed: true, errMsg: (e && e.errMsg) || '' }),
    });
  });
}

function openDownloaded(wxApi, tempFilePath, meta) {
  return new Promise((resolve) => {
    const params = {
      filePath: tempFilePath,
      showMenu: true,
      success: () => resolve({ ok: true }),
      fail: () => resolve({ ok: false, kind: 'unsupported', text: PREVIEW_FAILURE_TEXT.unsupported }),
    };
    const fileType = openableTypeOf({ mimeType: meta.mimeType, name: meta.name, tempFilePath });
    if (fileType) params.fileType = fileType;
    wxApi.openDocument(params);
  });
}

/**
 * 打开一份本人文件。fetchUrl() 每调一次都要向服务端现取一条签名预览链接（返回 { url }）。
 * 返回 Promise<{ ok: true } | { ok: false, kind, text }>，不会 reject；text 是可以直接给用户看的中文。
 * @param {{ wx: object, fetchUrl: () => Promise<object>, name?: string, mimeType?: string }} options
 */
function openSignedDocument(options) {
  const opts = options || {};
  const wxApi = opts.wx;
  const meta = { name: opts.name || '', mimeType: opts.mimeType || '' };
  const attempt = (refetchesLeft) => Promise.resolve()
    .then(() => opts.fetchUrl())
    .then((res) => {
      const url = absoluteUrl(res && (res.url || res.previewUrl));
      if (!url) return { ok: false, kind: 'noUrl', text: PREVIEW_FAILURE_TEXT.noUrl };
      return downloadOnce(wxApi, url).then((dl) => {
        if (!dl.failed && dl.statusCode === 200) return openDownloaded(wxApi, dl.tempFilePath, meta);
        const kind = classifyDownload(dl);
        if (kind === 'expired' && refetchesLeft > 0) return attempt(refetchesLeft - 1);
        return { ok: false, kind, text: PREVIEW_FAILURE_TEXT[kind] };
      });
    }, (err) => ({ ok: false, kind: 'fetch', text: readableFetchError(err) }));
  // 兜底：wx 接口同步抛错时也要回一个结果，调用方据此收起「正在打开」，不能卡在加载态。
  return attempt(1).catch(() => ({ ok: false, kind: 'network', text: PREVIEW_FAILURE_TEXT.network }));
}

module.exports = {
  absoluteUrl,
  readableDownloadError,
  openSignedDocument,
  openableTypeOf,
  PREVIEW_FAILURE_TEXT,
};
