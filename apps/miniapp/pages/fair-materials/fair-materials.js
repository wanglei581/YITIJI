const app = getApp();
const api = require('../../utils/api');
const N = require('../../utils/normalize');
const fileUrl = require('../../utils/file-url');

// 后端 /job-fairs/:id/materials 的 pageSize 上限是 100(safeInt(sizeStr, 20, 1, 100))。
// 取满说明可能还有下一页,此时页面不得把已载入数说成总数。
const MATERIALS_PAGE_SIZE = 100;

// 类型中文名与 apps/kiosk/src/types/fair.ts 的 FAIR_MATERIAL_TYPE_LABELS 保持同名：
// 同一份资料用户在手机上看到「展馆地图」，走到一体机前也要能认出是同一份，
// 两端各起一个名字会让现场对不上。
const TYPE_VIEW = {
  schedule: { label: '活动日程', icon: 'i-calendar', ic: 'a-teal', chip: 'teal' },
  venue_map: { label: '展馆地图', icon: 'i-map', ic: 'a-wheat', chip: 'wheat' },
  company_list: { label: '企业名册', icon: 'i-bank', ic: 'a-plum', chip: 'plum' },
  position_list: { label: '岗位汇总', icon: 'i-briefcase', ic: 'a-clay', chip: 'clay' },
  brochure: { label: '宣传手册', icon: 'i-file-text', ic: 'a-slate', chip: '' },
  other: { label: '其他资料', icon: 'i-folder', ic: 'a-ink', chip: '' },
};

// 服务端只接收 PDF / PNG / JPEG(fair-material.service.ts 的 MATERIAL_ALLOWED_MIME)，
// 但 FairMaterialDTO 不带 mimeType，判型只能靠微信下载后落地的临时文件名。
const IMAGE_EXT = ['png', 'jpg', 'jpeg'];

function extOf(filePath) {
  const clean = String(filePath || '').split('?')[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1).toLowerCase().slice(0, 8);
}

/**
 * pageCount 由管理员在后台手填(admin-fair.dto.ts:195「缺省 0=未知」)，
 * 不是服务端解析出来的真实分页。显示「0 页」会让人以为文件是空的，
 * 所以 0 一律说成未标注。
 */
function pagesText(n) {
  const p = Number(n);
  return Number.isFinite(p) && p > 0 ? `${p} 页` : '页数未标注';
}

function sizeText(kb) {
  const n = Number(kb);
  if (!Number.isFinite(n) || n <= 0) return '大小未知';
  return n >= 1024 ? `${(n / 1024).toFixed(1)} MB` : `${Math.round(n)} KB`;
}

/**
 * 签名 URL 自带 expires(毫秒时间戳，见 fair-material-signing.ts)。
 * 本地读出来就能在发起下载前判掉过期，省一次注定 401 的请求，
 * 也才能给出「链接过期」这个准确原因而不是笼统的网络错误。
 * 有效期长度由服务端决定，页面不写死时长——服务端调了 TTL，写死的话这里就开始说谎。
 */
function expiresAtOf(url) {
  const m = /[?&]expires=(\d+)/.exec(String(url || ''));
  if (!m) return 0;
  const ms = Number(m[1]);
  return Number.isFinite(ms) ? ms : 0;
}

