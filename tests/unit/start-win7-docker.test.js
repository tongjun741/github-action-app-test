const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const process = require('node:process');
const test = require('node:test');

function runStartScript({
  failuresBeforeSuccess = 0,
  extraEnv = {},
  imagePresent = false,
} = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'win7-docker-test-'));
  const binDir = path.join(tempDir, 'bin');
  const callsFile = path.join(tempDir, 'calls.log');
  const attemptsFile = path.join(tempDir, 'attempts.log');
  const imageLoadedFile = path.join(tempDir, 'image-loaded.log');
  const privateDownloadDir = `.private-download-${path.basename(tempDir)}`;
  fs.mkdirSync(binDir);

  const dockerPath = path.join(binDir, 'docker');
  fs.writeFileSync(dockerPath, `#!/usr/bin/env bash
echo "docker $*" >> "$CALLS_FILE"
if [[ "$*" == image\\ inspect\\ * ]]; then
  if [[ "$IMAGE_PRESENT" == "true" || -f "$IMAGE_LOADED_FILE" ]]; then
    exit 0
  fi
  exit 1
fi
if [[ "$*" == load\\ --input\\ * ]]; then
  touch "$IMAGE_LOADED_FILE"
  exit 0
fi
if [[ "$*" == "compose pull --policy missing" ]]; then
  attempt=0
  if [[ -f "$ATTEMPTS_FILE" ]]; then
    attempt=$(cat "$ATTEMPTS_FILE")
  fi
  attempt=$((attempt + 1))
  echo "$attempt" > "$ATTEMPTS_FILE"
  if (( attempt <= FAILURES_BEFORE_SUCCESS )); then
    exit 1
  fi
fi
`);
  fs.chmodSync(dockerPath, 0o755);

  const curlPath = path.join(binDir, 'curl');
  fs.writeFileSync(curlPath, `#!/usr/bin/env bash
echo "curl $*" >> "$CALLS_FILE"
output=""
while (( $# > 0 )); do
  if [[ "$1" == "-o" ]]; then
    output="$2"
    shift 2
    continue
  fi
  shift
done
mkdir -p "$(dirname "$output")"
printf "downloaded" > "$output"
`);
  fs.chmodSync(curlPath, 0o755);

  const sha256sumPath = path.join(binDir, 'sha256sum');
  fs.writeFileSync(sha256sumPath, `#!/usr/bin/env bash
echo "sha256sum $*" >> "$CALLS_FILE"
cat >/dev/null
`);
  fs.chmodSync(sha256sumPath, 0o755);

  const sleepPath = path.join(binDir, 'sleep');
  fs.writeFileSync(sleepPath, `#!/usr/bin/env bash
echo "sleep $*" >> "$CALLS_FILE"
`);
  fs.chmodSync(sleepPath, 0o755);

  const normalizedExtraEnv = { ...extraEnv };
  if (normalizedExtraEnv.PRIVATE_DOWNLOAD_DIR === '<TEMP_DOWNLOAD_DIR>') {
    normalizedExtraEnv.PRIVATE_DOWNLOAD_DIR = privateDownloadDir;
  }

  const result = spawnSync('bash', ['./start-docker.sh'], {
    cwd: path.resolve(process.cwd(), 'win7'),
    encoding: 'utf8',
    env: {
      ...process.env,
      ATTEMPTS_FILE: attemptsFile,
      CALLS_FILE: callsFile,
      IMAGE_LOADED_FILE: imageLoadedFile,
      IMAGE_PRESENT: String(imagePresent),
      FAILURES_BEFORE_SUCCESS: String(failuresBeforeSuccess),
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      ...normalizedExtraEnv,
    },
  });

  const posixTempDir = tempDir.replaceAll('\\', '/');
  const calls = fs.existsSync(callsFile)
    ? fs.readFileSync(callsFile, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((call) => call
        .replaceAll(tempDir, '<TMP>')
        .replaceAll(posixTempDir, '<TMP>')
        .replaceAll(privateDownloadDir, '<TMP>/downloads'))
    : [];
  fs.rmSync(path.resolve(process.cwd(), 'win7', privateDownloadDir), {
    recursive: true,
    force: true,
  });
  fs.rmSync(tempDir, { recursive: true, force: true });
  return { ...result, calls };
}

test('retries image pulls and starts without pulling again', () => {
  const result = runStartScript({ failuresBeforeSuccess: 2 });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    'docker compose pull --policy missing',
    'sleep 15',
    'docker compose pull --policy missing',
    'sleep 30',
    'docker compose pull --policy missing',
    'docker compose up -d --pull never',
  ]);
});

test('stops after five failed image pulls', () => {
  const result = runStartScript({ failuresBeforeSuccess: 5 });

  assert.notEqual(result.status, 0);
  assert.equal(
    result.calls.filter((call) => call === 'docker compose pull --policy missing').length,
    5,
  );
  assert.ok(!result.calls.some((call) => call.startsWith('docker compose up')));
});

test('downloads private image and ISO before starting without remote pulls', () => {
  const result = runStartScript({
    extraEnv: {
      PRIVATE_DEPLOYMENT: 'true',
      PRIVATE_DOWNLOAD_DIR: '<TEMP_DOWNLOAD_DIR>',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    'docker image inspect local/dockurr-windows:2026-06-12',
    'curl -fL --retry 5 --retry-delay 5 https://pageload-test.oss-us-east-1.aliyuncs.com/dockurr-windows/dockurr-windows-2026-06-12-amd64.tar.gz -o <TMP>/downloads/dockurr-windows-2026-06-12-amd64.tar.gz',
    'curl -fL --retry 5 --retry-delay 5 https://pageload-test.oss-us-east-1.aliyuncs.com/dockurr-windows/dockurr-windows-2026-06-12-amd64.tar.gz.sha256 -o <TMP>/downloads/dockurr-windows-2026-06-12-amd64.tar.gz.sha256',
    'sha256sum -c dockurr-windows-2026-06-12-amd64.tar.gz.sha256',
    'docker load --input <TMP>/downloads/dockurr-windows-2026-06-12-amd64.tar.gz',
    'docker image inspect local/dockurr-windows:2026-06-12',
    'curl -fL --retry 5 --retry-delay 5 https://pageload-test.oss-us-east-1.aliyuncs.com/dockurr-windows/en_windows_7_ultimate_with_sp1_x64_dvd_u_677332.iso -o <TMP>/downloads/en_windows_7_ultimate_with_sp1_x64_dvd_u_677332.iso',
    'sha256sum -c -',
    'docker compose -f docker-compose.yml -f docker-compose.private.yml up -d --pull never',
  ]);
});

test('workflow defaults private deployment to disabled with fixed artifacts', () => {
  const workflow = fs.readFileSync(
    path.resolve(process.cwd(), '.github/workflows/Windows7-docker.yml'),
    'utf8',
  );

  assert.match(workflow, /private_deployment:/);
  assert.match(workflow, /private_deployment:[\s\S]*?default:\s*false/);
  assert.doesNotMatch(workflow, /private_download_base_url:/);
  assert.doesNotMatch(workflow, /docker_image_archive_name:/);
  assert.doesNotMatch(workflow, /docker_image_sha256:/);
  assert.doesNotMatch(workflow, /windows_iso_name:/);
  assert.doesNotMatch(workflow, /windows_iso_sha256:/);

  assert.ok(
    fs.existsSync(path.resolve(process.cwd(), 'win7/docker-compose.private.yml')),
    'private Compose override should exist',
  );
});
