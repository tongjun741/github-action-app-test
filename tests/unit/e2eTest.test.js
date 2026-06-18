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

test('getShopNames skips the shops configured to be ignored per platform', () => {
  const config = {
    shopName: ['UA146', 'UA144', 'UA142', 'UA120'],
    win7shopName: 'UA109',
  };

  // win10 忽略 UA144
  assert.deepEqual(getShopNames(config, {
    platform: 'Windows 10',
    testAllShopNames: true,
  }), ['UA146', 'UA142', 'UA120']);
  // ubuntu 忽略 UA120
  assert.deepEqual(getShopNames(config, {
    platform: 'Ubuntu',
    testAllShopNames: true,
  }), ['UA146', 'UA144', 'UA142']);
  // mac x64 忽略 UA142
  assert.deepEqual(getShopNames(config, {
    platform: 'macOS-x64',
    testAllShopNames: true,
  }), ['UA146', 'UA144', 'UA120']);
  // mac arm 忽略 UA120
  assert.deepEqual(getShopNames(config, {
    platform: 'macOS-arm64',
    testAllShopNames: true,
  }), ['UA146', 'UA144', 'UA142']);
  // 忽略分身后默认只取第一个
  assert.deepEqual(getShopNames(config, {
    platform: 'Windows 10',
  }), ['UA146']);
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
