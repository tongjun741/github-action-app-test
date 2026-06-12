#!/usr/bin/env bash
set -euo pipefail

is_true() {
  case "${1,,}" in
    1 | true | yes | y ) return 0 ;;
    * ) return 1 ;;
  esac
}

download_file() {
  local url="$1"
  local target="$2"

  if [[ -s "$target" ]]; then
    echo "使用已下载文件：$target"
    return 0
  fi

  curl -fL --retry 5 --retry-delay 5 "$url" -o "$target"
}

verify_sha256() {
  local expected="$1"
  local target="$2"

  [[ -z "$expected" ]] && return 0
  printf '%s  %s\n' "$expected" "$target" | sha256sum -c -
}

if is_true "${PRIVATE_DEPLOYMENT:-false}"; then
  base_url="https://pageload-test.oss-us-east-1.aliyuncs.com/dockurr-windows"
  image_archive_name="dockurr-windows-2026-06-12-amd64.tar.gz"
  image_checksum_name="dockurr-windows-2026-06-12-amd64.tar.gz.sha256"
  image_name="dockurr/windows:latest"
  iso_name="en_windows_7_ultimate_with_sp1_x64_dvd_u_677332.iso"
  iso_sha256="36f4fa2416d0982697ab106e3a72d2e120dbcdb6cc54fd3906d06120d0653808"
  download_dir="${PRIVATE_DOWNLOAD_DIR:-$PWD/.private-deploy}"

  mkdir -p "$download_dir"
  image_archive="$download_dir/$image_archive_name"
  image_checksum="$download_dir/$image_checksum_name"
  iso_path="$download_dir/$iso_name"

  if ! docker image inspect "$image_name" >/dev/null 2>&1; then
    download_file "$base_url/$image_archive_name" "$image_archive"
    download_file "$base_url/$image_checksum_name" "$image_checksum"
    (
      cd "$download_dir"
      sha256sum -c "$image_checksum_name"
    )
    docker load --input "$image_archive"
    docker image inspect "$image_name" >/dev/null
  fi

  download_file "$base_url/$iso_name" "$iso_path"
  verify_sha256 "$iso_sha256" "$iso_path"

  export WINDOWS_DOCKER_IMAGE="$image_name"
  export WINDOWS_ISO_PATH="$iso_path"
  docker compose \
    -f docker-compose.yml \
    -f docker-compose.private.yml \
    up -d --pull never
  exit 0
fi

max_attempts="${DOCKER_PULL_MAX_ATTEMPTS:-5}"
retry_delay_seconds="${DOCKER_PULL_RETRY_DELAY_SECONDS:-15}"
attempt=1

while ! docker compose pull --policy missing; do
  if (( attempt >= max_attempts )); then
    echo "Docker镜像拉取失败，已尝试${attempt}次。" >&2
    exit 1
  fi

  delay=$((retry_delay_seconds * attempt))
  echo "Docker镜像拉取失败，${delay}秒后进行第$((attempt + 1))次尝试。"
  sleep "$delay"
  attempt=$((attempt + 1))
done

docker compose up -d --pull never
