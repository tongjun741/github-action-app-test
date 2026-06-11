const assert = require('node:assert/strict');
const test = require('node:test');

const openSession = require('../include/openSession');

const { createOpenSession, waitForDebugger } = openSession;

test('waitForDebugger probes immediately and retries at the configured interval', async () => {
  let attempts = 0;
  const sleepCalls = [];

  const result = await waitForDebugger({
    maxAttempts: 3,
    intervalMs: 3000,
    probe: async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('not ready');
      }
      return { Browser: 'Chrome/138.0.7204.142' };
    },
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    outputLog: () => {},
  });

  assert.deepEqual(result, { Browser: 'Chrome/138.0.7204.142' });
  assert.equal(attempts, 3);
  assert.deepEqual(sleepCalls, [3000, 3000]);
});

test('openSession connects through CDP and disconnects without closing the browser', async () => {
  const calls = [];
  let nativeClickCount = 0;
  let domClickCount = 0;
  const existingPage = {
    title: async () => '分身首页',
  };
  const ipPage = {
    goto: async (...args) => calls.push(['goto', ...args]),
    bringToFront: async () => calls.push(['bringToFront']),
    evaluate: async () => ({ width: 1440, height: 900 }),
    waitForSelector: async (...args) => calls.push(['waitForSelector', ...args]),
    waitForFunction: async (...args) => calls.push(['waitForFunction', ...args]),
    $eval: async (selector, callback) => {
      calls.push(['$eval', selector]);
      if (selector === '#jumbo-ip') {
        return '203.0.113.8';
      }
      return callback({
        click: () => {
          domClickCount++;
        },
      });
    },
    click: async () => {
      nativeClickCount++;
      throw new Error('Runtime.callFunctionOn timed out');
    },
    screenshot: async (...args) => calls.push(['pageScreenshot', ...args]),
    title: async () => 'IP Address',
  };
  const browser = {
    pages: async () => [existingPage],
    newPage: async () => ipPage,
    disconnect: async () => calls.push(['disconnect']),
  };

  const run = createOpenSession({
    connect: async (options) => {
      calls.push(['connect', options]);
      return browser;
    },
    waitForDebugger: async () => ({ Browser: 'Chrome/138.0.7204.142' }),
    sleep: async (ms) => calls.push(['sleep', ms]),
    screenshot: async (target, fileName) => {
      calls.push(['screenshot', fileName]);
      await target.saveScreenshot('session-screenshot.png');
      return 'https://example.test/session-screenshot.png';
    },
    outputLog: () => {},
  });

  const result = await run();

  assert.deepEqual(result, {
    ipText: '203.0.113.8',
    sessionScreenshotUrl: 'https://example.test/session-screenshot.png',
  });
  assert.deepEqual(calls[0], [
    'connect',
    {
      browserURL: 'http://127.0.0.1:9221',
      defaultViewport: null,
      protocolTimeout: 60 * 1000,
    },
  ]);
  assert.ok(calls.some((call) => call[0] === 'goto' && call[1] === 'https://ipapi.co/'));
  assert.ok(calls.some((call) => call[0] === 'waitForSelector' && call[1] === '#jumbo-ip'));
  assert.ok(calls.some((call) => call[0] === 'waitForFunction'));
  assert.ok(calls.some((call) => call[0] === 'pageScreenshot'));
  assert.ok(calls.some((call) => call[0] === '$eval' && call[1] === '#ip-qv'));
  assert.equal(nativeClickCount, 0);
  assert.equal(domClickCount, 1);
  assert.ok(calls.some((call) => call[0] === 'sleep' && call[1] === 3000));
  assert.deepEqual(calls.at(-1), ['disconnect']);
});

test('openSession disconnects when page setup fails', async () => {
  let disconnected = false;
  const browser = {
    pages: async () => [],
    newPage: async () => {
      throw new Error('page setup failed');
    },
    disconnect: async () => {
      disconnected = true;
    },
  };

  const run = createOpenSession({
    connect: async () => browser,
    waitForDebugger: async () => ({ Browser: 'Chrome/138.0.7204.142' }),
    sleep: async () => {},
    screenshot: async () => 'unused',
    outputLog: () => {},
  });

  await assert.rejects(run(), /page setup failed/);
  assert.equal(disconnected, true);
});
