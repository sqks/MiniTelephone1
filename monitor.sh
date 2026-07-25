#!/usr/bin/env bash
# MiniTelephone 监控台（Linux / macOS）—— 与 Windows 图形启动器同款功能
# 首次运行：自动初始化（装依赖 -> 构建前端，实时显示进度）
# 之后运行：仪表盘持续显示 运行状态 / 已运行时长 / 服务内存占用 / 系统剩余内存 /
#           磁盘剩余空间 / 访问地址，命令：1 启动 2 停止 3 重启 4 改端口 5 看日志 q 退出
# 端口保存在 resource/port.conf（HTTP=PORT，HTTPS=PORT+443），下次启动生效
cd "$(dirname "$0")"

LOG=resource/server.log
PORT_FILE=resource/port.conf
# 匹配正/反两种斜杠：MSYS/Git Bash 会把路径参数转成 Windows 反斜杠形式
PATTERN='SRC[\\/]server[\\/]index\.js|SRC[\\/]scripts[\\/]dev\.mjs|--watch-path=index\.js'

# ---------------- 基础信息 ----------------
load_port() {
  PORT=3001
  [ -f "$PORT_FILE" ] && . "$PORT_FILE" 2>/dev/null || true
  case "$PORT" in ''|*[!0-9]*) PORT=3001 ;; esac
  HTTPS_PORT=$((PORT + 443))
}

save_port() {
  mkdir -p resource
  printf 'PORT=%s\n' "$PORT" > "$PORT_FILE"
}

lan_ip() {
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

running_pids() {
  # 优先用 pgrep（Linux / macOS 自带）；没有 pgrep 的环境（如 Windows Git Bash）扫描 /proc
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -f "$PATTERN" 2>/dev/null || true
    return
  fi
  local p c
  for p in /proc/[0-9]*; do
    [ -r "$p/cmdline" ] || continue
    c="$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null)"
    case "$c" in
      *SRC/server/index.js*|*SRC\\server\\index.js*|\
      *SRC/scripts/dev.mjs*|*SRC\\scripts\\dev.mjs*|\
      *--watch-path=index.js*)
        [ "${p#/proc/}" = "$$" ] || [ "${p#/proc/}" = "$PPID" ] || echo "${p#/proc/}"
        ;;
    esac
  done
}

# ---------------- 监控指标 ----------------
fmt_bytes() { # $1 = KB
  local kb="$1"
  if [ "$kb" -ge 1048576 ] 2>/dev/null; then
    awk -v k="$kb" 'BEGIN{printf "%.1f GB", k/1048576}'
  elif [ "$kb" -ge 1024 ] 2>/dev/null; then
    awk -v k="$kb" 'BEGIN{printf "%.0f MB", k/1024}'
  else
    echo "${kb} KB"
  fi
}

svc_mem() { # 服务进程 RSS 总和（KB）
  local pids="$1" total=0
  if [ -d /proc ]; then
    local pid rss
    for pid in $pids; do
      rss="$(awk '/^VmRSS/{print $2}' "/proc/$pid/status" 2>/dev/null)"
      [ -n "$rss" ] && total=$((total + rss))
    done
  else
    # macOS：ps 输出 RSS（KB）
    total="$(ps -o rss= -p $(echo $pids | tr ' ' ',') 2>/dev/null | awk '{s+=$1}END{print s+0}')"
  fi
  echo "$total"
}

sys_avail_mem() { # 系统剩余内存（KB）
  if [ -r /proc/meminfo ]; then
    # 优先 MemAvailable，老内核 / MSYS 没有时退回 MemFree+Buffers+Cached
    awk '
      /^MemAvailable/ { av=$2 }
      /^MemFree/ { fr=$2 }
      /^Buffers/ { bf=$2 }
      /^Cached/ { ca=$2 }
      END { if (av) print av; else print fr+bf+ca }
    ' /proc/meminfo
  elif command -v vm_stat >/dev/null 2>&1; then
    # macOS：空闲页 × 页大小
    local ps_kb pages
    ps_kb=$(( $(pagesize 2>/dev/null || echo 4096) / 1024 ))
    pages="$(vm_stat | awk '/Pages free/{gsub(/\./,"");print $3}')"
    echo $(( ${pages:-0} * ps_kb ))
  else
    echo 0
  fi
}

