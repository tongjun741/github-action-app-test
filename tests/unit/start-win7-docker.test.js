const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const process = require('node:process');
const test = require('node:test');

function runStartScript(failuresBeforeSuccess) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'win7-docker-test-'));
  const binDir = path.join(tempDir, 'bin');
  const callsFile = path.join(tempDir, 'calls.log');
  const attemptsFile = path.join(tempDir, 'attempts.log');
  fs.mkdirSync(binDir);

  const dockerPath = path.join(binDir, 'docker');
  fs.writeFileSync(dockerPath, `#!/usr/bin/env bash
echo "docker $*" >> "$CALLS_FILE"
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

  const sleepPath = path.join(binDir, 'sleep');
  fs.writeFileSync(sleepPath, `#!/usr/bin/env bash
echo "sleep $*" >> "$CALLS_FILE"
`);
  fs.chmodSync(sleepPath, 0o755);

  const result = spawnSync('bash', ['./start-docker.sh'], {
    cwd: path.resolve(process.cwd(), 'win7'),
    encoding: 'utf8',
    env: {
      ...process.env,
      ATTEMPTS_FILE: attemptsFile,
      CALLS_FILE: callsFile,
      FAILURES_BEFORE_SUCCESS: String(failuresBeforeSuccess),
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    },
  });

  const calls = fs.existsSync(callsFile)
    ? fs.readFileSync(callsFile, 'utf8').trim().split(/\r?\n/)
    : [];
  fs.rmSync(tempDir, { recursive: true, force: true });
  return { ...result, calls };
}

test('retries image pulls and starts without pulling again', () => {
  const result = runStartScript(2);

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
  const result = runStartScript(5);

  assert.notEqual(result.status, 0);
  assert.equal(
    result.calls.filter((call) => call === 'docker compose pull --policy missing').length,
    5,
  );
  assert.ok(!result.calls.some((call) => call.startsWith('docker compose up')));
});
