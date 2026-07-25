#!/usr/bin/env bash
# ============================================================
#  MiniTelephone 一键部署脚本（Ubuntu / Debian）
#  用法：在项目根目录执行   sudo bash deploy/setup.sh [安装目录]
#        默认安装到 /opt/minitelephone
#  功能：装 Node.js 22 -> 拷贝代码 -> 装依赖 -> 构建前端
#        -> 创建运行用户 -> 配置 systemd 常驻 -> 放行防火墙
#  可重复执行：再次运行即升级为最新代码（resource/ 数据目录不受影响）
# ============================================================
set -euo pipefail

APP_DIR="${1:-/opt/minitelephone}"
PORT="${PORT:-3001}"
HTTPS_PORT="${HTTPS_PORT:-3444}"
SERVICE="minitelephone"
RUN_USER="minitelephone"

echo "============================================"
echo "   MiniTelephone 一键部署 (Ubuntu/Debian)"
echo "   安装目录：$APP_DIR   端口：$PORT (HTTP) / $HTTPS_PORT (HTTPS)"
echo "============================================"

if [ "$(id -u)" != "0" ]; then
  echo "[错误] 请用 root 运行：sudo bash deploy/setup.sh"
  exit 1
fi
if ! command -v apt-get >/dev/null 2>&1; then
  echo "[错误] 本脚本只支持 apt 系发行版（Ubuntu/Debian）"
  exit 1
fi

# ---------- 1. Node.js >= 22.5（node:sqlite 硬要求） ----------
node_ok() {
  command -v node >/dev/null 2>&1 && \
  node -e "const[a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)" >/dev/null 2>&1
}

if node_ok; then
  echo "[1/6] Node.js $(node -v) 已就绪"
else
  echo "[1/6] 安装 Node.js 22（NodeSource）…"
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  node_ok || { echo "[错误] Node.js 安装后版本仍不满足 >= 22.5"; exit 1; }
  echo "      Node.js $(node -v) 安装完成"
fi

# ---------- 2. 拷贝代码（排除 node_modules / resource 数据目录） ----------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
if [ ! -d "$REPO_ROOT/SRC/server" ]; then
  echo "[错误] 请在项目根目录下运行本脚本（未找到 SRC/server）"
  exit 1
fi
# 归一化路径，避免尾斜杠/符号链接导致“同一目录”判断失效
APP_DIR="$(mkdir -p "$APP_DIR" && cd "$APP_DIR" && pwd)"
# 源目录与安装目录相同时（直接在 /opt/minitelephone 里运行脚本）跳过拷贝，
# 否则 tar 会一边读一边写同一批文件，报 "file changed as we read it" 并中断
if [ "$REPO_ROOT" = "$APP_DIR" ]; then
  echo "[2/6] 当前已在安装目录 $APP_DIR 中，跳过代码拷贝"
else
  echo "[2/6] 同步代码到 $APP_DIR …"
  cd "$REPO_ROOT"
  # tar 对“读取期间文件被修改”返回 1（仅警告），只有返回 2 才是真失败
  set +e
  tar cf - --exclude=node_modules --exclude=resource --exclude=launcher.ini \
      SRC package.json monitor.sh | tar xf - -C "$APP_DIR"
  rc=$?
  set -e
  if [ "$rc" -ge 2 ]; then
    echo "[错误] 代码拷贝失败（tar 退出码 $rc）"
    exit 1
  fi
fi

# ---------- 3. 安装依赖 ----------
echo "[3/6] 安装后端依赖…"
(cd "$APP_DIR/SRC/server" && npm install --no-audit --no-fund)
echo "      安装前端依赖…"
(cd "$APP_DIR/SRC/client" && npm install --no-audit --no-fund)

# ---------- 4. 构建前端 ----------
echo "[4/6] 构建前端…"
(cd "$APP_DIR/SRC/client" && npm run build)

# ---------- 5. 创建运行用户 + systemd 常驻 ----------
echo "[5/6] 配置 systemd 服务…"
id -u "$RUN_USER" >/dev/null 2>&1 || \
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$RUN_USER"
mkdir -p "$APP_DIR/resource"
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"

NODE_BIN="$(command -v node)"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=MiniTelephone server
After=network.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN SRC/server/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HTTPS_PORT=$HTTPS_PORT
# Environment=DEEPSEEK_API_KEY=sk-xxxx

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"

# ---------- 6. 防火墙 ----------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  echo "[6/6] 放行防火墙端口 $PORT / $HTTPS_PORT …"
  ufw allow "$PORT" >/dev/null
  ufw allow "$HTTPS_PORT" >/dev/null
else
  echo "[6/6] ufw 未启用，跳过（云服务器请记得在安全组放行 $PORT 和 $HTTPS_PORT）"
fi

sleep 2
if systemctl is-active --quiet "$SERVICE"; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo
  echo "============================================"
  echo "  部署完成，服务已启动并设为开机自启"
  echo "  本机访问：  http://localhost:$PORT/"
  [ -n "$IP" ] && echo "  服务器访问：http://$IP:$PORT/"
  [ -n "$IP" ] && echo "  手机录音用：https://$IP:$HTTPS_PORT/ （自签证书，首次点「高级 → 继续前往」）"
  echo "  管理面板：  网址后加 #admin（初始密钥 admin123，请尽快修改）"
  echo "  数据目录：  $APP_DIR/resource （升级/迁移时备份它即可）"
  echo "  常用命令：  systemctl status|restart $SERVICE"
  echo "              journalctl -u $SERVICE -f  （看日志）"
  echo "============================================"
else
  echo
  echo "[警告] 服务未正常启动，请查看日志：journalctl -u $SERVICE -n 50"
  exit 1
fi
