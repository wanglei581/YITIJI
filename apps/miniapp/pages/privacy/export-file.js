// pages/privacy/export-file.js
// 数据导出件的「取件 + 落地 + 交付」。只服务隐私页，不进 utils/。
//
// 为什么不走 utils/request.js：
//   下载端点 GET /api/v1/member/data-exports/:id/content 是全仓唯一一个
//   「不带 Authorization、只认一次性 ticket 头」的会员端点
//   （services/api/src/member-privacy/member-data-export.controller.ts，无 EndUserAuthGuard），
//   响应体也不是 { success, data } 信封而是导出包本身。
//   套 request() 会被 401 静默补签逻辑和 unwrapEnvelope 一起误伤。
//
// ⚠️ 一次性：服务端在响应写完（response 'finish'）时就把该请求置为已消费
//   （member-data-export-download.service.ts:persistDelivery），成功与否与客户端无关。
//   所以取件前必须先告知用户，取件后必须尽最大努力落地成本地文件。

const config = require('../../utils/config');

const FILE_PREFIX = 'member-data-export-';

/**
 * 从下载授权返回的 downloadUrl 里取出 ticket。
 *
 * 服务端把 ticket 放在 URL fragment 而不是 query（fragment 不会进服务器日志与 Referer）：
 *   `${base}/member/export-download#request=<id>&ticket=<ticket>`
 *   见 member-data-export-download.service.ts:fragmentDownloadUrl
 * 那个 /member/export-download 页面本仓没有任何实现（全仓仅此一处出现该路径），
 * 且小程序也无法直接打开站外网页，所以这里自己解 fragment、自己调内容端点 ——
 * 做的事和那个页面本该做的事完全一样，不是绕过任何校验。
 *
 * @returns {{requestId:string, ticket:string}|null} 解不出或与预期 requestId 不符时返回 null
 */
function parseDownloadUrl(downloadUrl, expectedRequestId) {
  if (typeof downloadUrl !== 'string') return null;
  const hashAt = downloadUrl.indexOf('#');
  if (hashAt < 0) return null;

  const params = {};
  for (const pair of downloadUrl.slice(hashAt + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    try {
      params[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    } catch (_) {
      return null;
    }
  }

  const requestId = params.request;
  const ticket = params.ticket;
  if (!requestId || !ticket) return null;
  if (expectedRequestId && requestId !== expectedRequestId) return null;
  return { requestId, ticket };
}

/**
 * 取导出包内容。
 * @returns {Promise<string>} 导出包 JSON 文本
 */
function fetchExportContent(requestId, ticket) {
  const url = `${config.baseUrl}${config.apiPrefix}/member/data-exports/${encodeURIComponent(requestId)}/content`;
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'GET',
      header: { 'x-member-download-ticket': ticket },
      // 不带 Authorization：该端点不校验会员令牌，只认 ticket。
      timeout: config.uploadTimeout || config.timeout,
      success(res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(readError(res));
          return;
        }
        // 服务端 Content-Type 是 application/json，wx.request 已按 JSON 解析。
        // 重新序列化会丢失原始字节序（键序在实践中保留），但导出件的价值在内容不在字节，
        // 这里顺便格式化，用户拿到的是可读的 JSON。
        try {
          resolve(typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2));
        } catch (_) {
          reject(makeError('导出包内容无法序列化', -1));
        }
      },
      fail(err) {
        reject(makeError((err && err.errMsg) || '下载导出包失败，请检查网络', -1));
      },
    });
  });
}

function readError(res) {
  const body = res && res.data;
  if (body && typeof body === 'object' && body.error && typeof body.error === 'object') {
    return makeError(body.error.message || `下载失败（${res.statusCode}）`, res.statusCode, body.error.code);
  }
  return makeError(`下载失败（${res.statusCode}）`, res.statusCode);
}

function makeError(message, statusCode, code) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (code !== undefined) e.code = code;
  return e;
}

