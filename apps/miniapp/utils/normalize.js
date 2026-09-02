// utils/normalize.js
// 真实后端字段 → 页面绑定字段的适配层。
//
// 背景:mock 数据里内置了一批纯展示字段(icon / bannerStyle / accent / tagTone /
// metaLines 等),后端没有这些概念;同时后端字段名与页面绑定名不一致
// (sourceName vs source、syncTime vs time、name vs title、description vs duties)。
// 直接把后端对象丢给页面会出现大面积空白绑定。
//
// 原则:
//   1. 只做字段改名与「由真实字段推导」的展示派生(如按 status 推 tag)。
//   2. 后端没有的能力性字段一律保持缺失,不造值。
//      典型:AI 匹配度 match / matchText —— /jobs 不返回,页面须自行 wx:if 兜底。
//   3. 时间统一格式化为「YYYY-MM-DD HH:mm」或相对表述,不编造精度。

/** 安全取值,undefined/null/空串统一回落 */
function pick(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/** ISO 时间 → 「同步于 M月D日」;无值返回 undefined,不造"刚刚" */
function syncLabel(iso) {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return undefined;
  return `同步于 ${d.getMonth() + 1}月${d.getDate()}日`;
}

/** ISO 时间 → 「YYYY-MM-DD HH:mm」 */
function dateTime(iso) {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return undefined;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** ISO 时间 → 「M月D日 HH:mm」,用于招聘会场次展示 */
function shortDateTime(iso) {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return undefined;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- 展示图标与中文标签派生 ----------
// 映射到 app.wxss 已收录的 Ant Design Outlined 图标类，不用 emoji 充当正式素材。
const INDUSTRY_ICON = {
  internet_software: 'solution',
  it: 'solution',
  ai_big_data: 'robot',
  smart_manufacturing: 'setting',
  manufacturing: 'setting',
  education: 'file-text',
  healthcare: 'form',
  biomedicine: 'form',
  finance: 'bank',
  retail: 'home',
  retail_trade: 'home',
  logistics: 'compass',
  transport_logistics: 'compass',
  construction: 'home',
  construction_realestate: 'home',
  culture_media: 'comment',
  government: 'bank',
  public_services: 'bank',
};

const COMPANY_TYPE_LABEL = {
  central_soe: '央企',
  soe: '国企',
  public_institution: '事业单位',
  private: '民营企业',
  foreign: '外资企业',
  joint_venture: '合资企业',
  listed: '上市公司',
  specialized_new: '专精特新',
  high_tech: '高新技术企业',
  school_enterprise: '校企合作单位',
  public_org: '公共机构',
  other: '其他',
};

const COMPANY_INDUSTRY_LABEL = {
  smart_manufacturing: '智能制造',
  internet_software: '互联网/软件',
  ai_big_data: 'AI/大数据',
  electronics: '电子信息',
  new_energy: '新能源',
  new_materials: '新材料',
  biomedicine: '生物医药',
  finance: '金融',
  education: '教育培训',
  healthcare: '医疗健康',
  construction_realestate: '建筑地产',
  transport_logistics: '交通物流',
  retail_trade: '商贸零售',
  culture_media: '文旅传媒',
  agriculture_food: '农业食品',
  professional_services: '专业服务',
  public_services: '公共服务',
  other: '其他',
};

function industryIcon(industry, fallback = 'bank') {
  if (!industry) return fallback;
  return INDUSTRY_ICON[industry] || fallback;
}

// ---------- 岗位 ----------

/**
 * 列表项。页面绑定:id / title / salary / company / tags / source / time
 * 以及 match / matchText(AI 匹配度)。
 * ⚠️ match / matchText 后端不提供,此处刻意不填 —— 页面必须 wx:if 判空,
 *    否则会渲染出有底色无文字的空标签。不得在此造匹配度。
 */
function job(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  return {
    id: raw.id,
    title: raw.title,
    salary: pick(raw.salaryDisplay, raw.salary),
    company: raw.company,
    tags: Array.isArray(raw.tags) && raw.tags.length ? raw.tags : undefined,
    source: pick(raw.sourceName),
    time: syncLabel(raw.syncTime),
    // match / matchText: 后端无此能力,保持缺失
  };
}

/**
 * 岗位详情。页面绑定:title / salary / company / tags / duties / requirements /
 * sourceOrg / syncTime / externalId / matchText
 */
function jobDetail(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  return {
    id: raw.id,
    title: raw.title,
    salary: pick(raw.salaryDisplay, raw.salary),
    company: raw.company,
    tags: Array.isArray(raw.tags) && raw.tags.length ? raw.tags : undefined,
    // 后端 description 是整段文本;页面 duties 期望数组,按换行拆分
    duties: toLines(raw.description),
    requirements: toLines(raw.requirements),
    sourceOrg: pick(raw.sourceName),
    syncTime: dateTime(raw.syncTime),
    externalId: raw.externalId,
    externalUrl: pick(raw.sourceUrl),
    dataSourceNote: raw.dataSourceNote,
    city: raw.city,
    workType: raw.workType,
    experienceRequirement: raw.experienceRequirement,
    // matchText: 同上,不造
  };
}

/** 文本或数组 → 字符串数组;空值返回 undefined 让页面走空态 */
function toLines(v) {
  if (Array.isArray(v)) {
    const arr = v.filter((x) => typeof x === 'string' && x.trim());
    return arr.length ? arr : undefined;
  }
  if (typeof v === 'string' && v.trim()) {
    const arr = v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  }
  return undefined;
}

// ---------- 招聘会 ----------

const FAIR_STATUS_TAG = {
  ongoing: { tag: '进行中', tagTone: 'live', live: true },
  upcoming: { tag: '即将开始', tagTone: 'warn', live: false },
  ended: { tag: '已结束', tagTone: 'muted', live: false },
  cancelled: { tag: '已取消', tagTone: 'muted', live: false },
};

/**
 * 招聘会列表项。页面绑定:id / title / icon / tag / tagTone / live /
 * metaLines / source / sync / bannerStyle
 *
 * tag / tagTone / live 由后端真实 status 派生;metaLines 由真实
 * startTime / venue / boothCount 拼装。不编造场次或展位数。
 */
function fair(raw) {
  if (!raw || typeof raw !== 'object') return raw;

  const st = FAIR_STATUS_TAG[raw.status] || {};
  const metaLines = [];
  const when = shortDateTime(raw.startTime);
  if (when) metaLines.push(when);
  if (raw.venue) metaLines.push(raw.venue);
  if (typeof raw.boothCount === 'number' && raw.boothCount > 0) {
    metaLines.push(`${raw.boothCount} 个展位`);
  }
  if (typeof raw.jobCount === 'number' && raw.jobCount > 0) {
    metaLines.push(`${raw.jobCount} 个岗位`);
  }

  return {
    id: raw.id,
    title: pick(raw.name),
    icon: 'calendar',
    tag: st.tag,
    tagTone: st.tagTone,
    live: st.live === true,
    metaLines: metaLines.length ? metaLines : undefined,
    source: pick(raw.sourceName),
    sync: syncLabel(raw.syncTime),
    // bannerStyle: 纯视觉,后端无对应概念,交由页面默认样式
  };
}

/** 招聘会详情。保留真实坐标与导览相关字段供场馆图使用。 */
function fairDetail(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const st = FAIR_STATUS_TAG[raw.status] || {};
  return {
    id: raw.id,
    title: pick(raw.name),
    description: raw.description,
    organizer: raw.organizer,
    venue: raw.venue,
    city: raw.city,
    theme: raw.theme,
    startTime: dateTime(raw.startTime),
    endTime: dateTime(raw.endTime),
    tag: st.tag,
    tagTone: st.tagTone,
    live: st.live === true,
    boothCount: raw.boothCount,
    jobCount: raw.jobCount,
    expectedAttendance: raw.expectedAttendance,
    trafficInfo: raw.trafficInfo,
    latitude: raw.latitude,
    longitude: raw.longitude,
    sourceOrg: pick(raw.sourceName),
    syncTime: dateTime(raw.syncTime),
    externalId: raw.externalId,
    externalUrl: pick(raw.sourceUrl),
    dataSourceNote: raw.dataSourceNote,
    hasManagedData: raw.hasManagedData === true,
  };
}

// ---------- 企业 ----------

/**
 * 企业列表项。页面绑定:id / icon / name / tags / meta / jobs
 * 后端给 openJobCount / repJobTitles / province / city / district。
 */
function company(raw) {
  if (!raw || typeof raw !== 'object') return raw;

  const region = [raw.city, raw.district].filter(Boolean).join(' · ');
  const meta = pick(region, raw.province);

  return {
    id: raw.id,
    icon: industryIcon(raw.industry),
    name: raw.name,
    tags: Array.isArray(raw.tags) && raw.tags.length ? raw.tags : undefined,
    meta,
    jobs: typeof raw.openJobCount === 'number' ? raw.openJobCount : undefined,
    logoUrl: raw.logoUrl,
    sourceName: raw.sourceName,
    companyTypeLabel: COMPANY_TYPE_LABEL[raw.companyType],
    industryLabel: COMPANY_INDUSTRY_LABEL[raw.industry],
    repJobTitles: Array.isArray(raw.repJobTitles) ? raw.repJobTitles : undefined,
    repJobsText: Array.isArray(raw.repJobTitles) && raw.repJobTitles.length
      ? raw.repJobTitles.join(' · ')
      : undefined,
    fairParticipant: raw.fairParticipant === true,
  };
}

/** 企业详情与在招岗位均沿用公开只读接口；只做字段展示适配。 */
function companyDetail(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const region = [raw.province, raw.city, raw.district].filter(Boolean).join(' · ');
  const tags = [];
  if (COMPANY_TYPE_LABEL[raw.companyType]) tags.push(COMPANY_TYPE_LABEL[raw.companyType]);
  if (COMPANY_INDUSTRY_LABEL[raw.industry]) tags.push(COMPANY_INDUSTRY_LABEL[raw.industry]);
  if (Array.isArray(raw.honorTags)) tags.push(...raw.honorTags.filter(Boolean));
  if (Array.isArray(raw.tags)) tags.push(...raw.tags.filter(Boolean));
  return {
    id: raw.id,
    name: raw.name,
    legalName: raw.legalName,
    logoUrl: raw.logoUrl,
    coverImageUrl: raw.coverImageUrl,
    descriptionLines: toLines(pick(raw.description, raw.desc)),
    icon: industryIcon(raw.industry),
    meta: pick(
      region,
      raw.listMeta,
      Array.isArray(raw.metaParts) ? raw.metaParts.filter((s) => s && s !== '·').join(' · ') : undefined,
      COMPANY_INDUSTRY_LABEL[raw.industry],
      COMPANY_TYPE_LABEL[raw.companyType],
    ),
    tags: [...new Set(tags)],
    metrics: raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : {},
    address: raw.address,
    sourceOrg: pick(raw.sourceName),
    externalId: raw.externalId,
    syncTime: dateTime(raw.syncTime),
    externalUrl: pick(raw.sourceUrl),
    dataSourceNote: raw.dataSourceNote,
  };
}

function companyJob(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  return {
    id: raw.id,
    title: raw.title,
    meta: pick(raw.meta, [raw.city, raw.category].filter(Boolean).join(' · ')),
    salary: pick(raw.salaryDisplay, '面议'),
    tags: Array.isArray(raw.tags) ? raw.tags : undefined,
    source: raw.sourceName,
    externalUrl: raw.sourceUrl,
  };
}

// ---------- 政策 / 公告 ----------

// kind: 'policy_guide' | 'notice'
const POLICY_KIND_STYLE = {
  policy_guide: { icon: 'file-text', label: '政策指南', accent: 'teal' },
  notice: { icon: 'bell', label: '通知公告', accent: 'wheat' },
};

// category: 'policy' | 'announcement' | 'notice' | 'recruitment'
const POLICY_CATEGORY_TAG = {
  policy: { tag: '政策', tagTone: 'primary' },
  announcement: { tag: '公告', tagTone: 'warn' },
  notice: { tag: '通知', tagTone: 'warn' },
  recruitment: { tag: '招录', tagTone: 'live' },
};

// audience: 面向人群,作为附加标签展示
const POLICY_AUDIENCE_LABEL = {
  graduate: '高校毕业生',
  flexible: '灵活就业',
  migrant: '农民工',
  hardship: '就业困难人员',
  startup: '创业者',
  general: '通用',
};

/**
 * 政策列表项。页面绑定:id / icon / title / summary / label / accent /
 * tag / tagTone / source / foot
 *
 * icon / label / accent 由真实 kind 派生;tag / tagTone 由真实 category 派生;
 * foot 用真实 publishedDate。查不到枚举时给中性值,不编造分类。
 */
function policy(raw) {
  if (!raw || typeof raw !== 'object') return raw;

  const ks = POLICY_KIND_STYLE[raw.kind] || { icon: 'file-text', label: undefined, accent: 'slate' };
  const cs = POLICY_CATEGORY_TAG[raw.category] || {};
  const audience = POLICY_AUDIENCE_LABEL[raw.audience];

  const footParts = [];
  if (raw.publishedDate) footParts.push(raw.publishedDate);
  if (audience) footParts.push(audience);

  return {
    id: raw.id,
    icon: ks.icon,
    label: ks.label,
    accent: ks.accent,
    category: raw.category,
    title: raw.title,
    summary: raw.summary,
    tag: cs.tag,
    tagTone: cs.tagTone,
    source: pick(raw.sourceName),
    foot: footParts.length ? footParts.join(' · ') : undefined,
  };
}

/** 政策详情。content 为整段正文,按换行拆成段落数组。 */
function policyDetail(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const ks = POLICY_KIND_STYLE[raw.kind] || { icon: 'file-text', label: undefined, accent: 'slate' };
  const cs = POLICY_CATEGORY_TAG[raw.category] || {};
  return {
    id: raw.id,
    icon: ks.icon,
    label: ks.label,
    accent: ks.accent,
    title: raw.title,
    summary: raw.summary,
    paragraphs: toLines(raw.content),
    tag: cs.tag,
    tagTone: cs.tagTone,
    audience: POLICY_AUDIENCE_LABEL[raw.audience],
    publishedDate: raw.publishedDate,
    sourceOrg: pick(raw.sourceName),
    syncTime: dateTime(raw.syncTime),
    externalUrl: pick(raw.externalUrl),
  };
}

// ============ AI 简历诊断报告 ============

/** 维度得分条的配色:按维度顺序轮转,只是视觉区分,不表达"严重程度"。 */
const DIM_TONES = ['teal', 'wheat', 'clay', 'plum', 'slate', 'teal'];

/**
 * 归一化后端 ParseResumeOutput。
 *
 * 后端真实字段(2026-08-01 线上实测):
 *   { taskId, status, report:{ sections[{key,label,score,maxScore}], suggestions[str],
 *     riskNotes[str], priorities[{focus,reason}] }, providerName, fileId, accessToken,
 *     extractionNotice?{textSource,confidence,warnings}, failReason? }
 *
 * 刻意不做的事:
 *   - 不造 severity(高优先/建议修改/小提示):后端没有这个字段。真正的优先级
 *     就是 report.priorities,照搬即可,不允许按分数自行编一套等级标签。
 *   - 不造问题所在章节/行号:后端不给定位信息,标出来就是猜的。
 *   - 综合分不是后端给的原始字段,而是 6 个维度得分的合计折算,页面必须标明口径。
 */
function resumeReport(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const r = raw.report || {};
  const rawSections = Array.isArray(r.sections) ? r.sections : [];

  let sum = 0;
  let max = 0;
  const sections = rawSections.map((s, i) => {
    const score = Number(s.score) || 0;
    const maxScore = Number(s.maxScore) || 0;
    sum += score;
    max += maxScore;
    return {
      key: s.key || `dim${i}`,
      label: s.label || s.key || `维度 ${i + 1}`,
      score,
      maxScore,
      // 条形宽度百分比;满分为 0 时不画条,避免除零得出 Infinity
      pct: maxScore > 0 ? Math.round((score / maxScore) * 100) : 0,
      tone: DIM_TONES[i % DIM_TONES.length],
    };
  });

  const notice = raw.extractionNotice || null;

  return {
    taskId: raw.taskId || '',
    status: raw.status || '',
    fileId: raw.fileId || '',
    // 'mock' 表示后端跑的是占位 provider,结论不可当作真实 AI 输出,页面须提示
    providerName: raw.providerName || '',
    isMockProvider: raw.providerName === 'mock',
    failReason: raw.failReason || '',

    hasReport: sections.length > 0,
    sections,
    scoreSum: sum,
    scoreMax: max,
    // 折算到百分制;口径由页面文案说明,不伪装成后端下发的"综合评分"
    scorePct: max > 0 ? Math.round((sum / max) * 100) : null,

    priorities: Array.isArray(r.priorities) ? r.priorities : [],
    riskNotes: Array.isArray(r.riskNotes) ? r.riskNotes : [],
    suggestions: Array.isArray(r.suggestions) ? r.suggestions : [],

    // OCR / 文本抽取质量提示:低置信度时页面必须提醒人工复核
    noticeSource: notice ? notice.textSource || '' : '',
    noticeConfidence: notice && typeof notice.confidence === 'number' ? notice.confidence : null,
    noticeWarnings: notice && Array.isArray(notice.warnings) ? notice.warnings : [],
  };
}

/** 数组映射helper:对 null/非数组安全 */
function mapList(fn) {
  return (list) => (Array.isArray(list) ? list.map(fn) : []);
}

// ── AI 能力(简历优化 / 岗位匹配 / 职业规划 / 模拟面试)─────────────────────

/**
 * 岗位匹配参考等级。后端只有三档,**绝无百分比 / 匹配率 / 录用概率**
 * (服务端双层拦截),页面也不得自行折算成百分比展示。
 * 未知取值一律不猜,返回 null 让页面走"无法展示等级"分支。
 */
const FIT_LEVELS = {
  reference_high: { label: '参考匹配度较高', tone: 'teal' },
  reference_medium: { label: '参考匹配度中等', tone: 'wheat' },
  reference_low: { label: '参考匹配度较低', tone: 'clay' },
};

/** 面试练习表现等级(四档)。注释见后端:不是通过率、不是录用概率。 */
const INTERVIEW_LEVELS = {
  needs_work: { label: '仍需打磨', tone: 'clay' },
  pass: { label: '基本达标', tone: 'wheat' },
  good: { label: '表现良好', tone: 'teal' },
  excellent: { label: '表现出色', tone: 'teal' },
};

function strList(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : [];
}

function objList(v) {
  return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];
}

/**
 * 简历优化结果。
 * failed 是常态分支(后端防编造校验命中率不低),必须原样透出 failReason,
 * 不能改写成"网络异常"之类掩盖真实原因的措辞。
 */
function resumeOptimize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const modules = objList(raw.modules).map((m, i) => ({
    key: `m${i}`,
    title: m.title || `建议 ${i + 1}`,
    before: m.before || '',
    after: m.after || '',
  }));
  return {
    taskId: raw.taskId || '',
    status: raw.status || '',
    isCompleted: raw.status === 'completed',
    isFailed: raw.status === 'failed',
    failReason: raw.failReason || '',
    providerName: raw.providerName || '',
    isMockProvider: raw.providerName === 'mock',
    modules,
    hasModules: modules.length > 0,
    // 优化版简历结构较深,页面当前只做"是否可导出"的判断,不逐字段渲染
    hasOptimizedResume: !!(raw.optimizedResume && typeof raw.optimizedResume === 'object'),
  };
}

/**
 * 岗位匹配参考结果。
 * 刻意不做的事:不把 fitLevel 折算成分数或百分比,不按 matchPoints 数量自造"匹配度"。
 */
function jobFit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lv = FIT_LEVELS[raw.fitLevel] || null;
  const job = raw.job && typeof raw.job === 'object' ? raw.job : {};
  const ds = raw.decisionSupport && typeof raw.decisionSupport === 'object' ? raw.decisionSupport : null;
  const kc = ds && ds.keywordCoverage && typeof ds.keywordCoverage === 'object' ? ds.keywordCoverage : null;
  const rb = ds && ds.requirementBreakdown && typeof ds.requirementBreakdown === 'object'
    ? ds.requirementBreakdown : null;
  const requirementBreakdown = rb ? {
    responsibilities: strList(rb.responsibilities),
    mustHave: strList(rb.mustHave),
    preferred: strList(rb.preferred),
    attention: strList(rb.attention),
  } : null;
  const hasRequirementBreakdown = !!(requirementBreakdown && (
    requirementBreakdown.responsibilities.length || requirementBreakdown.mustHave.length ||
    requirementBreakdown.preferred.length || requirementBreakdown.attention.length
  ));
  return {
    taskId: raw.taskId || '',
    status: raw.status || '',
    isCompleted: raw.status === 'completed',
    isFailed: raw.status === 'failed',
    failReason: raw.failReason || '',
    providerName: raw.providerName || '',
    isMockProvider: typeof raw.providerName === 'string' && raw.providerName.indexOf('mock') === 0,
    // 等级未知时保持 null,页面据此隐藏等级区块而不是显示"未知等级"
    fitLevel: raw.fitLevel || '',
    fitLabel: lv ? lv.label : '',
    fitTone: lv ? lv.tone : 'slate',
    job: {
      id: job.id || '',
      title: job.title || '',
      company: job.company || '',
      sourceName: job.sourceName || '',
      sourceUrl: job.sourceUrl || '',
      externalId: job.externalId || '',
      // 只有系统内岗位才有来源,手填岗位没有,不能伪造来源
      hasSource: !!(job.sourceName || job.sourceUrl),
    },
    summary: raw.summary || '',
    matchPoints: objList(raw.matchPoints).map((m) => ({
      requirement: m.requirement || '', point: m.point || '', evidence: m.evidence || '',
    })),
    gapPoints: objList(raw.gapPoints).map((g) => ({
      requirement: g.requirement || '', gap: g.gap || '', suggestion: g.suggestion || '',
    })),
    targetedSuggestions: strList(raw.targetedSuggestions),
    keywordMatched: kc ? strList(kc.matched) : [],
    keywordMissing: kc ? strList(kc.missing) : [],
    hasKeywordCoverage: !!kc,
    requirementBreakdown,
    hasRequirementBreakdown,
  };
}

