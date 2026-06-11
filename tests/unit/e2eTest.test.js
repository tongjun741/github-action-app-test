const assert = require('node:assert/strict');
const test = require('node:test');

const { ensureBrowserWindowSize } = require('../e2eTest');

test('ensureBrowserWindowSize does not retry when the requested size is applied', async () => {
  let resizeCount = 0;
  const sleepCalls = [];
  const browser = {
    execute: async (_script, ...args) => {
      if (args.length > 0) {
        resizeCount++;
        return;
      }
      return { width: 1600, height: 1200 };
    },
    getWindowSize: async () => {
      throw new Error("unknown command: 'Browser.getWindowForTarget' wasn't found");
    },
  };

  const result = await ensureBrowserWindowSize(browser, {
    sleep: async (ms) => sleepCalls.push(ms),
    outputLog: () => {},
  });

  assert.deepEqual(result, { width: 1600, height: 1200 });
  assert.equal(resizeCount, 1);
  assert.deepEqual(sleepCalls, []);
});

test('ensureBrowserWindowSize waits three seconds and retries when the size is not applied', async () => {
  let resizeCount = 0;
  let sizeCheckCount = 0;
  const sleepCalls = [];
  const browser = {
    execute: async (_script, ...args) => {
      if (args.length > 0) {
        resizeCount++;
        return;
      }
      sizeCheckCount++;
      return sizeCheckCount === 1
        ? { width: 1280, height: 800 }
        : { width: 1600, height: 1200 };
    },
    getWindowSize: async () => {
      throw new Error("unknown command: 'Browser.getWindowForTarget' wasn't found");
    },
  };

  const result = await ensureBrowserWindowSize(browser, {
    sleep: async (ms) => sleepCalls.push(ms),
    outputLog: () => {},
  });

  assert.deepEqual(result, { width: 1600, height: 1200 });
  assert.equal(resizeCount, 2);
  assert.deepEqual(sleepCalls, [3000]);
});
