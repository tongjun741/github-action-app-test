#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT

cp "$script_dir/start-docker.sh" "$test_dir/start-docker.sh"
cp "$script_dir/docker-compose.yml" "$test_dir/docker-compose.yml"
compose_checksum="$(sha256sum "$test_dir/docker-compose.yml")"
mkdir -p "$test_dir/bin"
mkdir -p "$test_dir/shared"

cat > "$test_dir/bin/docker" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$test_dir/bin/docker"

(
  cd "$test_dir"
  PATH="$test_dir/bin:$PATH" \
    WINDOWS_HOST_TIME="2026-06-12T15:24:09Z" \
    bash ./start-docker.sh
)

grep -Fx '2026-06-12T15:24:09Z' "$test_dir/shared/host-time.txt" >/dev/null
[[ "$(sha256sum "$test_dir/docker-compose.yml")" == "$compose_checksum" ]]

if (
  cd "$test_dir"
  PATH="$test_dir/bin:$PATH" \
    WINDOWS_HOST_TIME="invalid-time" \
    bash ./start-docker.sh
); then
  echo "start-docker.sh accepted an invalid WINDOWS_HOST_TIME" >&2
  exit 1
fi

grep -Fx '2026-06-12T15:24:09Z' "$test_dir/shared/host-time.txt" >/dev/null
[[ "$(sha256sum "$test_dir/docker-compose.yml")" == "$compose_checksum" ]]