/**
 * 职业规划。basedOn 必须如实展示"基于什么生成的":
 * 只有简历时不能暗示还参考了岗位匹配或面试记录。
 *
 * 后端 basedOn.jobFit / .interview 给的是**岗位名 / 面试职位名字符串**(没有则 null),
 * 不是布尔。这里保留原字符串,页面可以写"参考了岗位匹配(产品经理)"这种可核对的说明;
 * 只折成布尔会白扔掉后端已经给出的事实。
 */
function careerPlan(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw.basedOn && typeof raw.basedOn === 'object' ? raw.basedOn : null;
  const jobFitName = b && typeof b.jobFit === 'string' ? b.jobFit.trim() : '';
  const interviewName = b && typeof b.interview === 'string' ? b.interview.trim() : '';
  return {
    taskId: raw.taskId || '',
    status: raw.status || '',
    isCompleted: raw.status === 'completed',
    isFailed: raw.status === 'failed',
    failReason: raw.failReason || '',
    providerName: raw.providerName || '',
    isMockProvider: typeof raw.providerName === 'string' && raw.providerName.indexOf('mock') === 0,
    basedOnResume: !!(b && b.resume),
    basedOnJobFit: !!jobFitName,
    basedOnInterview: !!interviewName,
    jobFitName,
    interviewName,
    summary: raw.summary || '',
    currentSnapshot: objList(raw.currentSnapshot).map((s) => ({ point: s.point || '', evidence: s.evidence || '' })),
    directions: objList(raw.directions).map((d) => ({ title: d.title || '', why: d.why || '', firstStep: d.firstStep || '' })),
    skillPlan: objList(raw.skillPlan).map((s) => ({ skill: s.skill || '', action: s.action || '', timeframe: s.timeframe || '' })),
    actionChecklist: strList(raw.actionChecklist),
  };
}

