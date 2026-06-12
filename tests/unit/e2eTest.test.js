const assert = require('node:assert/strict');
const test = require('node:test');

const { ensureBrowserWindowSize, getShopNames } = require('../e2eTest');

test('getShopNames uses only the first configured shop by default', () => {
  const result = getShopNames({
    shopName: ['shop-a', 'shop-b'],
    win7shopName: 'win7-shop',
  });

  assert.deepEqual(result, ['shop-a']);
});

test('getShopNames uses every configured shop when requested', () => {
  const result = getShopNames({
    shopName: ['shop-a', 'shop-b'],
    win7shopName: 'win7-shop',
  }, {
    testAllShopNames: true,
  });

  assert.deepEqual(result, ['shop-a', 'shop-b']);
});

test('getShopNames keeps using the dedicated Win7 shop', () => {
  const result = getShopNames({
    shopName: ['shop-a', 'shop-b'],
    win7shopName: 'win7-shop',
  }, {
    inWin7: true,
    testAllShopNames: true,
  });

  assert.deepEqual(result, ['win7-shop']);
});

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
