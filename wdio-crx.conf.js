const { join } = require('path');
const fs = require('fs').promises;
const { browser } = require('@wdio/globals');

// 扩展名称 - 根据你的实际扩展名称修改
const EXTENSION_NAME = 'My Web Extension';
// 扩展编译后目录 - 根据实际路径修改
const EXTENSION_PATH = join(__dirname, 'tkshop-crx-1.5.6');
console.log('扩展路径:', EXTENSION_PATH);

// 自定义命令：打开扩展弹出窗口
async function openExtensionPopup(extensionName, popupUrl = 'index.html') {
    if (browser.capabilities.browserName !== 'chrome') {
        throw new Error('此命令仅支持 Chrome 浏览器');
    }

    await browser.url('chrome://extensions/');

    await browser.pause(1000); // 等待页面加载

    // 2. 定位包含 Shadow DOM 的根元素（通常是扩展列表容器）
    // 注意：不同 Chrome 版本的容器元素可能不同，需按实际情况调整选择器
    const containerSelector = 'extensions-manager';
    const extensionsContainer = await browser.$(containerSelector);

    // 3. 通过原生 JS 获取 Shadow Root 并查询扩展列表（核心兼容代码）
    const extensionNames = await browser.execute((containerSelector) => {
        // 3.1 获取容器元素
        const container = document.querySelector(containerSelector);
        if (!container) return [];

        // 3.2 获取容器的 Shadow Root（原生 DOM API）
        const shadowRoot = container.shadowRoot;
        if (!shadowRoot) return [];

        // 3.3 在 Shadow Root 中查找所有扩展项（如 extensions-item）
        const extensionItems = shadowRoot.querySelector('extensions-item-list').shadowRoot.querySelectorAll('extensions-item');
        if (!extensionItems.length) return [];

        // 3.4 遍历扩展项，获取名称（处理可能的嵌套 Shadow DOM）
        const names = [];
        extensionItems.forEach(item => {
            // 若扩展项本身也有 Shadow DOM，继续获取
            const itemShadowRoot = item.shadowRoot;
            if (itemShadowRoot) {
                const nameEl = itemShadowRoot.querySelector('#name');
                if (nameEl) names.push({
                    name: nameEl.textContent.trim(),
                    id: item.getAttribute('id')
                });
            }
        });
        return names;
    }, containerSelector); // 传递容器选择器给 execute 函数

    // 6. 验证目标扩展是否存在（替换为你的扩展名称）

    console.log('Shadow DOM 中的扩展列表:', JSON.stringify(extensionNames, null, 2));

    let targetExtension = null;
    for (const ext of extensionNames) {
        if (ext.name === extensionName) {
            targetExtension = ext;
            break;
        }
    }

    if (!targetExtension) {
        throw new Error(`未找到扩展 "${extensionName}"`);
    }

    console.log(`弹出扩展 "${extensionName}" 的弹出窗口，url: chrome-extension://${targetExtension.id}/popup/${popupUrl}`);
    await browser.url(`chrome-extension://${targetExtension.id}/${popupUrl}`);
}

exports.config = {
    // 测试框架配置
    runner: 'local',
    framework: 'mocha',
    mochaOpts: {
        ui: 'bdd',
        timeout: 60000
    },

    // 测试文件路径
    specs: [
        './crx-tests/extension.test.js'
    ],

    // 报告器配置
    reporters: ['spec'],

    // 浏览器配置
    capabilities: [{
        maxInstances: 1,
        browserName: 'chrome',
        'goog:chromeOptions': {
            // 加载扩展
            args: [`--load-extension=${EXTENSION_PATH}`, '--disable-features=DisableLoadExtensionCommandLineSwitch'],
            // 可选：禁用自动化控制提示
            excludeSwitches: ['enable-automation']
        }
    }],

    // 服务配置
    services: [
        ['chromedriver', {
            port: 9515
        }]
    ],

    // 钩子函数
    beforeSession: (config, capabilities, specs) => {
        // 注册自定义命令
        browser.addCommand('openExtensionPopup', openExtensionPopup);
    },

    // 基础配置
    logLevel: 'info',
    bail: 0,
    baseUrl: 'https://example.com',
    waitforTimeout: 10000,
    connectionRetryTimeout: 120000,
    connectionRetryCount: 0,
    services: ['chromedriver']
};
