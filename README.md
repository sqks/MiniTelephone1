# MiniTelephone 小电话

一个轻量即时通讯系统：PC 浏览器和手机（Android / iOS）浏览器都能用，无需安装 App。自带完整的账号审批、好友、私聊、群聊、AI 翻译和管理后台，数据全部存在服务器本地 SQLite 与文件目录里，一台普通云服务器或一台闲置电脑就能跑起来。

## 功能特性

**用户端**

- 注册两种模式可切换：**开放注册**（填姓名/年龄/学校，管理员审批后分配账号）与**未开放**（仅管理员建号并指定 UID）
- 每个用户分配一个不超过 6 位的 **UID**，凭 UID 登录
- **好友请求审批制**：输入对方 UID 发送好友请求，对方在右上角「添加好友」页同意后才互为好友；可拒绝、可撤回，双方互发请求自动成为好友
- **私信权限**：只有互为好友才能私信；群里非好友成员只能在群内发言，无法私聊
- 左滑（或点头像）打开个人页：更换头像（保留全部历史头像，可回看/切换/删除）、改名字、用「+」添加带标签的个人信息
- 界面自适应：PC 居中卡片布局，手机全屏移动端布局，支持刘海屏安全区

**聊天**

- 私聊：文字、图片、语音消息，未读数、已读标记
- 群聊：管理员把指定用户拉进群组，群内同样支持文字/图片/语音，显示发送者名字
- **DeepSeek 翻译**：长按/点击消息气泡即可在中、英、俄三语间互译；输入框内容也可一键翻译后再发送
- **语音转文字**：基于浏览器 Web Speech API（免费、无需 Key），支持中文 / English / Русский，识别结果直接填入输入框

**管理面板**（不对普通用户暴露）

- 注册审批：通过（可指定 UID）/ 拒绝
- 用户管理：创建用户（可指定 UID）、删除用户（级联清理其数据）
- 群组管理：勾选用户建群、拉人、踢人、解散
- 数据中心：存储用量监控（数据库/聊天文件/头像/磁盘余量）、**一键导出全部数据**（SQLite + 图片语音打包 zip 下载）、清空聊天记录、重置服务器
- 集成配置：DeepSeek API Key、修改管理密钥

**安全与隐私**

- 管理面板入口默认隐藏：手机端完全不显示，PC 端右上角有低调图标，任意设备也可通过网址后加 `#admin` 进入
- 所有管理接口均有管理密钥校验；DeepSeek Key 只保存在服务器，从不下发到客户端
- 聊天文件按用户 UID 分目录存放，文件名带时间戳，互不混淆

## 技术栈

| 端 | 技术 |
| --- | --- |
| 前端 | Vue 3 + Vite 7 + Tailwind CSS 3（纯 JavaScript，无 TypeScript） |
| 后端 | Node.js + Express 4 + `node:sqlite`（Node 内置 SQLite，零原生依赖） |
| 存储 | SQLite（数据库文件）+ 文件目录（头像/图片/语音） |
| AI | DeepSeek Chat API（翻译）、Web Speech API（语音转文字） |

## 目录结构

```
MiniTelephone/
├── MiniTelephone.exe        # Windows 图形启动器：首次初始化（进度列表）+ 常驻监控面板
├── monitor.sh               # Linux / macOS 监控台：状态/时长/内存/磁盘/端口管理
├── package.json
├── launcher.ini             # 图形启动器保存的端口配置（首次改端口后生成）
├── SRC/
│   ├── client/              # 前端（Vue 3 + Vite）
│   ├── server/              # 后端（Express，HTTP :3001 + HTTPS :3444）
│   └── scripts/dev.mjs      # 开发模式启动脚本
├── tools/                   # 图形启动器 C# 源码与编译脚本
├── deploy/                  # Linux 部署：一键脚本 / systemd / nginx 示例
└── resource/                # 运行时生成：SQLite + 全部用户文件 + HTTPS 证书（勿提交）
```

## 环境要求

- **Node.js ≥ 22.5**（后端使用 `node:sqlite`，这是硬性要求）
- Windows 10/11、Linux、macOS 均可

## Windows 部署

**方式一：图形启动器（推荐）**

双击 `MiniTelephone.exe`：

- **首次打开**：自动进入初始化界面，列表框实时滚动显示安装进度（检查 Node.js → 安装后端依赖 → 安装前端依赖 → 构建前端），完成后自动进入监控面板
- **之后打开**：常驻监控面板，每 2.5 秒自动刷新，显示：
  - 运行状态（运行中 / 已停止，含进程数）
  - 已运行时长（x 小时 x 分）
  - 服务内存占用（所有服务进程合计）
  - 系统剩余内存、磁盘剩余空间
  - 访问地址（本机 / 局域网 / 手机录音用 HTTPS）
- 按钮：**启动服务** / **停止服务** / **打开页面**；**HTTP 端口可修改**（HTTPS 自动为 HTTP+443），保存到 `launcher.ini`，下次启动生效
- 关闭窗口不会停止服务，再次打开继续监控

**方式二：手动**

```cmd
cd SRC\server && npm install
cd SRC\client && npm install && npm run build
node SRC\server\index.js
```

## Linux 部署

**方式一：一键部署脚本（Ubuntu / Debian，推荐）**