/**
 * 面试报告。
 * 刻意不做的事:不造维度分。后端只给 overall.level 四档 + 各维度的**文字**要点,
 * 没有任何数值评分,页面不得把要点条数当成分数。
 */
function interviewReport(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw.report && typeof raw.report === 'object' ? raw.report : {};
  const ov = r.overall && typeof r.overall === 'object' ? r.overall : {};
  const lv = INTERVIEW_LEVELS[ov.level] || null;
  const sa = r.starAdvice && typeof r.starAdvice === 'object' ? r.starAdvice : null;
  // 五个维度都是字符串数组,统一成一组结构便于页面循环渲染
  const dims = [
    { key: 'expression', label: '表达与逻辑', items: strList(r.expression) },
    { key: 'positionFit', label: '岗位契合', items: strList(r.positionFit) },
    { key: 'credibility', label: '可信度', items: strList(r.credibility) },
    { key: 'professional', label: '专业度', items: strList(r.professional) },
    { key: 'adaptability', label: '应变能力', items: strList(r.adaptability) },
  ].filter((d) => d.items.length > 0);
  return {
    sessionId: raw.sessionId || '',
    position: raw.position || '',
    industry: raw.industry || '',
    interviewerLabel: raw.interviewerLabel || '',
    durationMin: Number(raw.durationMin) || 0,
    endedAt: raw.endedAt || '',
    level: ov.level || '',
    levelLabel: lv ? lv.label : '',
    levelTone: lv ? lv.tone : 'slate',
    summary: ov.summary || '',
    dims,
    hasDims: dims.length > 0,
    risks: strList(r.risks),
    predictedQuestions: objList(r.predictedQuestions).map((q) => ({
      question: q.question || '', why: q.why || '', approach: q.approach || '',
    })),
    starAdvice: sa ? {
      s: sa.s || '', t: sa.t || '', a: sa.a || '', r: sa.r || '', reminder: sa.reminder || '',
    } : null,
    checklist: strList(r.checklist),
  };
}

