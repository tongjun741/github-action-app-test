#!/usr/bin/env bash
set -euo pipefail

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
