// utils/upload-name.js
// 让上传文件带上「真实且可读」的文件名。
//
// 为什么需要这一层：
//   1. wx.uploadFile 没有设置 multipart 文件名的参数，它固定取 filePath 的 basename。
//      而 wx.chooseMedia / wx.chooseMessageFile 给出的临时路径是 tmp_8a3f… 这类
//      系统生成名，于是服务端 FileObject.filename 存下来的就是这串字母数字，
//      「我的文档」列表读的正是这个字段（GET /me/documents → filename）。
//   2. 文件名不能改走 formData：后端 KioskUploadOptionsDto 只白名单了 purpose 一个字段，
//      配合全局 whitelist + forbidNonWhitelisted，多传任何字段都会整体 400 VALIDATION_FAILED。
//
// 因此唯一能把真实文件名送达服务端的通道，就是先把临时文件按目标名复制到
// USER_DATA_PATH，再上传这个副本——multipart 文件名随之变成目标名。
// 服务端 restoreKioskUtf8Filename() 会把 busboy 按 Latin-1 解出的中文名还原回 UTF-8。
//
// 硬约束：扩展名必须沿用原始临时文件的真实扩展名。后端既校验「扩展名与 MIME 一致」
// （FILE_EXT_MISMATCH），又对真实字节做魔数校验（FILE_CONTENT_MISMATCH），
// 自己臆造扩展名会直接把上传打回。

// 路径分隔符与控制字符不能进文件名；冒号在 Windows 上非法，
// 而打印链路最终落到 Windows 一体机，故一并排除（CLAUDE.md §17 跨平台要求）。
const ILLEGAL_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const MAX_NAME_LENGTH = 80;

/** 取扩展名（小写、不带点）；取不到返回空串。 */
function extOf(value) {
  const clean = String(value || '').split('?')[0].split('#')[0];
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  const base = slash >= 0 ? clean.slice(slash + 1) : clean;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** 取 basename（含扩展名）。 */
function baseOf(value) {
  const clean = String(value || '').split('?')[0].split('#')[0];
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return slash >= 0 ? clean.slice(slash + 1) : clean;
}

/** 清洗成可安全落盘、可安全放进 multipart header 的文件名；无有效内容返回空串。 */
function sanitizeFileName(raw) {
  let name = String(raw || '').replace(ILLEGAL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  name = name.replace(/^\.+/, '').trim();
  if (!name) return '';
  if (name.length > MAX_NAME_LENGTH) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '';
    name = `${name.slice(0, Math.max(1, MAX_NAME_LENGTH - ext.length)).trim()}${ext}`;
  }
  return name;
}

/**
 * 拍照 / 相册来源的可读文件名。
 * 这类文件本来就不存在「原始文件名」，所以不是伪造——是如实描述它的来源和拍摄时间。
 * @param {string} ext 原始临时文件的真实扩展名，必须原样沿用
 */
function cameraFileName(ext, now) {
  const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}时${pad(d.getMinutes())}分`;
  return `拍照文档 ${stamp}.${ext || 'jpg'}`;
}

/**
 * 聊天会话来源的文件名。wx.chooseMessageFile 的 file.name 是用户真实看到的名字，
 * 但扩展名以临时路径为准（真实内容类型由它决定）。
 */
function pickedFileName(originalName, filePath) {
  const pathExt = extOf(filePath);
  const cleaned = sanitizeFileName(originalName);
  if (!cleaned) return pathExt ? `文件.${pathExt}` : '';
  const nameExt = extOf(cleaned);
  if (!pathExt || nameExt === pathExt) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const stem = nameExt && dot > 0 ? cleaned.slice(0, dot) : cleaned;
  return `${stem}.${pathExt}`;
}

/**
 * 把临时文件复制成「目标文件名」的副本，供 wx.uploadFile 使用。
 *
 * 任何一步失败都退回原始路径继续上传——文件名不如实是小问题，
 * 上传失败是大问题。返回的 cleanup() 必须在上传结束（成功或失败）后调用，
 * 否则副本会一直占用小程序本地存储配额。
 *
 * @returns {Promise<{filePath: string, renamed: boolean, cleanup: Function}>}
 */
function prepareNamedFile(filePath, desiredName) {
  const noop = () => {};
  const fallback = { filePath, renamed: false, cleanup: noop };
  return new Promise((resolve) => {
    const name = sanitizeFileName(desiredName);
    if (!filePath || !name) { resolve(fallback); return; }
    if (baseOf(filePath) === name) { resolve({ filePath, renamed: true, cleanup: noop }); return; }

    const root = (typeof wx !== 'undefined' && wx.env && wx.env.USER_DATA_PATH) || '';
    let fsm = null;
    try { fsm = wx.getFileSystemManager(); } catch (_) { fsm = null; }
    if (!root || !fsm || typeof fsm.copyFileSync !== 'function' || typeof fsm.mkdirSync !== 'function') {
      resolve(fallback);
      return;
    }

    // 每次上传单独建目录：同名文件并发上传不会互相覆盖，清理时整目录删掉即可。
    const dir = `${root}/upload-name/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const removeDir = () => { try { fsm.rmdirSync(dir, true); } catch (_) {} };
    try {
      fsm.mkdirSync(dir, true);
      fsm.copyFileSync(filePath, `${dir}/${name}`);
    } catch (_) {
      removeDir();
      resolve(fallback);
      return;
    }
    resolve({ filePath: `${dir}/${name}`, renamed: true, cleanup: removeDir });
  });
}

module.exports = {
  extOf,
  sanitizeFileName,
  cameraFileName,
  pickedFileName,
  prepareNamedFile,
};
