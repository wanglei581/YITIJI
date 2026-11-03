// pages/ai/ai.js
const app = getApp()
const api = require('../../utils/api')
const auth = require('../../utils/auth')
const storage = require('../../utils/storage')
const entryWays = require('../../utils/resume-optimize-entry')

Page({
  data: {
    statusBarHeight: 20,
    // 按要办的事分成四组（产品负责人 2026-11-03：按推荐重排）。
    // 准备简历 → 改进材料 → 练习面试 → 探索方向。
    // 小青在四组之前；做过的结果在四组之后（AI 服务记录、我的文档）。
    // 只改分组和顺序。各项的名字、说明、图标、配色和跳转保持原样。
    groups: [
      {
        key: 'prepare',
        title: '准备简历',
        sub: '从零填写、语音说，或上传后诊断',
        items: [
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
        ],
      },
      {
        key: 'improve',
        title: '改进材料',
        sub: '改已有简历、对照要求，或按模板自己填',
        items: [
          { id: 'optimize',  icon: 'edit',        title: '简历优化', desc: '改写前后对照可选用', accent: 'teal'  },
          // 原「岗位匹配」：改名「简历对照」，只对照用户自己填写 / 粘贴的职位要求，
          // 不再从平台岗位进入（岗位页已停放，见 compliance-boundary.md §1.1）。
          { id: 'match',     icon: 'link',        title: '简历对照', desc: '粘贴岗位要求，看简历还差什么', accent: 'teal'  },
          // 全程无模型：服务端按模板 + 你填的字段直接渲染 PDF（job-materials.js）。
          // 说明里不写「智能/AI」。页顶的统一声明也不覆盖这一条。
          { id: 'materials', icon: 'form',        title: '材料模板', desc: '自荐信、感谢信、材料清单', accent: 'wheat' },
        ],
      },
      {
        key: 'practice',
        title: '练习面试',
        sub: '按你填的目标出题，做完可以复盘',
        items: [
          { id: 'interview', icon: 'comment',     title: '模拟面试', desc: '按目标岗位出题并复盘',   accent: 'plum'  },
        ],
      },
      {
        key: 'direction',
        title: '探索方向',
        sub: '方向建议和自我了解，只供参考',
        items: [
          { id: 'plan',      icon: 'compass',     title: '职业规划', desc: '方向建议仅供参考',       accent: 'wheat' },
          // 标题按后端口径写「自我探索」——不叫「测评」：测评是资格判定口吻。
          { id: 'explore',   icon: 'aim',         title: '自我探索', desc: '五维倾向参考，非资格评定', accent: 'slate' },
        ],
      },
      // 原「到机器前办」一组（材料包 / 打印订单 / 扫码登录 / U盘）与「发起打印」「今日提醒」
      // 已挪到底部「打印」Tab；「合同审查」「最新动态」随页面停放（首发按非招聘类目提审）。
    ],

    // 我的文档不是 AI 功能，从磁贴组挪到四组之后，和「AI 服务记录」放在一起。
    // 名字、说明、图标、配色和跳转与原来的磁贴相同，不另做一个同义入口。
    documents: { id: 'documents', icon: 'folder', title: '我的文档', desc: '管理材料并再次打印', accent: 'clay' },

    // 页顶统一声明。材料模板由用户自己填、按模板排版，不进这句话的「都由 AI 生成」。
    aiNotice: 'AI 生成，仅供参考：小青的回答，以及生成简历、语音说简历、简历诊断、简历优化、简历对照、模拟面试、职业规划、自我探索的结果，都由 AI 生成，可能有错，请核对后再用。材料模板由你自己填写、按模板排版，不经过 AI。',

    // 页面已经做完、但服务端接口还不存在的能力。
    // 既不能伪装成可用（点下去必然失败），也不该悄悄删掉入口假装从没规划过。
    //
    // 当前为空：最后一条「材料包」已于本轮开放。原因写清楚，避免有人照旧注释把它加回来 ——
    // 那条 why 写的是「服务端下单接口尚未上线」，而 POST /orders/package 早已可用，
    // 真正缺的是「下完单找不回订单」（没有列表端点）。现在 GET /orders/package 已接入
    // 「我的 · 打印订单」的材料包分区，下单后可凭 orderId 重新查回到机码，
    // 因此入口改为真实可用，运行期由服务端错误码 fail-closed（终端离线 / 隐私检查未过 /
    // 价目未配置都会在报价或建单那一步被拒并给出可执行的下一步）。
    pending: [],
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

  onHide() { entryWays.cancelEntry(this, wx) },

  tapEntry(e) {
    const { id } = e.currentTarget.dataset
    if (id === 'optimize') {
      entryWays.openEntry(this, { api, auth, storage, wx })
      return
    }
    const routes = {
      // 删掉这条会怎样：「生成简历」磁贴点下去 url 取到 undefined，
      // wx.navigateTo 不会被调用，卡片变成静默死按钮（用户会以为是自己没点准，
      // 反复去戳）。id 与 groups / documents 里的 id 必须逐字对应。
      build:     '/pages/resume-build/resume-build',
      voice:     '/pages/resume-voice/resume-voice',
      diagnose:  '/pages/resume-diagnose/resume-diagnose',
      optimize:  '/pages/resume-optimize/resume-optimize',
      documents: '/pages/documents/documents',
      materials: '/pages/job-materials/job-materials',
      match:     '/pages/job-fit/job-fit',
      interview: '/pages/interview-entry/interview-entry',
      explore:   '/pages/self-explore/self-explore',
      plan:      '/pages/career-plan/career-plan',
    }
    const url = routes[id]
    if (url) wx.navigateTo({ url })
  },

  tapChat() {
    wx.navigateTo({ url: '/pages/assistant/assistant' })
  },

  // C1：所用模型名称与备案号写在后台发布的「AI 服务说明」里，这里是它的入口。
  openAiDisclaimer() {
    wx.navigateTo({ url: '/pages/legal/legal?type=ai_disclaimer' })
  },

  // C3：投诉入口直接落到「意见反馈」的「AI 内容投诉」类别。
  openAiComplaint() {
    wx.navigateTo({ url: '/pages/feedback/feedback?category=ai_content' })
  },

  toRecords() {
    wx.navigateTo({ url: '/pages/ai-records/ai-records' })
  },

  onShareAppMessage() {
    return {
      title: 'AI 工具 · 简历与面试准备',
      path:  '/pages/ai/ai',
    }
  },
})