/**
 * 参会企业:后端实际返回的是 services/api/src/jobs/fair.types.ts 的 FairCompany
 * (name / jobFairId / jobsCount),不是 packages/shared 的 FairCompanyDTO
 * (companyName / fairId / applyNote / checkinStatus / aiMatchScore)。
 *
 * 这里只做键名对齐,**不造后端没有的值**。
 * 一体机端 httpAdapter.ts 是硬编了 checkinStatus:'pending' 和一句
 * applyNote:'如需了解更多,请扫码前往来源平台' —— 那是前端自己编的字符串,
 * 冒充成了来源方给的提示。小程序不跟这个做法:拿不到就保持缺失,
 * 页面按「暂无」渲染,而不是显示一句谁都没说过的话。
 */
function fairCompanyLike(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  return Object.assign({}, raw, {
    companyName: pick(raw.companyName, raw.name),
    fairId:      pick(raw.fairId, raw.jobFairId),
    jobCount:    typeof raw.jobsCount === 'number' ? raw.jobsCount
               : (typeof raw.jobCount === 'number' ? raw.jobCount : undefined),
    coverImageUrl: pick(raw.coverImageUrl, raw.logoUrl),
  });
}

/**
 * 展区:后端 mapFairZone 返回 name,且**没有** industry / boothCount /
 * checkedInCount / color 这四个字段。同样只对齐键名,不补 0。
 * 一体机端在适配层填了 boothCount:0 / checkedInCount:0 —— 那会让页面
 * 显示「0 个展位」,而真相是「不知道有几个展位」。这两件事不一样。
 */
function fairZoneLike(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  return Object.assign({}, raw, {
    zoneName: pick(raw.zoneName, raw.name),
    fairId:   pick(raw.fairId, raw.jobFairId),
  });
}

module.exports = {
  fairCompanyLike,
  fairZoneLike,
  resumeReport,
  resumeOptimize,
  jobFit,
  careerPlan,
  interviewReport,
  pick,
  syncLabel,
  dateTime,
  shortDateTime,
  industryIcon,
  toLines,
  mapList,
  job,
  jobDetail,
  fair,
  fairDetail,
  company,
  companyDetail,
  companyJob,
  policy,
  policyDetail,
};
