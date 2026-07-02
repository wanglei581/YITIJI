# 临时可信 HTTPS 落地 Runbook（一体机 mkcert + 后台 Cloudflare/sslip）

> 2026-07-02。配套计划 [WP3](../superpowers/plans/2026-07-02-launch-blockers-resolution-plan.md)。
> 策略：**临时可信先解除阻塞 → 正式域名+ICP 备案后替换**（见「阶段四」）。
> 三条前提必须认账：
> 1. 本文档产出者（Claude/Codex）**够不到生产服务器与一体机**，无法代执行；下面命令由**你（王）在对应机器上执行**。
> 2. **可信证书 ≠ 修好本地调用**：Kiosk HTTPS 页面调 `http://127.0.0.1` 的 mixed-content/PNA 是独立问题（阶段三），别因证书不告警就宣称扫码登录可用。
> 3. **凭据与私钥不进 Git**：mkcert 的 `rootCA-key.pem`、证书私钥、cloudflared 凭据一律只留在机器上，不提交仓库、不贴聊天。

---

## 名词与目标

| 访问面 | 谁在用 | 临时方案 | 是否公网可信 |
|---|---|---|---|
| 一体机前台（`https://120.48.13.190`，Kiosk 浏览器） | 你自己的 Windows 一体机 | 私有 CA（mkcert） | 仅装了根证书的一体机上可信 |
| 管理员/机构后台（`:8081` / `:8082`） | 任意浏览器 / 你的手机笔记本 | Cloudflare Tunnel（首选）或 sslip.io+LE | 公网任意浏览器可信 |

---

## 阶段一（临时）· 一体机现场 —— 私有 CA（mkcert）

### 1. 服务器上安装 mkcert 并签发 IP 证书
```bash
# Debian/Ubuntu（Baidu 云服务器）
sudo apt-get update && sudo apt-get install -y libnss3-tools
curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
chmod +x mkcert-v*-linux-amd64 && sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert

mkcert -install                       # 首次生成本地 CA
mkcert -CAROOT                        # 记下 CA 目录，里面有 rootCA.pem（公开）与 rootCA-key.pem（私钥，勿外传）

# 为公网 IP 签发叶证书（含 127.0.0.1/localhost 便于本地）
mkcert 120.48.13.190 127.0.0.1 localhost
# 产物：120.48.13.190+2.pem（证书）、120.48.13.190+2-key.pem（私钥）
sudo mkdir -p /etc/nginx/certs
sudo cp 120.48.13.190+2.pem     /etc/nginx/certs/kiosk.pem
sudo cp 120.48.13.190+2-key.pem /etc/nginx/certs/kiosk-key.pem
sudo chmod 600 /etc/nginx/certs/kiosk-key.pem
```

### 2. nginx 启用 HTTPS（片段，接到你现有 kiosk server 块）
```nginx
server {
    listen 443 ssl;
    server_name 120.48.13.190;

    ssl_certificate     /etc/nginx/certs/kiosk.pem;
    ssl_certificate_key /etc/nginx/certs/kiosk-key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 50m;   # 对齐 checklist §3.7 上传限制，按实际调整

    location / {
        proxy_pass http://127.0.0.1:<kioskWebPort>;   # 换成 kiosk 前台实际端口
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}
# HTTP → HTTPS 跳转（可选，避免明文入口）
server { listen 80; server_name 120.48.13.190; return 301 https://$host$request_uri; }
```
```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 3. 每台一体机导入根证书（Windows，管理员 PowerShell）
把服务器 `mkcert -CAROOT` 目录里的 **`rootCA.pem`（只这一个公开文件，不要拷私钥）** 传到每台一体机，然后：
```powershell
certutil -addstore -f Root C:\path\to\rootCA.pem
# 验证已入库
certutil -store Root | findstr /i mkcert
```
> Kiosk 浏览器用 Edge/Chrome，读的是 Windows 系统信任库，导入后即生效（重启浏览器）。

### 4. 验证（阶段一 Done 标准）
- 一体机浏览器访问 `https://120.48.13.190`：地址栏无证书告警、锁标正常。
- 未导入根证书的设备（如你手机）访问会告警 —— **这是预期**，公网可信见阶段二。

