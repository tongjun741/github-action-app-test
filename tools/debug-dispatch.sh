#!/usr/bin/env bash
# tools/debug-dispatch.sh —— 花漾内核验证「调试模式」派发 + 轮询脚本
#
# 背景：用户要求「所有脚本未完成的项目用调试的方式来完成，如果需要多个环境就开多个 action，
#       直到所有脚本都能正常运行」。本脚本把各组调试固化成可一键发起的 workflow_dispatch，
#       并自动轮询 run 状态、抓取 CDP 隧道 URL（调试挂起时从外网连分身现场看）。
#
# 用法：
#   bash tools/debug-dispatch.sh kernel_password   # Group1: win10 全项验证(内核版本+密码流程)，跑完挂起保活
#   bash tools/debug-dispatch.sh sync_cookie       # Group2/3: 跨设备同步(第一台写LS/IDB/Cookie+第二台读验证)
#   bash tools/debug-dispatch.sh ui_probe [平台]   # 主壳 UI 探测(详情页DOM)，挂起保活
#   bash tools/debug-dispatch.sh hold [平台]       # 纯挂起(开分身不验证)，挂起保活
#   bash tools/debug-dispatch.sh poll <run_id>     # 轮询 run 状态 + 打印 CDP 隧道 URL / 结果 notice
#   bash tools/debug-dispatch.sh list              # 列出最近 10 个 run
#
# 环境变量：
#   GH_TOKEN   GitHub PAT（需 actions:read + workflow 权限）
#   GH_REPO    仓库（默认 tongjun741/github-action-app-test）
#
# 注意：kernel_password 走 debug_verify（含 verify + verify-cookie-sync 两 job，但无 first-write 源，
#       故 sync 读侧可能 fail，属正常）；sync_cookie 走 debug_sync（第一台写+第二台读，跨设备完整链路）。

set -uo pipefail

WF="浏览器内核验证.yml"
REPO="${GH_REPO:-tongjun741/github-action-app-test}"
GH_BIN="${GH_CLI:-gh}"

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
}

dispatch_and_poll() {
  local fields="$1"
  echo ">> 派发 workflow: $WF"
  echo ">> 参数: $fields"
  if ! $GH_BIN workflow run "$WF" --repo "$REPO" $fields; then
    echo "!! 派发失败（检查 GH_TOKEN / workflow 权限 / 输入名）"
    exit 1
  fi
  echo ">> 已提交，6s 后查 run id ..."
  sleep 6
  local run_id
  run_id=$($GH_BIN run list --repo "$REPO" --workflow "$WF" --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)
  if [ -z "$run_id" ] || [ "$run_id" = "null" ]; then
    echo "!! 未取得 run id（可能还在排队，稍后用 'bash $0 list' 查）"
    exit 0
  fi
  echo ">> run id = $run_id  =>  https://github.com/$REPO/actions/runs/$run_id"
  poll_run "$run_id"
}

poll_run() {
  local run_id="$1"
  echo ">> 轮询 run $run_id (每 60s) ...  Ctrl+C 可中断"
  while true; do
    local st
    st=$($GH_BIN run view "$run_id" --repo "$REPO" --json status,conclusion --jq '"\(.status)/\(.conclusion)"' 2>/dev/null)
    echo "[$(date +%H:%M:%S)] run=$run_id status=$st"
    # 抓取隧道/结果类 notice（CDP 隧道 URL 在调试挂起步每 5min 重发）
    $GH_BIN run view "$run_id" --repo "$REPO" --log 2>/dev/null \
      | grep -iE "CDP隧道在线|调试隧道|tunnel=|trycloudflare" | tail -3 || true
    case "$st" in
      completed/*|failure/*|success/*|cancelled/*)
        echo ">> run 结束: $st"
        break
        ;;
    esac
    sleep 60
  done
  echo ">> 最终结果（jobs）:"
  $GH_BIN run view "$run_id" --repo "$REPO" --json jobs --jq '.jobs[] | "\(.name)\t\(.conclusion)"' 2>/dev/null || true
  echo ">> 取产物: $GH_BIN run download $run_id --repo $REPO -D artifacts-$run_id"
}

case "${1:-}" in
  kernel_password)
    # Group1: win10 全项验证（内核版本 help 页 + 密码保存/代填鼠标流程），跑完挂起保活 60min
    dispatch_and_poll "--field debug_verify=true --field debug_platform=win10 --field debug_hold_minutes=60"
    ;;
  sync_cookie)
    # Group2/3: 跨设备同步 —— 第一台(win10)写 LS/IDB/Cookie+wdku 历史，第二台读验证
    dispatch_and_poll "--field debug_sync=true --field debug_platform=win10"
    ;;
  ui_probe)
    PLAT="${2:-win10}"
    dispatch_and_poll "--field debug_hold=true --field ui_probe=true --field debug_platform=$PLAT --field debug_hold_minutes=60"
    ;;
  hold)
    PLAT="${2:-win10}"
    dispatch_and_poll "--field debug_hold=true --field debug_platform=$PLAT --field debug_hold_minutes=60"
    ;;
  poll)
    [ -z "${2:-}" ] && { echo "!! 需 run_id"; exit 1; }
    poll_run "$2"
    ;;
  list)
    $GH_BIN run list --repo "$REPO" --workflow "$WF" --limit 10
    ;;
  *)
    usage
    ;;
esac
