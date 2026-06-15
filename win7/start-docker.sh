#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
host_time_file="$script_dir/shared/host-time.txt"
cd "$script_dir"

# 配置参数
MAX_DOWNLOAD_ATTEMPTS="${MAX_DOWNLOAD_ATTEMPTS:-3}"
MAX_DOCKER_LOAD_ATTEMPTS="${MAX_DOCKER_LOAD_ATTEMPTS:-2}"
MAX_COMPOSE_UP_ATTEMPTS="${MAX_COMPOSE_UP_ATTEMPTS:-3}"
DOCKER_PULL_MAX_ATTEMPTS="${DOCKER_PULL_MAX_ATTEMPTS:-5}"
DOCKER_PULL_RETRY_DELAY_SECONDS="${DOCKER_PULL_RETRY_DELAY_SECONDS:-15}"
MIN_DISK_SPACE_GB="${MIN_DISK_SPACE_GB:-20}"

# 日志函数
log_info() {
  echo "[INFO] $(date +'%Y-%m-%d %H:%M:%S') $*"
}

log_warn() {
  echo "[WARN] $(date +'%Y-%m-%d %H:%M:%S') $*" >&2
}

log_error() {
  echo "[ERROR] $(date +'%Y-%m-%d %H:%M:%S') $*" >&2
}

