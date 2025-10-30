# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库中的代码时提供指导。

## 项目概述

这是一个 Electron 应用程序测试框架，对"花漾客户端"(HuaYoung Client)应用程序执行端到端(E2E)测试。该项目使用 WebdriverIO 通过 GitHub Actions 工作流在多个平台(Windows、macOS、Linux)上进行自动化测试。

## 关键命令

### 开发和测试命令

1. **本地运行 E2E 测试**：
   ```bash
   yarn wdio
   ```

2. **运行 CRX(Chrome 扩展)测试**：
   ```bash
   yarn crx
   ```

3. **运行 IP 测试**：
   ```bash
   node tests/ipTest.js
   ```

4. **运行特定测试工作流**：
   ```bash
   node tests/start.js e2e
   node tests/start.js ipTest
   ```

### GitHub Actions 触发器

1. **Windows 10 E2E 测试**：
   ```bash
   curl -X POST \
     -H "Authorization: token github_Token" \
     -H "Accept: application/vnd.github.v3+json" \
     https://api.github.com/repos/tongjun741/github-action-app-test/actions/workflows/Windows10.yml/dispatches \
     -d '{"ref": "main", "inputs": {"do_ip_test": "false", "do_wdio": "true", "in_dev": "false", "software_download_url": "https://dl.szdamai.com/downloads/win10_app_zh/HuaYoungApp_Win10_10.0.648_zh_setup.exe"}}'
   ```

2. **Mac E2E 测试**：
   ```bash
   curl -X POST \
     -H "Authorization: token github_Token" \
     -H "Accept: application/vnd.github.v3+json" \
     https://api.github.com/repos/tongjun741/github-action-app-test/actions/workflows/macOS.yml/dispatches \
     -d '{"ref": "main", "inputs": {"in_dev": "false", "is_arm": "true", "software_download_url": "https://dl.szdamai.com/downloads/mac_arm64_app_zh/HuaYoungApp_Mac_arm64_10.0.559_zh_setup.dmg"}}'
   ```

3. **Ubuntu E2E 测试**：
   ```bash
   curl -X POST \
     -H "Authorization: token github_Token" \
     -H "Accept: application/vnd.github.v3+json" \
     https://api.github.com/repos/tongjun741/github-action-app-test/actions/workflows/Linux.yml/dispatches \
     -d '{"ref": "main", "inputs": {"in_dev": "false", "software_download_url": "https://dl.szdamai.com/downloads/ubuntu_app_zh/HuaYoungApp_Ubuntu_10.0.533_zh_setup.deb"}}'
   ```

## 代码架构和结构

### 核心组件

1. **测试配置**：
   - `wdio.conf.js`：Electron 应用测试的主要 WebdriverIO 配置
   - `wdio-crx.conf.js`：Chrome 扩展测试配置

2. **测试套件**：
   - `tests/e2e.spec.js`：Electron 应用程序的主要 E2E 测试套件
   - `tests/ipTest.js`：IP 地址验证测试
   - `tests/crx/`：Chrome 扩展测试文件

3. **辅助模块**：
   - `tests/include/login.js`：处理应用程序登录功能
   - `tests/include/openSession.js`：管理浏览器会话创建和连接
   - `tests/include/tools.js`：用于通知、屏幕截图、日志记录的实用函数

4. **GitHub Actions 工作流**：
   - `.github/workflows/Windows10.yml`：Windows 10 测试管道
   - `.github/workflows/macOS.yml`：macOS 测试管道
   - `.github/workflows/Linux.yml`：Linux(Ubuntu)测试管道
   - `.github/workflows/crx.yml`：Chrome 扩展测试管道

### 关键测试流程

1. **设置阶段**：
   - 安装 HuaYoung 客户端应用程序
   - 将适当的 chromedriver 复制到临时目录
   - 使用 `modifyMain.js` 修改 main.js 以启用调试端口(9221)

2. **测试执行**：
   - 使用环境变量中的凭据登录应用程序
   - 导航到 shop/instance 页面
   - 打开启用远程调试的浏览器会话
   - 通过 WebdriverIO 远程功能连接到浏览器会话
   - 导航到 ipapi.co 验证 IP 地址
   - 捕获屏幕截图进行验证

3. **报告**：
   - 通过飞书(中国协作平台)发送通知
   - 将结果保存到 MongoDB
   - 将屏幕截图上传到 Cloudinary

### 重要环境变量

- `PRODUCT_WDIO_PASSWORD`：生产环境测试密码
- `DEV_WDIO_PASSWORD`：开发环境测试密码
- `FEISHU_TOKEN`：飞书通知令牌
- `MONGODB_URI`：MongoDB 结果存储连接字符串
- `CLOUDINARY_URL`：Cloudinary 屏幕截图上传凭证

### 平台特定注意事项

1. **Windows 7**：由于兼容性限制，使用 Chrome 版本 109
2. **macOS**：需要应用程序和 chromedriver 的特定路径
3. **Linux**：使用不同的安装路径

测试框架旨在验证 HuaYoung 客户端应用程序能够成功：
1. 启动和登录
2. 打开浏览器会话
3. 维持正确的 IP 地址分配
4. 在不同操作系统上正确运行