```bash
git clone https://github.com/sqks/MiniTelephone1.git minitelephone
# 或者用 GitHub CLI：gh repo clone sqks/MiniTelephone1 minitelephone
cd minitelephone
sudo bash deploy/setup.sh
```

脚本会自动完成：安装 Node.js 22 → 拷贝代码到 `/opt/minitelephone` → 安装依赖 → 构建前端 → 创建 `minitelephone` 运行用户 → 配置 systemd（崩溃自重启 + 开机自启）→ 放行防火墙。再次执行即升级为最新代码，**数据目录 `resource/` 不受影响**。

**方式二：监控台**

```bash
./monitor.sh
```

与 Windows 图形启动器同款功能，纯命令操作：仪表盘持续显示运行状态 / 已运行时长 / 服务内存占用 / 系统剩余内存 / 磁盘剩余空间 / 访问地址；**首次运行自动完成初始化**（装依赖、构建前端）。命令：**1** 启动、**2** 停止、**3** 重启、**4** 修改端口（保存在 `resource/port.conf`，重启生效）、**5** 查看日志、**q** 退出。

**方式三：systemd 常驻**

参考 `deploy/minitelephone.service`，改好 `User` 与 `WorkingDirectory` 后：

```bash
sudo cp deploy/minitelephone.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now minitelephone
```

**HTTPS 与手机录音**

> 手机的录音与语音识别要求浏览器处于 HTTPS 环境，用 `http://IP:3001` 访问时麦克风会被浏览器禁用。

服务器已**内置 HTTPS**：启动时自动生成自签名证书（存于 `resource/certs/`），并在 **HTTP 端口 + 443**（默认 **3444**）提供 HTTPS 入口，无需任何额外配置：

- 手机连同一 WiFi，访问 `https://服务器IP:3444`
- 自签证书不受系统信任，首次打开点「高级 → 继续前往」即可，之后不再提示
- 证书生成后长期有效（10 年），删除 `resource/certs/` 后重启会重新生成
- **微信内置浏览器不支持网页录音**（微信限制），在微信里打开链接后需点右上角「在浏览器打开」
- 服务器部署时记得放行 3444 端口（`deploy/setup.sh` 已自动处理 ufw；云服务器需在安全组手动放行）

正式上线如需受信任的证书，仍可参考 `deploy/nginx.conf.example` 配置 Nginx 反代，配合 certbot 自动签发：

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名
```

## macOS

与 Linux 相同：装好 Node.js 后运行 `./monitor.sh` 监控台即可（首次自动初始化）。

## 使用说明

| 事项 | 说明 |
| --- | --- |
| 访问地址 | 生产模式 `http://服务器:3001`（手机录音用 `https://服务器:3444`），开发模式 `http://localhost:3000` |
| 注册 | 开放模式下提交姓名/年龄/学校等管理员审批；未开放模式下找管理员要 UID |
| 登录 | 输入 UID 即可，浏览器会记住 |
| 退出登录 | 个人页底部「退出登录」，**连点两次**确认（第一次点击后按钮变红提示，3 秒内再点确认；兼容拦截系统弹窗的手机浏览器） |
| 加好友 | 右上角 + 号输入对方 UID **发送好友请求**；对方在同一页面「收到的请求」中**同意**后互为好友才能私信（可拒绝/可撤回，按钮上有待审批红点角标） |
| 管理面板 | PC 右上角盾牌图标，或任意设备访问 `网址/#admin` |
| 初始管理密钥 | `admin123`（**上线后请立即在 管理面板 → 设置 中修改**） |
| DeepSeek 翻译 | 在 管理面板 → 设置 → DeepSeek 翻译 填入 [platform.deepseek.com](https://platform.deepseek.com) 申请的 Key；不配置则翻译功能不可用，其余功能不受影响 |
| 数据备份 | 管理面板 → 数据 → 导出全部数据，下载 zip（含数据库 + 全部图片语音） |

## 数据存储

所有数据都在 `resource/` 目录，备份或迁移时拷贝它即可：

```
resource/
├── minitelephone.db     # SQLite：用户/好友/群组/消息/配置
├── certs/               # 内置 HTTPS 的自签名证书（首次启动自动生成）
├── server.log           # monitor.sh 后台启动时的运行日志
└── <UID>/
    ├── avatars/         # 该用户的全部历史头像（文件名带时间戳）
    └── messages/        # 该用户发出的图片与语音文件
```

## 常见问题

**启动报错 `No such built-in module: node:sqlite`**
Node 版本低于 22.5，请升级 Node.js。

**手机上点录音提示不支持 / 没反应**
局域网 `http://IP:3001` 属于非安全上下文，浏览器会禁用麦克风。改用 `https://IP:3444` 访问（首次点「高级 → 继续前往」），录音与语音识别即可正常使用；本机 `localhost` 调试不受影响。微信内置浏览器本身不支持网页录音，请改用系统浏览器打开。

**手机提示麦克风权限被拒绝**
在浏览器地址栏左侧的站点设置中允许麦克风，然后刷新页面重试。

**忘记管理密钥**
用 SQLite 工具修改 `resource/minitelephone.db` 的 `settings` 表中 `admin_token` 一行即可。

**语音转文字不可用**
该功能依赖浏览器 Web Speech API，请使用最新版 Chrome / Edge / Safari；它不消耗 DeepSeek 额度。

## 开源协议

[MIT](LICENSE)
