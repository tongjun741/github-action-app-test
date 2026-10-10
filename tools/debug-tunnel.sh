#!/usr/bin/env bash
# debug-tunnel.sh —— 用 cloudflared 快速隧道把本地端口暴露到公网（免账号，随机 trycloudflare.com 域名）
# 用法: debug-tunnel.sh <本地端口> <标签>
# 输出: ::notice annotation（含公网 URL），匿名 API 可读
set -u
PORT="${1:?port required}"
TAG="${2:?tag required}"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS" in
  Linux)
    case "$ARCH" in
      x86_64) ASSET=cloudflared-linux-amd64;;
      aarch64) ASSET=cloudflared-linux-arm64;;
      *) echo "::error ::不支持的架构 $ARCH"; exit 1;;
    esac
    curl -fsSL -o cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/$ASSET" || { echo "下载失败"; exit 1; }
    chmod +x cloudflared
    ;;
  Darwin)
    case "$ARCH" in
      arm64) ASSET=cloudflared-darwin-arm64.tgz;;
      *) ASSET=cloudflared-darwin-amd64.tgz;;
    esac
    curl -fsSL -o cloudflared.tgz "https://github.com/cloudflare/cloudflared/releases/latest/download/$ASSET" || { echo "下载失败"; exit 1; }
    tar xzf cloudflared.tgz cloudflared && chmod +x cloudflared
    ;;
  MINGW*|MSYS*|CYGWIN*)
    curl -fsSL -o cloudflared.exe "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" || { echo "下载失败"; exit 1; }
    cp cloudflared.exe cloudflared
    ;;
  *) echo "::error ::不支持的系统 $OS"; exit 1;;
esac

CF="./cloudflared"
[ -f "./cloudflared.exe" ] && [ ! -f "./cloudflared" ] && CF="./cloudflared.exe"
"$CF" tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate > cf_${TAG}.log 2>&1 &

URL=""
for i in $(seq 1 45); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "cf_${TAG}.log" 2>/dev/null | head -1)
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then
  echo "::warning title=调试隧道(${TAG})::隧道建立失败（端口 ${PORT}），详见 cf_${TAG}.log"
  exit 0  # 调试设施失败不阻断主流程
fi
echo "::notice title=调试隧道(${TAG} 端口${PORT})::${URL}"
echo "TUNNEL_URL_${TAG}=${URL}"