disk_free() {
  df -h resource 2>/dev/null | awk 'NR==2{print $4 "（共 " $2 "）"}' || df -h . | awk 'NR==2{print $4}'
}

uptime_seconds() { # 最早启动进程的已运行秒数
  local pids="$1" oldest=""
  # 首选：monitor.sh 启动时记录的 PID+时间戳（resource/server.pid），最可靠
  if [ -r resource/server.pid ]; then
    local spid sepoch
    read -r spid sepoch < resource/server.pid 2>/dev/null
    case " $pids " in
      *" $spid "*)
        if [ -n "$sepoch" ]; then
          oldest=$(( $(date +%s) - sepoch ))
        fi
        ;;
    esac
  fi
  # 备选：/proc 计算（Linux 可用；MSYS/Git Bash 的 stat 数据不可靠，做合理性校验）
  if [ -z "$oldest" ] && [ -d /proc ] && [ -r /proc/uptime ]; then
    local pid start_jiffies now hz=100 started
    now="$(cut -d. -f1 /proc/uptime)"
    for pid in $pids; do
      start_jiffies="$(sed 's/^.*) //' "/proc/$pid/stat" 2>/dev/null | awk '{print $20}')"
      [ -z "$start_jiffies" ] && continue
      started=$((now - start_jiffies / hz))
      # 负数或超过 10 年视为脏数据，跳过
      [ "$started" -lt 0 ] || [ "$started" -gt 315360000 ] && continue
      if [ -z "$oldest" ] || [ "$started" -gt "$oldest" ]; then oldest="$started"; fi
    done
  fi
  # 再备选：macOS ps etime
  if [ -z "$oldest" ] && ! [ -d /proc ]; then
    local et
    et="$(ps -o etime= -p $(echo $pids | tr ' ' ',') 2>/dev/null | sort -r | head -1 | tr -d ' ')"
    if [ -n "$et" ]; then
      local d=0 h=0 m=0 s=0 rest="$et"
      case "$rest" in *-*) d="${rest%%-*}"; rest="${rest#*-}";; esac
      local IFS=:
      set -- $rest
      case $# in
        3) h="$1"; m="$2"; s="$3" ;;
        2) m="$1"; s="$2" ;;
        1) s="$1" ;;
      esac
      oldest=$((10#$d * 86400 + 10#$h * 3600 + 10#$m * 60 + 10#$s))
    fi
  fi
  echo "${oldest:--1}"
}

fmt_duration() {
  local s="$1"
  if [ "$s" -ge 3600 ]; then
    echo "$((s / 3600)) 小时 $(( (s % 3600) / 60 )) 分"
  elif [ "$s" -ge 60 ]; then
    echo "$((s / 60)) 分 $((s % 60)) 秒"
  else
    echo "$s 秒"
  fi
}

show_status() {
  load_port
  local pids; pids="$(running_pids)"
  echo "======================================"
  echo "        MiniTelephone 监控台"
  echo "======================================"
  if [ -n "$pids" ]; then
    local secs; secs="$(uptime_seconds "$pids")"
    echo "状态：        ● 运行中（$(echo $pids | wc -w | tr -d ' ') 个进程，PID: $(echo $pids | tr '\n' ' ')）"
    if [ "$secs" -ge 0 ] 2>/dev/null; then
      echo "运行时长：    $(fmt_duration "$secs")"
    else
      echo "运行时长：    -（非本监控台启动，暂无法统计）"
    fi
    echo "服务内存：    $(fmt_bytes "$(svc_mem "$pids")")"
  else
    echo "状态：        ○ 已停止"
    echo "运行时长：    -"
    echo "服务内存：    -"
  fi
  echo "系统剩余内存：$(fmt_bytes "$(sys_avail_mem)")"
  echo "磁盘剩余：    $(disk_free)"
  local ip; ip="$(lan_ip)"
  echo "本机访问：    http://localhost:$PORT/"
  [ -n "$ip" ] && echo "局域网访问：  http://$ip:$PORT/"
  [ -n "$ip" ] && echo "手机录音用：  https://$ip:$HTTPS_PORT/"
  echo "端口：        HTTP=$PORT  HTTPS=$HTTPS_PORT（菜单 4 可修改，重启生效）"
  echo "--------------------------------------"
}

# ---------------- 初始化（首次运行） ----------------
need_init() {
  ! command -v node >/dev/null 2>&1 \
    || [ ! -d SRC/server/node_modules ] \
    || [ ! -d SRC/client/node_modules ] \
    || [ ! -d SRC/client/dist ]
}

do_init() {
  echo "== 首次运行，开始初始化 =="
  echo
  if ! command -v node >/dev/null 2>&1; then
    echo "[1/4] 未检测到 Node.js，请先安装 LTS 版本：https://nodejs.org"
    return 1
  fi
  echo "[1/4] Node.js $(node -v)"
  echo "[2/4] 安装后端依赖…"
  (cd SRC/server && npm install) || { echo "后端依赖安装失败"; return 1; }
  echo "[3/4] 安装前端依赖…（可能需要几分钟）"
  (cd SRC/client && npm install) || { echo "前端依赖安装失败"; return 1; }
  echo "[4/4] 构建前端…"
  (cd SRC/client && npm run build) || { echo "前端构建失败"; return 1; }
  echo "== 初始化完成 =="
  echo
  return 0
}

# ---------------- 启停 ----------------
do_start() {
  if [ -n "$(running_pids)" ]; then
    echo ">> 已在运行，无需重复启动"
    return
  fi
  if need_init; then
    do_init || return
  fi
  load_port
  mkdir -p resource
  echo ">> 正在后台启动（HTTP=$PORT HTTPS=$HTTPS_PORT，日志：$LOG）…"
  PORT="$PORT" HTTPS_PORT="$HTTPS_PORT" nohup node SRC/server/index.js >> "$LOG" 2>&1 &
  local start_pid=$!
  echo "$start_pid $(date +%s)" > resource/server.pid
  for _ in $(seq 1 30); do
    sleep 1
    if curl -s -m 1 "http://localhost:$PORT/api/mode" >/dev/null 2>&1; then
      echo ">> 启动完成"
      return
    fi
    if ! kill -0 "$start_pid" 2>/dev/null; then
      echo ">> 启动失败，最近日志："
      tail -n 10 "$LOG" 2>/dev/null
      return
    fi
  done
  echo ">> 启动超时，请用菜单 5 查看日志"
}

do_stop() {
  local pids; pids="$(running_pids)"
  if [ -z "$pids" ]; then
    echo ">> 服务未在运行"
    return
  fi
  echo ">> 正在停止（PID: $(echo $pids | tr '\n' ' ')）…"
  echo "$pids" | xargs kill 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    pids="$(running_pids)"
    [ -z "$pids" ] && break
    sleep 1
  done
  pids="$(running_pids)"
  [ -n "$pids" ] && echo "$pids" | xargs kill -9 2>/dev/null || true
  echo ">> 已停止"
}

do_set_port() {
  load_port
  read -r -p "新 HTTP 端口（当前 $PORT，HTTPS 自动为 端口+443）: " np
  case "$np" in
    ''|*[!0-9]*) echo ">> 无效端口"; return ;;
  esac
  if [ "$np" -lt 1024 ] || [ "$np" -gt 65535 ]; then
    echo ">> 端口范围须为 1024-65535"
    return
  fi
  PORT="$np"
  save_port
  echo ">> 端口已保存：HTTP=$PORT HTTPS=$((PORT + 443))"
  if [ -n "$(running_pids)" ]; then
    echo ">> 服务正在运行，重启后生效（可用菜单 3 重启）"
  fi
}

# ---------------- 主循环 ----------------
while true; do
  echo
  show_status
  echo "1) 启动   2) 停止   3) 重启   4) 修改端口   5) 查看日志   r) 刷新   q) 退出"
  read -r -p "请选择: " choice
  echo
  case "$choice" in
    1) do_start ;;
    2) do_stop ;;
    3) do_stop; do_start ;;
    4) do_set_port ;;
    5) tail -n 30 "$LOG" 2>/dev/null || echo "暂无日志" ;;
    r|R|"") : ;;  # 直接刷新
    q|Q|0) echo "再见"; exit 0 ;;
    *) echo "无效输入" ;;
  esac
done