# URL 脱敏函数
mask_url() {
  local url="$1"
  # 提取协议、域名和路径
  if [[ "$url" =~ ^(https?://)([^/]+)(/.*)$ ]]; then
    local protocol="${BASH_REMATCH[1]}"
    local domain="${BASH_REMATCH[2]}"
    local path="${BASH_REMATCH[3]}"
    # 只保留域名的最后部分（顶级域名和二级域名）
    local masked_domain
    if [[ "$domain" =~ \.([^.]+\.[^.]+)$ ]]; then
      masked_domain="***${BASH_REMATCH[1]}"
    else
      masked_domain="***"
    fi
    echo "${protocol}${masked_domain}${path}"
  else
    echo "$url"
  fi
}

is_true() {
  case "${1,,}" in
    1 | true | yes | y ) return 0 ;;
    * ) return 1 ;;
  esac
}

# 检查磁盘空间
check_disk_space() {
  local target_dir="$1"
  local min_space_gb="$2"

  log_info "检查磁盘空间: $target_dir (需要至少 ${min_space_gb}GB)"

  local available_kb
  available_kb=$(df -k "$target_dir" | awk 'NR==2 {print $4}')
  local available_gb=$((available_kb / 1024 / 1024))

  log_info "可用磁盘空间: ${available_gb}GB"

  if (( available_gb < min_space_gb )); then
    log_error "磁盘空间不足！需要至少 ${min_space_gb}GB，当前可用 ${available_gb}GB"
    return 1
  fi

  return 0
}

# 检查 Docker 是否运行
check_docker_running() {
  log_info "检查 Docker 服务状态"

  if ! docker info >/dev/null 2>&1; then
    log_error "Docker 服务未运行或无法连接"
    return 1
  fi

  log_info "Docker 服务正常运行"
  return 0
}

# 清理旧的 Docker 镜像和容器
cleanup_old_resources() {
  local container_name="windows"

  log_info "检查并清理旧的容器和资源"

  # 停止并删除旧容器
  if docker ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
    log_warn "发现旧容器 ${container_name}，正在清理"
    docker stop "$container_name" 2>/dev/null || true
    docker rm -f "$container_name" 2>/dev/null || true
  fi

  # 清理悬空镜像（可选）
  local dangling_count
  dangling_count=$(docker images -f "dangling=true" -q | wc -l)
  if (( dangling_count > 0 )); then
    log_info "发现 ${dangling_count} 个悬空镜像，正在清理"
    docker image prune -f >/dev/null 2>&1 || true
  fi
}

# 带重试的文件下载
download_file() {
  local url="$1"
  local target="$2"
  local max_attempts="${3:-$MAX_DOWNLOAD_ATTEMPTS}"
  local masked_url
  masked_url=$(mask_url "$url")

  # 如果文件已存在且完整，跳过下载
  if [[ -s "$target" ]]; then
    log_info "文件已存在: $target ($(du -h "$target" | cut -f1))"
    return 0
  fi

  log_info "开始下载: $masked_url"

  local attempt=1
  while (( attempt <= max_attempts )); do
    log_info "下载尝试 $attempt/$max_attempts"

    # 使用 -C - 支持断点续传
    if curl -fL --retry 3 --retry-delay 5 --retry-max-time 300 \
         --connect-timeout 30 --max-time 1800 \
         -C - "$url" -o "$target"; then
      log_info "下载成功: $target ($(du -h "$target" | cut -f1))"
      return 0
    fi

    log_warn "下载失败 (尝试 $attempt/$max_attempts)"

    if (( attempt < max_attempts )); then
      local delay=$((10 * attempt))
      log_info "等待 ${delay} 秒后重试"
      sleep "$delay"
    fi

    attempt=$((attempt + 1))
  done

  log_error "下载失败，已达到最大重试次数: $masked_url"
  return 1
}

# 验证 SHA256 校验和
verify_sha256() {
  local expected="$1"
  local target="$2"

  [[ -z "$expected" ]] && return 0

  log_info "验证文件校验和: $target"

  if printf '%s  %s\n' "$expected" "$target" | sha256sum -c -; then
    log_info "校验和验证成功"
    return 0
  else
    log_error "校验和验证失败"
    return 1
  fi
}

# 写入宿主机时间文件
write_host_time_file() {
  local host_time="${WINDOWS_HOST_TIME:-$(date -u +'%Y-%m-%dT%H:%M:%SZ')}"
  local normalized_host_time
  local temporary_file="${host_time_file}.tmp.$$"

  if [[ ! "$host_time" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    ! normalized_host_time="$(date -u -d "$host_time" +'%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)" ||
    [[ "$normalized_host_time" != "$host_time" ]]; then
    log_error "宿主机时间格式无效: $host_time"
    return 1
  fi

  mkdir -p "$(dirname "$host_time_file")"
  printf '%s\n' "$host_time" > "$temporary_file"
  mv "$temporary_file" "$host_time_file"
  log_info "已将宿主机时间写入 host-time.txt: $host_time"
}

# 带重试的 Docker 镜像加载
load_docker_image() {
  local image_archive="$1"
  local image_name="$2"
  local max_attempts="${3:-$MAX_DOCKER_LOAD_ATTEMPTS}"

  log_info "开始加载 Docker 镜像: $image_archive"

  local attempt=1
  while (( attempt <= max_attempts )); do
    log_info "镜像加载尝试 $attempt/$max_attempts"

    if docker load --input "$image_archive"; then
      if docker image inspect "$image_name" >/dev/null 2>&1; then
        log_info "镜像加载成功: $image_name"
        return 0
      else
        log_warn "镜像加载完成，但无法找到预期镜像: $image_name"
      fi
    fi

    log_warn "镜像加载失败 (尝试 $attempt/$max_attempts)"

    if (( attempt < max_attempts )); then
      log_info "等待 10 秒后重试"
      sleep 10
    fi

    attempt=$((attempt + 1))
  done

  log_error "镜像加载失败，已达到最大重试次数"
  return 1
}

# 检测 docker-compose 命令
get_compose_command() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
  else
    log_error "未找到 docker-compose 或 docker compose 命令"
    return 1
  fi
}

# 带重试的 Docker Compose 启动
compose_up_with_retry() {
  local compose_cmd="$1"
  shift
  local compose_args=("$@")
  local max_attempts="$MAX_COMPOSE_UP_ATTEMPTS"

  log_info "开始启动 Docker Compose"

  local attempt=1
  while (( attempt <= max_attempts )); do
    log_info "Docker Compose 启动尝试 $attempt/$max_attempts"

    if $compose_cmd "${compose_args[@]}" up -d --pull never; then
      log_info "Docker Compose 启动成功"

      # 等待容器启动
      sleep 5

      # 验证容器是否运行
      if docker ps --format '{{.Names}}' | grep -q "^windows$"; then
        log_info "容器 'windows' 已成功运行"
        return 0
      else
        log_warn "容器启动命令成功，但容器未在运行列表中"
      fi
    fi

    log_warn "Docker Compose 启动失败 (尝试 $attempt/$max_attempts)"

    if (( attempt < max_attempts )); then
      log_info "清理并等待 15 秒后重试"
      cleanup_old_resources
      sleep 15
    fi

    attempt=$((attempt + 1))
  done

  log_error "Docker Compose 启动失败，已达到最大重试次数"
  return 1
}

# ============================================
# 主逻辑：私有部署模式
# ============================================
if is_true "${PRIVATE_DEPLOYMENT:-false}"; then
  log_info "=========================================="
  log_info "启动模式: 私有部署 (PRIVATE_DEPLOYMENT)"
  log_info "=========================================="

  base_url="https://pageload-test.oss-us-east-1.aliyuncs.com/dockurr-windows"
  log_info "下载源: $(mask_url "$base_url")"
  image_archive_name="dockurr-windows-2026-06-12-amd64.tar.gz"
  image_checksum_name="dockurr-windows-2026-06-12-amd64.tar.gz.sha256"
  image_name="local/dockurr-windows:2026-06-12"
  iso_name="en_windows_7_ultimate_with_sp1_x64_dvd_u_677332.iso"
  iso_sha256="36f4fa2416d0982697ab106e3a72d2e120dbcdb6cc54fd3906d06120d0653808"
  download_dir="${PRIVATE_DOWNLOAD_DIR:-$PWD/.private-deploy}"

  mkdir -p "$download_dir"
  image_archive="$download_dir/$image_archive_name"
  image_checksum="$download_dir/$image_checksum_name"
  iso_path="$download_dir/$iso_name"

  # 检查 Docker 服务
  check_docker_running || exit 1

  # 检查磁盘空间
  check_disk_space "$download_dir" "$MIN_DISK_SPACE_GB" || exit 1

  # 清理旧资源
  cleanup_old_resources

  # 下载和加载 Docker 镜像
  if ! docker image inspect "$image_name" >/dev/null 2>&1; then
    log_info "Docker 镜像不存在，开始下载和加载"

    # 下载镜像归档文件
    download_file "$base_url/$image_archive_name" "$image_archive" || exit 1

    # 下载校验和文件
    download_file "$base_url/$image_checksum_name" "$image_checksum" || exit 1

    # 验证校验和
    (
      cd "$download_dir"
      verify_sha256 "" "$image_archive_name"  # 使用校验和文件验证
      sha256sum -c "$image_checksum_name" || exit 1
    ) || {
      log_error "镜像归档文件校验失败，删除并退出"
      rm -f "$image_archive"
      exit 1
    }

    # 加载镜像
    load_docker_image "$image_archive" "$image_name" || exit 1

    # 为加载的镜像添加 docker-compose.yml 期望的标签
    log_info "为镜像添加兼容标签: dockurr/windows:latest"
    docker tag "$image_name" dockurr/windows:latest || {
      log_error "镜像标签添加失败"
      exit 1
    }
  else
    log_info "Docker 镜像已存在: $image_name"

    # 确保兼容标签存在
    if ! docker image inspect dockurr/windows:latest >/dev/null 2>&1; then
      log_info "添加兼容标签: dockurr/windows:latest"
      docker tag "$image_name" dockurr/windows:latest
    fi
  fi

  # 下载 ISO 文件
  download_file "$base_url/$iso_name" "$iso_path" || exit 1

  # 验证 ISO 文件校验和
  verify_sha256 "$iso_sha256" "$iso_path" || {
    log_error "ISO 文件校验失败，删除并退出"
    rm -f "$iso_path"
    exit 1
  }

  # 设置环境变量
  export WINDOWS_DOCKER_IMAGE="$image_name"
  export WINDOWS_ISO_PATH="$iso_path"

  # 写入宿主机时间
  write_host_time_file || exit 1

  # 获取 compose 命令
  compose_cmd=$(get_compose_command) || exit 1
  log_info "使用 Docker Compose 命令: $compose_cmd"

  # 启动 Docker Compose
  compose_up_with_retry "$compose_cmd" -f docker-compose.yml -f docker-compose.private.yml || exit 1

  log_info "=========================================="
  log_info "私有部署模式启动完成"
  log_info "=========================================="
  exit 0
fi

# ============================================
# 主逻辑：公共镜像模式
# ============================================
log_info "=========================================="
log_info "启动模式: 公共镜像 (从 Docker Hub 拉取)"
log_info "=========================================="

# 检查 Docker 服务
check_docker_running || exit 1

# 清理旧资源
cleanup_old_resources

# 获取 compose 命令
compose_cmd=$(get_compose_command) || exit 1
log_info "使用 Docker Compose 命令: $compose_cmd"

# 拉取镜像（带重试）
max_attempts="$DOCKER_PULL_MAX_ATTEMPTS"
retry_delay_seconds="$DOCKER_PULL_RETRY_DELAY_SECONDS"
attempt=1

log_info "开始从 Docker Hub 拉取镜像"

while ! $compose_cmd pull --policy missing; do
  if (( attempt >= max_attempts )); then
    log_error "Docker 镜像拉取失败，已尝试 ${attempt} 次"
    exit 1
  fi

  delay=$((retry_delay_seconds * attempt))
  log_warn "Docker 镜像拉取失败，${delay} 秒后进行第 $((attempt + 1)) 次尝试"
  sleep "$delay"
  attempt=$((attempt + 1))
done

log_info "Docker 镜像拉取成功"

# 写入宿主机时间
write_host_time_file || exit 1

# 启动 Docker Compose
compose_up_with_retry "$compose_cmd" || exit 1

log_info "=========================================="
log_info "公共镜像模式启动完成"
log_info "=========================================="
