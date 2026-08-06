const stage = document.querySelector("#kiosk-stage");
const stageSizer = document.querySelector("#stage-sizer");
const stageHost = document.querySelector(".stage-host");
const dialog = document.querySelector("#confirm-dialog");
const dialogTitle = document.querySelector("#confirm-title");
const dialogCopy = document.querySelector("#confirm-copy");

const state = {
  screen: "home",
  copies: 1,
  color: "bw",
  duplex: "single",
  range: "all",
  zoom: 1,
  goal: "周五参加招聘会，帮我检查简历并准备打印",
  pendingAction: null,
};

const screenMeta = {
  home: ["01", "首页", "场景建立信任，目标输入和六项服务承担导航。"],
  print: ["03", "打印参数", "文档预览是主角，参数在一次视线移动内完成。"],
  advisor: ["13", "AI 助手", "先说目标，再核对事实、缺口与办理顺序。"],
};

function topbar() {
  return `
    <header class="k-topbar">
      <div class="k-brand">
        <span class="k-brand-mark">职</span>
        <div><strong>职易达</strong><span>就业服务终端 · 01 号机</span></div>
      </div>
      <div class="k-status">
        <span>08 月 05 日 · 周三</span>
        <span class="k-status-state">设备状态检查中</span>
      </div>
    </header>`;
}

function navbar(active) {
  return `
    <nav class="k-navbar" aria-label="主导航">
      <button type="button" data-go="home" class="${active === "home" ? "is-active" : ""}"><i data-lucide="house"></i>首页</button>
      <button type="button" data-go="advisor" class="${active === "advisor" ? "is-active" : ""}"><i data-lucide="sparkles"></i>AI 顾问</button>
      <button type="button" data-toast="个人中心将在完整原型中展示"><i data-lucide="user-round"></i>我的</button>
    </nav>`;
}

function toast() {
  return `<div class="k-toast" role="status" aria-live="polite" hidden></div>`;
}

function serviceButton(icon, title, copy, target = "") {
  const action = target ? `data-go="${target}"` : `data-toast="${title}将在完整原型中展开"`;
  return `
    <button type="button" class="service-entry" ${action}>
      <span class="service-icon"><i data-lucide="${icon}"></i></span>
      <span class="service-copy"><strong>${title}</strong><span>${copy}</span></span>
      <i data-lucide="chevron-right"></i>
    </button>`;
}

function renderHome() {
  stage.innerHTML = `
    <section class="kiosk-view home-view" data-view="home">
      ${topbar()}
      <section class="home-hero">
        <div class="hero-brandline">线下就业服务台</div>
        <h1>简历、岗位、打印，<br>一趟办完</h1>
        <p>现场准备求职材料，也可以先让 AI 帮你理清要办的事。</p>
        <div class="goal-entry">
          <div>
            <label for="home-goal">告诉我今天想完成什么</label>
            <input id="home-goal" value="${state.goal}" aria-label="求职目标" />
          </div>
          <button type="button" class="k-button k-button-primary" data-start-plan><i data-lucide="arrow-right"></i>帮我安排</button>
        </div>
      </section>
      <main class="home-content">
        <div class="home-heading">
          <div><span>常用服务</span><h2>从今天要办的事开始</h2></div>
          <p>所有外部岗位与招聘会信息均标注来源</p>
        </div>
        <div class="service-grid">
          ${serviceButton("file-user", "AI 简历服务", "诊断、优化、生成与打印", "advisor").replace("service-entry", "service-entry is-featured")}
          ${serviceButton("printer", "打印与扫描", "上传文件、设置参数、现场出纸", "print").replace("service-entry", "service-entry is-featured")}
          ${serviceButton("briefcase-business", "岗位信息", "查看第三方岗位与来源入口")}
          ${serviceButton("calendar-days", "招聘会", "查看官方信息与现场安排")}
          ${serviceButton("messages-square", "面试训练", "模拟练习与复盘建议")}
          ${serviceButton("route", "职业规划", "目标拆解与阶段行动清单")}
        </div>
        <div class="home-lower">
          <button type="button" class="fair-brief" data-toast="招聘会详情将在完整原型中展开">
            <span>本周招聘会</span><h3>高校毕业生就业服务专场</h3>
            <p>周五 09:00 · 市公共就业服务中心<br>查看官方来源、参会须知与场馆导览</p>
            <i data-lucide="arrow-up-right"></i>
          </button>
          <div class="device-brief">
            <span>设备提醒</span><h3>状态检查中</h3>
            <p>进入打印流程后再确认纸张、耗材与计价。</p>
          </div>
        </div>
      </main>
      ${navbar("home")}
      ${toast()}
    </section>`;
}

