// utils/file-url.js
// 服务端签名文件链接的绝对化。
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

module.exports = { absoluteUrl, readableDownloadError };