function fs() {
  return wx.getFileSystemManager();
}

/** 导出件落到本机用户目录。返回 { filePath, fileName, sizeBytes }。 */
function saveExportContent(text) {
  const fileName = `${FILE_PREFIX}${formatStamp(new Date())}.json`;
  const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
  return new Promise((resolve, reject) => {
    fs().writeFile({
      filePath,
      data: text,
      encoding: 'utf8',
      success() {
        resolve({ filePath, fileName, sizeBytes: byteLength(text) });
      },
      fail(err) {
        reject(makeError((err && err.errMsg) || '导出包写入本机失败', -1));
      },
    });
  });
}

/** 列出本机已落地的导出件（新的在前）。读不到目录时返回空数组。 */
function listSavedExports() {
  let names = [];
  try {
    names = fs().readdirSync(wx.env.USER_DATA_PATH) || [];
  } catch (_) {
    return [];
  }
  return names
    .filter((name) => typeof name === 'string' && name.indexOf(FILE_PREFIX) === 0)
    .map((fileName) => {
      const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
      let sizeBytes = 0;
      try {
        const stat = fs().statSync(filePath);
        sizeBytes = (stat && stat.size) || 0;
      } catch (_) {
        sizeBytes = 0;
      }
      return { fileName, filePath, sizeBytes, sizeText: formatSize(sizeBytes) };
    })
    .sort((a, b) => (a.fileName < b.fileName ? 1 : -1));
}

/** 删除本机副本。 */
function removeSavedExport(filePath) {
  return new Promise((resolve, reject) => {
    fs().unlink({
      filePath,
      success: () => resolve(true),
      fail: (err) => reject(makeError((err && err.errMsg) || '删除本机副本失败', -1)),
    });
  });
}

/**
 * 把导出件转发到微信聊天（发给「文件传输助手」即可存到手机/电脑）。
 * 基础库 2.16.1 起支持；不支持时 reject，由调用方如实告知并给替代路径。
 */
function shareExportFile(filePath, fileName) {
  if (typeof wx.shareFileMessage !== 'function') {
    return Promise.reject(makeError('当前微信版本不支持转发文件，请升级微信或改用复制内容', -1));
  }
  return new Promise((resolve, reject) => {
    wx.shareFileMessage({
      filePath,
      fileName,
      success: () => resolve(true),
      fail: (err) => reject(makeError((err && err.errMsg) || '转发文件失败', -1)),
    });
  });
}

/** 电脑端微信可直接另存为；手机端不支持时 reject。 */
function saveExportToDisk(filePath) {
  if (typeof wx.saveFileToDisk !== 'function') {
    return Promise.reject(makeError('当前环境不支持另存到磁盘（仅电脑端微信可用）', -1));
  }
  return new Promise((resolve, reject) => {
    wx.saveFileToDisk({
      filePath,
      success: () => resolve(true),
      fail: (err) => reject(makeError((err && err.errMsg) || '另存失败', -1)),
    });
  });
}

/** 读回本机副本文本，用于复制到剪贴板。 */
function readSavedExport(filePath) {
  return new Promise((resolve, reject) => {
    fs().readFile({
      filePath,
      encoding: 'utf8',
      success: (res) => resolve(res.data),
      fail: (err) => reject(makeError((err && err.errMsg) || '读取本机副本失败', -1)),
    });
  });
}

function byteLength(text) {
  // 小程序无 Buffer/TextEncoder 保证可用，按 UTF-8 规则估算，仅用于展示。
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i += 1; }
    else bytes += 3;
  }
  return bytes;
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatStamp(date) {
  const p = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`
    + `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

module.exports = {
  parseDownloadUrl,
  fetchExportContent,
  saveExportContent,
  listSavedExports,
  removeSavedExport,
  shareExportFile,
  saveExportToDisk,
  readSavedExport,
  formatSize,
};