---

## 阶段二（临时）· 后台公网 —— 二选一

### 选项 A · Cloudflare Tunnel（最快，先试）
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/

# 快速隧道（临时随机 *.trycloudflare.com 可信域名，前台无需域名/备案）
cloudflared tunnel --url http://localhost:8081      # 管理员后台
cloudflared tunnel --url http://localhost:8082      # 机构后台（另开一个进程/终端）
```
- 输出里会打印 `https://<随机>.trycloudflare.com`，浏览器直接可信。
- 注意：① 流量经 Cloudflare（**数据出境**，演示/试运营可接受，正式再评估）；② **国内访问 Cloudflare 的可达性/延迟必须实测**；③ 快速隧道地址进程重启会变，长期用需 named tunnel（要 CF 托管域名）。

### 选项 B · sslip.io + Let's Encrypt（要 80 端口公网可达）
```bash
sudo apt-get install -y certbot python3-certbot-nginx
# 用 IP 映射域名，无需自己注册域名；需保证公网能访问本机 80 端口
certbot --nginx -d 120-48-13-190.sslip.io
```
- 注意 LE 对 sslip.io 有共享频率限制；签发失败就改用选项 A。

### 验证（阶段二 Done 标准）
外部浏览器（不装任何根证书）访问临时 URL：证书链完整、无告警、后台登录正常。

---

## 阶段三（必做）· mixed-content / PNA 评估

> 这一步 Codex 可独立出结论（纯方案评估），但**最终以一体机真机实测为准**。

Kiosk 页面变 HTTPS 后调用本地 `http://127.0.0.1:<localApiPort>`（Terminal Agent）会遇到：
- **Mixed Content**：HTTPS 页面禁止发起明文 http 请求 —— 浏览器直接拦。
- **Private Network Access (PNA)**：公网 HTTPS 页面访问本地网络需额外许可。

候选解法（评估后择一，写回 checklist §2.78）：
1. **本地 Agent 也上 HTTPS**：用同一个 mkcert CA 给 `127.0.0.1`/`localhost` 签证书，Agent 监听 https，页面改调 `https://127.0.0.1:<port>`（根证书已在阶段一装好 → 可信）。**推荐**，与阶段一天然配套。
2. 受信本地桥接方案（Agent 暴露 WebSocket/命名管道，页面经代理调）。
3. 现场网络策略/浏览器 flag（最不推荐，换机不可复制）。

**判定：** 若阶段三未解决，扫码登录/本地硬件调用**不得宣称可用**。

---

## 阶段四（正式替换）· 域名 + ICP 备案 + 正式证书

> 周期最长（备案通常数周），**建议现在就并行启动**，别等临时方案跑起来才办。

```bash
# 域名已备案并解析到 120.48.13.190 后：
certbot --nginx -d your-domain.com -d www.your-domain.com
# certbot 自动改 nginx 并配置续期；随后：
```
- nginx 证书路径切到 certbot 签发的正式证书，`nginx -t && systemctl reload nginx`。
- 下线临时方案：停 cloudflared / 移除 sslip 块 / 一体机可继续用 mkcert 或改指向正式域名。
- 开启 HSTS（确认全站 https 稳定后再开，避免锁死）。

**中国大陆约束：** 大陆服务器用域名跑 80/443 必须备案；未备案前对外只走阶段二（Cloudflare 境外入口 / 或纯 IP）。

---

## 执行顺序与回写
1. 阶段一（一体机）+ 阶段二（后台）可并行，当天可完成。
2. 阶段三紧跟阶段一，真机实测。
3. 阶段四并行启动办域名，通过后替换。
4. 每阶段完成回写 [current-progress.md](../progress/current-progress.md) 与 checklist §2.78 / §3.7；**不写任何私钥/凭据值**。

**阻塞项解除口径：** 阶段一 + 二 + 三完成 = HTTPS 阻塞按「临时可信」**已解除**，可进入试运营；阶段四为正式终态，不阻塞试运营。
