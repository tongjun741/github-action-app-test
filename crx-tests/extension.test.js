// 1. 引入兼容 CommonJS 的 chai（方案1安装后可直接用）
const { expect } = require('chai');

// 2. 扩展名称（需与你 Chrome 扩展的实际名称一致，在 chrome://extensions 中可查）
const EXTENSION_NAME = '花漾TK';

// 3. 所有依赖 browser 的逻辑必须放在 describe/it 内部（确保 browser 已初始化）
describe('Chrome 扩展测试套件', () => {
  // 测试前的准备：确保 browser 已就绪（可选，进一步规避时机问题）
  before(async () => {
    // 等待浏览器完全启动
    await browser.waitUntil(async () => {
      return await browser.getUrl() !== '';
    }, {
      timeout: 5000,
      timeoutMsg: '浏览器启动超时'
    });
  });

  // 测试1：验证扩展是否成功加载
  it('应该成功加载扩展', async () => {
    await browser.url('chrome://extensions/');
    
    // 调用自定义命令打开弹出窗口（确保该命令已在 wdio.conf.js 中注册）
    await browser.openExtensionPopup(EXTENSION_NAME, "src/side-panel/index.html");

    // 验证弹出窗口中的核心元素（替换为你扩展的实际选择器）
    const popupButton = await browser.$('.ant-row-center button'); // 示例选择器
    await popupButton.waitForExist({ timeout: 2000 });
    expect(await popupButton.isDisplayed()).to.be.true;

    // 可选：点击按钮并验证结果
    await popupButton.click();
    // 这里可以添加更多验证逻辑

    // sleep 10s
    await browser.pause(10000);
  });
});