function flowHeader(kicker, title, copy, index) {
  return `
    <header class="flow-head">
      <div>
        <button type="button" class="flow-back" data-go="home"><i data-lucide="arrow-left"></i>返回首页</button>
        <span class="flow-kicker">${kicker}</span>
        <h1>${title}</h1><p>${copy}</p>
      </div>
      <span class="flow-index" aria-hidden="true">${index}</span>
    </header>`;
}

function renderResumeSheet() {
  return `
    <article class="resume-sheet" aria-label="简历第 1 页预览">
      <header class="resume-sheet-header">
        <div><h2>王同学</h2><p>求职方向：运营专员<br>手机 138****2026 · 深圳</p></div>
        <div class="resume-photo">证件照</div>
      </header>
      <section class="resume-section"><h3>教育经历</h3><p>南方城市大学 · 市场营销 · 本科</p><div class="resume-line"></div></section>
      <section class="resume-section"><h3>实习经历</h3><p>负责活动内容策划、数据整理与项目复盘，协助完成多渠道运营。</p><div class="resume-line"></div><div class="resume-line short"></div></section>
      <section class="resume-section"><h3>项目经历</h3><p>校园就业服务活动 · 项目执行</p><div class="resume-line"></div><div class="resume-line"></div><div class="resume-line short"></div></section>
      <section class="resume-section"><h3>技能与证书</h3><p>Office · 数据分析 · 英语四级</p></section>
    </article>`;
}

function segmented(label, options, selected, name, extraClass = "") {
  const buttons = options.map(([value, text]) => `<button type="button" data-choice="${name}" data-value="${value}" class="${selected === value ? "is-active" : ""}" aria-pressed="${selected === value}">${text}</button>`).join("");
  return `<div class="control-label"><strong>${label}</strong></div><div class="segmented ${extraClass}">${buttons}</div>`;
}

function renderPrint() {
  stage.innerHTML = `
    <section class="kiosk-view print-view" data-view="print">
      ${topbar()}
      ${flowHeader("打印与扫描 / 文件已完成安全检查", "确认打印参数", "先看清文档，再选择份数和打印方式。", "03")}
      <main class="print-workspace">
        <section class="document-bay">
          <div class="document-toolbar">
            <div><strong>个人简历_王同学.pdf</strong><span>3 页 · 2.1 MB · A4</span></div>
            <div class="zoom-tools" aria-label="缩放预览">
              <button type="button" data-zoom="out" aria-label="缩小"><i data-lucide="zoom-out"></i></button>
              <button type="button" data-zoom="in" aria-label="放大"><i data-lucide="zoom-in"></i></button>
            </div>
          </div>
          <div class="paper-stage">${renderResumeSheet()}</div>
          <div class="page-strip"><button type="button" class="is-active">1</button><button type="button">2</button><button type="button">3</button><span>第 1 / 3 页</span></div>
        </section>
        <aside class="print-controls" aria-label="打印参数">
          <section class="control-section">
            <div class="control-label"><strong>打印份数</strong><span>每份 3 页</span></div>
            <div class="copy-stepper"><button type="button" data-copy="minus" aria-label="减少份数"><i data-lucide="minus"></i></button><output>${state.copies} 份</output><button type="button" data-copy="plus" aria-label="增加份数"><i data-lucide="plus"></i></button></div>
          </section>
          <section class="control-section">${segmented("色彩", [["bw", "黑白"], ["color", "彩色"]], state.color, "color")}</section>
          <section class="control-section">${segmented("单双面", [["single", "单面"], ["double", "双面"]], state.duplex, "duplex")}</section>
          <section class="control-section">${segmented("打印范围", [["all", "全部"], ["current", "当前页"], ["custom", "自选"]], state.range, "range", "three")}</section>
          <section class="control-section"><div class="control-label"><strong>纸张与缩放</strong><span>按文件识别</span></div><div class="paper-setting"><div><span>纸张</span><strong>A4</strong></div><div><span>缩放</span><strong>适应纸张</strong></div></div></section>
          <section class="control-section is-device">
            <div class="device-check"><i data-lucide="loader-circle"></i><div><strong>打印设备检查中</strong><span>纸张、耗材与可用打印方式以服务端及本机 Agent 返回为准。</span></div></div>
            <div class="quote-box"><div><span>本次预估</span><strong>待服务端核价</strong></div><p>${state.copies} 份，共 ${state.copies * 3} 个文档页。确认前不会创建打印任务或扣费。</p></div>
          </section>
        </aside>
      </main>
      <footer class="flow-actionbar"><p>预览内容仅用于版式演示。正式页面必须使用用户上传文件的真实渲染结果。</p><div class="flow-actions"><button type="button" class="k-button k-button-secondary" data-go="home">暂不打印</button><button type="button" class="k-button k-button-primary" data-print-confirm><i data-lucide="printer"></i>核价并确认</button></div></footer>
      ${toast()}
    </section>`;
}