Page({
  _seq: 0,
  // 签名预览地址只挂实例、不进 data：带 sig 的地址没必要渲染进视图层，
  // 而且它随时会过期，作为渲染数据本身就没有意义。刷新时整体重建。
  _previews: {},
  _gone: false,

  // truncated 见 load():取满上限时页面文案必须改口


  data: {
    truncated: false,
    statusBarHeight: 20,
    fairId: '',
    // phase: loading=首次/刷新请求中 | error=请求失败 | empty=本场没有已发布资料 | ready=有资料
    phase: 'loading',
    loadError: '',
    list: [],
    // 同一时刻只允许一份资料在生成打印文件 / 打开预览，避免重复触发服务端渲染与重复跳转
    printingId: '',
    openingId: '',
  },

  onLoad(opts) {
    const fairId = (opts && opts.fairId) || '';
    this.setData({
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      fairId,
    });
    this.load();
  },

  onUnload() {
    this._gone = true;
    this._seq += 1;
  },

  load() {
    const fairId = this.data.fairId;
    if (!fairId) {
      this.setData({ phase: 'error', loadError: '缺少招聘会参数，请从招聘会详情页进入' });
      return Promise.resolve();
    }
    const seq = ++this._seq;
    this.setData({ phase: 'loading', loadError: '' });
    // 不传 pageSize 会吃到后端默认 20(jobs.controller.ts 的 safeInt(sizeStr, 20, 1, 100)),
    // 第 21 份之后既看不到也没有提示。取满上限 100,取到 100 说明可能还有,
    // 此时不能把已载入数当总数说。
    return api.getFairMaterials(fairId, { pageSize: MATERIALS_PAGE_SIZE }).then((list) => {
      // 取满一页就不能宣称这是全部。没有可信 total 时(request.js 解包只留
      // body.pagination),宁可说「已显示前 N 份」也不谎报「共 N 份」。
      this.setData({ truncated: Array.isArray(list) && list.length >= MATERIALS_PAGE_SIZE });
      if (seq !== this._seq || this._gone) return;
      const rows = Array.isArray(list) ? list : [];
      this._previews = {};
      const view = rows.map((m) => this._toView(m));
      // 不在这里重置 printingId / openingId：下拉刷新可能发生在一次打印文件生成的中途，
      // 顺手清空会让那枚按钮重新变成可点，用户点第二次就是又一次服务端渲染。
      // 这两个状态一律由各自的 _finish* 收尾。
      this.setData({ list: view, phase: view.length ? 'ready' : 'empty' });
    }).catch((err) => {
      if (seq !== this._seq || this._gone) return;
      const msg = err && err.statusCode === 404
        ? '未找到该招聘会，可能已下线'
        : (err && err.message) || '加载失败，请稍后重试';
      this.setData({ phase: 'error', loadError: msg });
    });
  },

  _toView(m) {
    const t = TYPE_VIEW[(m && m.type) || 'other'] || TYPE_VIEW.other;
    const id = (m && m.id) || '';
    const raw = m && m.previewUrl;
    if (id && raw) {
      // 服务端签的是相对路径(/api/v1/...)，wx.downloadFile 只吃绝对地址，必须补回源站。
      this._previews[id] = { url: fileUrl.absoluteUrl(raw), expiresAt: expiresAtOf(raw) };
    }
    const printed = Number(m && m.printCount);
    return {
      id,
      name: (m && m.name) || '未命名资料',
      typeLabel: t.label,
      icon: t.icon,
      ic: t.ic,
      chip: t.chip,
      description: (m && m.description) || '',
      pagesText: pagesText(m && m.pageCount),
      sizeText: sizeText(m && m.fileSizeKB),
      updatedText: N.dateTime(m && m.updatedAt) || '',
      // printCount 统计的是这份资料被所有人打印的累计次数，不是当前用户打印过几次，
      // 所以文案必须是「累计」。另：后端目前没有出纸完成后递增它的写路径
      // (services/api 内只有读取与聚合)，真实数据恒为 0，因此只在 >0 时才显示——
      // 摆一个恒为 0 的计数既不实也没有决策价值。
      printedText: Number.isFinite(printed) && printed > 0 ? `累计被打印 ${printed} 次` : '',
      canPrint: (m && m.allowPrint) === true,
      canPreview: !!(id && raw),
    };
  },

  reload() {
    this.load();
  },

  onPullDownRefresh() {
    const stop = () => wx.stopPullDownRefresh();
    this.load().then(stop, stop);
  },

  goBack() {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/home/home' }) } });
  },

  // ── 预览 ──────────────────────────────────────────────────────────────────

  tapPreview(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.openingId) return;
    const info = this._previews[id];
    if (!info || !info.url) {
      wx.showToast({ title: '该资料暂无预览链接', icon: 'none' });
      return;
    }
    if (info.expiresAt && Date.now() >= info.expiresAt) {
      this._previewExpired();
      return;
    }
    this.setData({ openingId: id });
    wx.showLoading({ title: '正在打开资料…', mask: true });
    wx.downloadFile({
      url: info.url,
      success: (dl) => {
        // 大文件下载耗时长。用户中途退出后仍执行 _openLocal，会在他当前所在的
        // 任意页面强行弹出文档预览。
        if (this._gone) { wx.hideLoading(); return; }
        // 签名失效时 serveMaterialContent 一律回 401(不区分原因，防探测)，
        // 所以 401/403 只可能是链接过期或被撤销，给用户可执行的下一步而不是错误码。
        if (dl.statusCode === 401 || dl.statusCode === 403) {
          this._finishPreview();
          this._previewExpired();
          return;
        }
        if (dl.statusCode !== 200) {
          this._finishPreview();
          this._previewFailed(`服务端返回 ${dl.statusCode}，暂时无法打开这份资料。`);
          return;
        }
        this._openLocal(dl.tempFilePath);
      },
      fail: (err) => {
        if (this._gone) { wx.hideLoading(); return; }
        this._finishPreview();
        this._previewFailed(fileUrl.readableDownloadError(err && err.errMsg));
      },
    });
  },

  // 资料名是管理员填的展示名(admin-fair.dto.ts 只限长度，不要求带扩展名)，
  // 判型只能用微信下载后给出的临时文件名；判错时图片与文档互为兜底，
  // 而不是直接甩一句打不开——用户手上确实已经有一份能看的文件。
  _openLocal(filePath) {
    const ext = extOf(filePath);
    if (IMAGE_EXT.indexOf(ext) >= 0) {
      this._previewImage(filePath);
      return;
    }
    const params = {
      filePath,
      showMenu: true,
      success: () => this._finishPreview(),
      fail: () => this._previewImage(filePath),
    };
    if (ext === 'pdf') params.fileType = 'pdf';
    wx.openDocument(params);
  },

  _previewImage(filePath) {
    wx.previewImage({
      urls: [filePath],
      current: filePath,
      success: () => this._finishPreview(),
      fail: () => {
        this._finishPreview();
        this._previewFailed('微信自带阅读器无法打开这份资料，可到门店终端查看。');
      },
    });
  },

  _finishPreview() {
    wx.hideLoading();
    if (this._gone) return;
    this.setData({ openingId: '' });
  },

  _previewExpired() {
    wx.showModal({
      title: '无法打开资料',
      content: '预览链接已过期，请下拉刷新本页后重新打开。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  _previewFailed(content) {
    wx.showModal({ title: '无法打开资料', content, showCancel: false, confirmText: '知道了' });
  },

  // ── 打印 ──────────────────────────────────────────────────────────────────

  tapPrint(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.printingId) return;
    const fairId = this.data.fairId;
    this.setData({ printingId: id });
    wx.showLoading({ title: '正在生成打印文件…', mask: true });
    api.prepareFairMaterialPrint(fairId, id).then((res) => {
      // _finishPrint 只是跳过 setData，调用方仍会 navigateTo——
      // 用户等不及返回后，照样会被拖进打印下单流程。
      if (this._gone) { wx.hideLoading(); return; }
      this._finishPrint();
      const fid = encodeURIComponent((res && res.fileId) || '');
      // 没拿到 fileId 还往下跳，用户会停在一张没有文件的参数页上只能返回重来，
      // 不如在这里说清楚这次没生成成功。
      if (!fid) {
        this._printFailed('服务端未返回可打印文件，请稍后重试。');
        return;
      }
      const name = encodeURIComponent((res && res.filename) || '活动资料.pdf');
      const pages = (res && res.pageCount) || '';
      wx.navigateTo({ url: `/pages/print-upload/print-upload?name=${name}&fileId=${fid}&pages=${pages}` });
    }).catch((err) => {
      if (this._gone) { wx.hideLoading(); return; }
      this._finishPrint();
      if (err && err.statusCode === 401) {
        this._printNeedLogin();
        return;
      }
      // 后端这条链的报错本身就是给人看的中文(如「资料不存在、未发布或暂不开放打印」
      // 「打印文件正在准备，请稍后重试」)，直接透出比另编一句更准。
      this._printFailed((err && err.message) || '打印文件生成失败，请稍后重试。');
    });
  },

  _finishPrint() {
    wx.hideLoading();
    if (this._gone) return;
    this.setData({ printingId: '' });
  },

  _printFailed(content) {
    wx.showModal({ title: '暂时无法生成打印文件', content, showCancel: false, confirmText: '知道了' });
  },

  // launch.js 的 LOGIN_RETURN_ROUTES 白名单不含本页，传 returnTo 会被静默丢弃，
  // 所以只能如实说「返回本页重试」，不承诺登录后自动跳回来。
  _printNeedLogin() {
    wx.showModal({
      title: '需要先登录',
      content: '生成打印文件需要登录账号，登录后请返回本页重新点击。',
      confirmText: '去登录',
      cancelText: '暂不',
      success: (r) => {
        if (r.confirm) wx.navigateTo({ url: '/pages/launch/launch' });
      },
    });
  },
});
