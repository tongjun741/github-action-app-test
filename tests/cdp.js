const { remote } = require('webdriverio');
const { sleep } = require('./include/tools');
const WebdriverAjax = require('wdio-intercept-service').default; // 关键：.default

(async () => {
    
const interceptServiceLauncher = new WebdriverAjax();
    // 配置 Chrome 浏览器选项
    const chromeOptions = {
      capabilities: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          // 可选：禁用自动化控制提示
          excludeSwitches: ['enable-automation']
        }
      },
      services: ['chromedriver'] // 使用 chromedriver 服务
    };
  // 1. 配置浏览器和服务
  const browser = await remote(chromeOptions);
  interceptServiceLauncher.before(null, null, browser)

  try {
    // 3. 打开测试页面（确保页面有AJAX请求）
    await browser.url('https://httpbin.org/post');
    await browser.setupInterceptor(); // 若仍报错，说明服务未注册成功

    // 4. 触发一个AJAX请求（示例：发送POST请求）
    await browser.execute(() => {
      fetch('https://api.szdamai.com/api/msg-center/broadcasts', { method: 'GET' });
    });

    // 5. 等待请求完成
    await sleep(5000); // 根据需要调整等待时间

    // 6. 获取拦截的请求
    const requests = await browser.getRequests();
    console.log('拦截到的请求:', requests);
    requests.forEach(req => {
      console.log(`请求URL: ${req.url}, 方法: ${req.method}`);
        // 输出响应内容
        console.log(`响应内容: ${req.response.body}`);
    });
    await browser.pause(1000*100);

  } catch (err) {
    console.error('错误:', err);
  } finally {
    // 7. 关闭浏览器
    await browser.deleteSession();
  }
})();