function planSteps() {
  return [
    ["检查简历", "识别内容缺口与表达问题，不直接改动原文件", "需要确认"],
    ["针对岗位优化", "按运营专员方向给出修改建议与差异对照", "本人选择"],
    ["准备招聘会材料", "生成材料清单，并提示第三方来源与参会要求", "只做准备"],
    ["现场打印", "进入打印参数页，核价后由本人确认是否出纸", "单独确认"],
  ].map((item, index) => `
    <article class="plan-step">
      <span class="plan-step-number">${String(index + 1).padStart(2, "0")}</span>
      <div><strong>${item[0]}</strong><span>${item[1]}</span></div><em>${item[2]}</em>
    </article>`).join("");
}

function renderAdvisor() {
  stage.innerHTML = `
    <section class="kiosk-view advisor-view" data-view="advisor">
      ${topbar()}
      ${flowHeader("AI 求职顾问 / 任务编排", "先把目标说清楚", "AI 负责整理信息和建议顺序，每个关键动作仍由你确认。", "13")}
      <main class="advisor-layout">
        <aside class="advisor-rail">
          <div class="advisor-identity"><span class="advisor-avatar">青</span><div><strong>就业顾问 小青</strong><span>目标拆解与材料准备</span></div></div>
          <h2>你想先解决<br>哪一件事？</h2>
          <p>选择一个接近的目标，或者在右侧直接修改。计划会随目标重新整理。</p>
          <div class="goal-presets">
            <button type="button" class="is-active" data-goal="周五参加招聘会，帮我检查简历并准备打印">参加招聘会并备齐材料</button>
            <button type="button" data-goal="我想应聘运营专员，帮我优化现有简历">针对目标岗位优化简历</button>
            <button type="button" data-goal="我想练习面试，并整理需要改进的问题">完成一次模拟面试训练</button>
          </div>
          <div class="advisor-boundary"><strong><i data-lucide="shield-check"></i>关键操作不会自动执行</strong><p>支付、打印、删除、保存和跳往第三方平台，都需要你再次确认。</p></div>
        </aside>
        <section class="advisor-board">
          <div class="goal-editor"><label for="advisor-goal">本次目标</label><div class="goal-input-row"><input id="advisor-goal" value="${state.goal}" /><button type="button" class="k-button k-button-dark" data-update-plan><i data-lucide="list-restart"></i>重新整理</button></div></div>
          <div class="plan-summary">
            <article class="fact-sheet"><header><h3>已经知道</h3><span>来自本次输入</span></header><ul><li>目标方向：运营专员</li><li>时间节点：本周五</li><li>已有一份 3 页简历文件</li></ul></article>
            <article class="fact-sheet gaps"><header><h3>还要确认</h3><span>执行前补充</span></header><ul><li>招聘会官方参会要求</li><li>是否按目标岗位修改简历</li><li>打印份数、色彩与最终价格</li></ul></article>
          </div>
          <section class="plan-block">
            <header><div><h3>建议按这个顺序办理</h3><p>每一步都能返回修改，不会跨步自动执行。</p></div><span>预计 4 步</span></header>
            <div class="plan-steps">${planSteps()}</div>
            <div class="plan-note"><i data-lucide="circle-check-big"></i>确认计划只保存办理顺序，不代表同意修改、支付或打印。</div>
          </section>
        </section>
      </main>
      <footer class="flow-actionbar"><p>AI 建议仅供求职准备参考。岗位和招聘会信息以第三方或官方来源页面为准。</p><div class="flow-actions"><button type="button" class="k-button k-button-secondary" data-go="home">返回首页</button><button type="button" class="k-button k-button-primary" data-plan-confirm><i data-lucide="check"></i>确认这个计划</button></div></footer>
      ${toast()}
    </section>`;
}

