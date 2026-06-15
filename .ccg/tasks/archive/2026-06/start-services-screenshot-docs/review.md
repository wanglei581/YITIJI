# 启动与截图整理验收记录

## 结果

- API 已启动：`http://localhost:3010/api/v1`
- Kiosk 已可访问：`http://localhost:5173`
- Admin 已可访问：`http://localhost:5174`
- Partner 已可访问：`http://localhost:5175`
- 截图输出目录：`outputs/page-screenshots-20260615`
- 整理文档：`outputs/page-screenshots-20260615/AI求职打印服务终端-页面截图整理.pdf`

## 校验

- `GET /api/v1/health` 返回 `success=true`，数据库为 `sqlite`。
- 14 张页面截图全部生成成功。
- 截图整理 PDF 共 7 页，可抽取到 `Kiosk`、`Admin`、`Partner` 和报告标题文本。
- Computer Use 已确认 Chrome 打开本地 `index.html` 整理页，表格中所有截图状态为 `ok`。

## 说明

- `apps/admin/.env.local` 与 `apps/partner/.env.local` 原本指向 `192.168.0.153:3010`，当前机器不可达；本次运行未修改文件，而是通过启动命令临时覆盖为 `http://localhost:3010/api/v1`。
- Kiosk 端复用已有 `5173` Vite 进程。
