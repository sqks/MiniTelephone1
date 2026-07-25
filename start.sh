#!/usr/bin/env bash
# MiniTelephone 一键启动（Linux / macOS）
# 逻辑：检查 Node.js -> 缺依赖自动 npm install -> 缺前端构建自动 build -> 启动服务
# 用法：./start.sh            生产模式（服务器 :3001，同时托管前端页面）
#       ./start.sh --dev     开发模式（Vite :3000 + API :3001，代码改动热更新）
#       ./start.sh --build   强制重新构建前端
#       ./start.sh --no-browser  不自动打开浏览器
set -euo pipefail
cd "$(dirname "$0")"

DEV=0
BUILD=0
BROWSER=1
for a in "$@"; do
  case "$a" in
    --dev) DEV=1 ;;
    --build) BUILD=1 ;;
    --no-browser) BROWSER=0 ;;
    *) echo "未知参数：$a"; exit 1 ;;
  esac
done

echo "======================================"
echo "   MiniTelephone 一键启动 (Linux/mac)"
echo "======================================"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "[错误] 未检测到 Node.js，请先安装 LTS 版本：https://nodejs.org"
  exit 1
fi
echo "[1/4] Node.js $(node -v)"

if [ ! -d SRC/server/node_modules ]; then
  echo "[2/4] 首次运行，安装后端依赖…"
  (cd SRC/server && npm install)
fi
if [ ! -d SRC/client/node_modules ]; then
  echo "[2/4] 首次运行，安装前端依赖…（可能需要几分钟）"
  (cd SRC/client && npm install)
fi
echo "[2/4] 依赖就绪"

if [ "$DEV" = 0 ] && { [ "$BUILD" = 1 ] || [ ! -d SRC/client/dist ]; }; then
  echo "[3/4] 构建前端…"
  (cd SRC/client && npm run build)
fi
echo "[3/4] 前端就绪"

lan_ip() {
  # macOS: ipconfig getifaddr en0；Linux: hostname -I；输出必须是纯 IPv4 否则留空
  local ip=""
  if [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  else
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  case "$ip" in
    ""|*[!0-9.]*) ip="" ;;
  esac
  printf '%s' "$ip"
}

open_url() {
  # macOS 用 open，Linux 用 xdg-open；失败不影响服务
  if command -v open >/dev/null 2>&1; then open "$1" || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" || true
  fi
}

echo "[4/4] 启动服务器…（按 Ctrl+C 停止）"
echo
if [ "$DEV" = 1 ]; then
  IP="$(lan_ip)"
  echo "--------------------------------------"
  echo "本机访问：  http://localhost:3000/"
  [ -n "$IP" ] && echo "局域网访问：http://$IP:3000/   <- 手机连同一 WiFi 用这个"
  echo "--------------------------------------"
  [ "$BROWSER" = 1 ] && { sleep 2; open_url "http://localhost:3000/"; } &
  exec node SRC/scripts/dev.mjs
else
  IP="$(lan_ip)"
  echo "--------------------------------------"
  echo "本机访问：  http://localhost:3001/"
  [ -n "$IP" ] && echo "局域网访问：http://$IP:3001/   <- 手机连同一 WiFi 用这个"
  echo "--------------------------------------"
  [ "$BROWSER" = 1 ] && { sleep 2; open_url "http://localhost:3001/"; } &
  exec node SRC/server/index.js
fi