function render() {
  if (state.screen === "print") renderPrint();
  else if (state.screen === "advisor") renderAdvisor();
  else renderHome();

  const [number, name, note] = screenMeta[state.screen];
  document.querySelector("#screen-number").textContent = number;
  document.querySelector("#screen-name").textContent = name;
  document.querySelector("#screen-note").textContent = note;
  document.querySelectorAll(".studio-nav button").forEach((button) => button.classList.toggle("is-active", button.dataset.screen === state.screen));
  document.title = `一体机视觉定调稿 V3 · ${number} ${name}`;
  if (window.lucide) window.lucide.createIcons();
}

function setScreen(screen) {
  if (!screenMeta[screen]) return;
  state.screen = screen;
  const params = new URLSearchParams(location.search);
  params.set("screen", screen);
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
  render();
}

function showToast(message) {
  const element = stage.querySelector(".k-toast");
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { element.hidden = true; }, 2200);
}

function openConfirm(title, copy, action) {
  dialogTitle.textContent = title;
  dialogCopy.textContent = copy;
  state.pendingAction = action;
  dialog.showModal();
}

document.addEventListener("click", (event) => {
  const go = event.target.closest("[data-go]");
  if (go) return setScreen(go.dataset.go);

  const studio = event.target.closest("[data-screen]");
  if (studio) return setScreen(studio.dataset.screen);

  const toastButton = event.target.closest("[data-toast]");
  if (toastButton) return showToast(toastButton.dataset.toast);

  if (event.target.closest("[data-start-plan]")) {
    state.goal = stage.querySelector("#home-goal").value.trim() || state.goal;
    return setScreen("advisor");
  }

  const copy = event.target.closest("[data-copy]");
  if (copy) {
    state.copies = Math.max(1, Math.min(20, state.copies + (copy.dataset.copy === "plus" ? 1 : -1)));
    return renderPrint();
  }

  const choice = event.target.closest("[data-choice]");
  if (choice) {
    state[choice.dataset.choice] = choice.dataset.value;
    return renderPrint();
  }

  const zoom = event.target.closest("[data-zoom]");
  if (zoom) {
    state.zoom = Math.max(0.8, Math.min(1.15, state.zoom + (zoom.dataset.zoom === "in" ? 0.05 : -0.05)));
    const sheet = stage.querySelector(".resume-sheet");
    if (sheet) sheet.style.setProperty("--preview-scale", state.zoom);
    return;
  }

  const preset = event.target.closest("[data-goal]");
  if (preset) {
    state.goal = preset.dataset.goal;
    return renderAdvisor();
  }

  if (event.target.closest("[data-update-plan]")) {
    state.goal = stage.querySelector("#advisor-goal").value.trim() || state.goal;
    renderAdvisor();
    return showToast("已按新目标重新整理步骤");
  }

  if (event.target.closest("[data-print-confirm]")) {
    return openConfirm("核价后再创建打印任务", "正式产品会先请求服务端核价，并再次展示设备、页数和金额。本原型不会扣费或创建打印任务。", "print");
  }

  if (event.target.closest("[data-plan-confirm]")) {
    return openConfirm("确认保存这份办理计划", "这里只保存四步办理顺序。修改简历、跳往来源平台、支付和打印仍会分别征求你的确认。", "plan");
  }
});

dialog.addEventListener("close", () => {
  if (dialog.returnValue !== "confirm") return;
  const message = state.pendingAction === "print" ? "原型已完成确认演示，未创建真实打印任务" : "办理计划已确认，关键动作仍需逐步确认";
  showToast(message);
  state.pendingAction = null;
});

function fitStage() {
  if (document.body.classList.contains("capture")) return;
  const availableWidth = Math.max(320, stageHost.clientWidth - 68);
  const availableHeight = Math.max(480, stageHost.clientHeight - 68);
  const scale = Math.min(availableWidth / 1080, availableHeight / 1920, 1);
  stageSizer.style.transform = `scale(${scale})`;
  stageSizer.style.margin = `${(1920 * scale - 1920) / 2}px ${(1080 * scale - 1080) / 2}px`;
}

const params = new URLSearchParams(location.search);
state.screen = screenMeta[params.get("screen")] ? params.get("screen") : "home";
if (params.get("capture") === "1") document.body.classList.add("capture");
render();
fitStage();
new ResizeObserver(fitStage).observe(stageHost);
