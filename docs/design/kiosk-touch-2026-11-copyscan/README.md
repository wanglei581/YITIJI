# 青序流光 · 触屏版补稿：屏上扫描、屏上复印、设备状态（2026-11-02，待产品负责人审看）
- 补稿不是定稿：定稿目录 `../kiosk-touch-2026-10/` 一个字节没动；本目录只有 `index.html`（定稿骨架，脚本改指定稿目录，多加载 `copyscan.js`）和 `copyscan.js`（22 屏）。
- 怎么看：浏览器打开 `index.html`，说明栏「全部页面」里有三个新分组；`?shot=1#屏编号` 是 1080×1920 纯舞台；说明栏下方的「演示事件」模拟扫描仪和打印机的回报。
- 屏上扫描 13：`cs-scan-how` `-set` `-run` `-more` `-make` `-done` `-err-nopaper` `-err-jam` `-err-busy` `-err-noresp` `-timeout` `-stopped` `-off`（统一前缀 `cs-scan-`）。
- 屏上复印 8：`cs-copy-how` `-set` `-scan` `-check` `-print` `-done` `-unconfirmed` `-off`；设备状态 1：`cs-device`。
- 可切换的样子（地址参数）：`?scanner=stale` `?scandev=off` `?copydev=off` `?pages=none` `?color=off` `?duplex=off` `?device=stale` `?mat=resume|id|doc|contract` `?stage=2`；另有定稿原有的 `?login=1` `?printer=down` `?ai=down`。
- 去向：面板路线连定稿的 `scan-type`、`copy`；拿去打印连 `pii`；登录连 `login`；我的文档连 `my-docs`。定稿 `print` 屏上的两张卡仍指面板版，新屏从「全部页面」或 `#cs-scan-how`、`#cs-copy-how` 进入。
- 字照协调方两批改稿意见写；号码与服务时间运行时从后台读，读不到不显示；改程序前先报产品负责人。
