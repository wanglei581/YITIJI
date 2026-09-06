// pages/ai/ai.js
const app = getApp()

Page({
  data: {
    statusBarHeight: 20,
    // 按「用户此刻在什么处境」分组，而不是按「这是不是 AI」分组。
    // 用户不会想「我要用一个 AI 工具」，他想的是「我明天面试，材料还没弄好」。
    // 三段对应一条真实动线：准备材料 → 想清楚 → 到机器前办完。
    groups: [
      {
        key: 'prepare',
        title: '准备材料',
        sub: '改简历、管文档、发起打印',
        items: [
          // 排在诊断/优化**之前**：那两条都以「你已经有一份简历」为前提，
          // 一份都没有的应届生在这一组里原本无路可走。
          //
          // 删掉这条会怎样：pages/resume-build 立刻变成不可达页面。全仓对它的
          // 唯一其它引用是 ai-records 的记录回看路由，而那个列表在用户成功生成过
          // 一次之前是空的——「要先有记录才能进页面，要进页面才能产生记录」。
          // 页面本身是完整的（6 段表单 + 服务端 POST /resume/generate，已在
          // scripts/api-contract.json 的 endpoints 里，不是 knownMissing），
          // 所以这不是「功能没做完」，是入口漏接。没有门禁能发现这种漏接。
          //
          // desc 写「AI 只润色不编造」而不是「AI 帮你写简历」：后端 DTO 的契约
          // 原文就是「AI 只润色，不编造」，在 service 层强制。入口处先把预期封住，
          // 用户才不会带着「AI 会替我写经历」的期待进去。
          { id: 'build',     icon: 'plus',        title: '生成简历', desc: '从零填写，AI 只润色不编造', accent: 'cyan'  },
          { id: 'voice',     icon: 'comment',     title: '语音说简历', desc: '一题一问，看字确认再生成', accent: 'plum'  },
          { id: 'diagnose',  icon: 'file-search', title: '简历诊断', desc: '逐条给出问题与依据', accent: 'plum'  },
          { id: 'optimize',  icon: 'edit',        title: '简历优化', desc: '改写前后对照可选用', accent: 'teal'  },
          // 放「准备材料」而不是 AI 组：这条链全程无模型，服务端按模板 + 你填的字段
          // 直接渲染 PDF。desc 也不写「智能/AI」——写了就是伪造。
          { id: 'materials', icon: 'form',        title: '材料模板', desc: '自荐信、感谢信、材料清单', accent: 'wheat' },
          { id: 'documents', icon: 'folder',      title: '我的文档', desc: '管理材料并再次打印', accent: 'clay'  },
          { id: 'print',     icon: 'printer',     title: '发起打印', desc: '选文档、终端与参数', accent: 'cyan'  },
        ],
      },
      {
        key: 'decide',
        title: '想清楚再决定',
        sub: '岗位、面试、方向',
        items: [
          { id: 'contract',  icon: 'file-search', title: '合同审查', desc: '拍照逐条提示需留意条款', accent: 'clay'  },
          { id: 'match',     icon: 'link',    title: '岗位匹配', desc: '三档参考，不代表录用结果', accent: 'teal'  },
          { id: 'interview', icon: 'comment', title: '模拟面试', desc: '按岗位出题并复盘',       accent: 'plum'  },
          { id: 'plan',      icon: 'compass', title: '职业规划', desc: '方向建议仅供参考',       accent: 'wheat' },
          // 放「想清楚再决定」而不是另起一组：它和岗位匹配/职业规划一样，
          // 产出的是帮你做判断的参考，不是可交付的材料。
          // 标题按后端口径写「自我探索」——不叫「测评」：测评是资格判定口吻。
          { id: 'explore',   icon: 'aim',     title: '自我探索', desc: '五维倾向参考，非资格评定', accent: 'slate' },
          { id: 'community', icon: 'comment', title: '最新动态', desc: '政策、权益与平台通知', accent: 'teal' },
          { id: 'daily',     icon: 'file-text', title: '今日提醒', desc: '到机码、招聘会与当日新增', accent: 'wheat' },
        ],
      },
      {
        key: 'onsite',
        title: '到机器前办',
        sub: '到机码、扫码登录、U盘',
        items: [
          { id: 'orders',    icon: 'history', title: '打印订单',   desc: '到机码与出纸状态',   accent: 'clay'  },
          { id: 'kiosk',     icon: 'scan',    title: '扫码登录',   desc: '连接现场服务终端',   accent: 'teal'  },
          { id: 'usb',       icon: 'printer', title: 'U盘打印指引', desc: '现场导入与打印步骤', accent: 'wheat' },
        ],
      },
    ],

    // 页面已经做完、但服务端接口还不存在的能力。
    // 既不能伪装成可用（点下去必然失败），也不该悄悄删掉入口假装从没规划过。
    pending: [
      {
        id: 'package',
        icon: 'folder',
        title: '材料包',
        desc: '一次备齐多份材料再到机器打印',
        why: '服务端下单接口尚未上线',
        reason: '页面已完成，但服务端 POST /orders/package 尚未实现，现在下单必然失败，所以入口不放开。接口上线后本功能会直接开放。',
      },
    ],
  },

  onLoad() {
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  // 能力禁用要可解释：不使用原生 disabled，条目仍可点、可聚焦，
  // 点开直接说明缺的是哪个后端接口，而不是一句「敬请期待」。
  tapPending(e) {
    const item = (this.data.pending || []).find((p) => p.id === e.currentTarget.dataset.id)
    if (!item) return
    wx.showModal({
      title: `${item.title} · 尚未开放`,
      content: item.reason,
      showCancel: false,
      confirmText: '知道了',
    })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
  },

  tapEntry(e) {
    const { id } = e.currentTarget.dataset
    const routes = {
      // 删掉这条会怎样：上面 groups.prepare 的「生成简历」磁贴点下去 url 取到
      // undefined，wx.navigateTo 不会被调用，卡片变成静默死按钮（用户会以为是
      // 自己没点准，反复去戳）。id 与 groups 里的 id 必须逐字对应。
      build:     '/pages/resume-build/resume-build',
      voice:     '/pages/resume-voice/resume-voice',
      diagnose:  '/pages/resume-diagnose/resume-diagnose',
      optimize:  '/pages/resume-optimize/resume-optimize',
      documents: '/pages/documents/documents',
      materials: '/pages/job-materials/job-materials',
      print:     '/pages/print/print',
      contract:  '/pages/contract-review/contract-review',
      match:     '/pages/job-fit/job-fit',
      interview: '/pages/interview-entry/interview-entry',
      explore:   '/pages/self-explore/self-explore',
      plan:      '/pages/career-plan/career-plan',
      orders:    '/pages/orders/orders',
      kiosk:     '/pages/kiosk-login/kiosk-login',
      usb:       '/pages/usb-import/usb-import',
      community: '/pages/community/community',
      daily:     '/pages/daily-report/daily-report',
    }
    const url = routes[id]
    if (url) wx.navigateTo({ url })
  },

  tapChat() {
    wx.navigateTo({ url: '/pages/assistant/assistant' })
  },

  toRecords() {
    wx.navigateTo({ url: '/pages/ai-records/ai-records' })
  },

  onShareAppMessage() {
    return {
      title: '职业生活圈 · 求职与社区',
      path:  '/pages/ai/ai',
    }
  },
})

