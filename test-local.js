#!/usr/bin/env node

/**
 * 本地 CRX 测试脚本
 * 支持 SSH 代理配置
 */

require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

// 设置环境变量
const env = {
  ...process.env,
  // SSH 代理配置
  SSH_PROXY_HOST: process.env.SSH_PROXY_HOST,
  SSH_PROXY_PORT: process.env.SSH_PROXY_PORT || '22',
  SSH_PROXY_USER: process.env.SSH_PROXY_USER,
  SSH_PROXY_PASSWORD: process.env.SSH_PROXY_PASSWORD,
  SSH_PROXY_KEY: process.env.SSH_PROXY_KEY,

  // 测试配置
  IN_DEV: process.env.IN_DEV || 'false',
  PRODUCT_WDIO_PASSWORD: process.env.PRODUCT_WDIO_PASSWORD || 'password',
  DEV_WDIO_PASSWORD: process.env.DEV_WDIO_PASSWORD || 'password',

  // 其他配置
  E2E_PLATFORM: process.env.E2E_PLATFORM || 'Local',
  FEISHU_TOKEN: process.env.FEISHU_TOKEN,
  FEISHU_ME: process.env.FEISHU_ME,
  LOGGER_SERVER: process.env.LOGGER_SERVER,
  TRANSITER_SH_SERVER: process.env.TRANSITER_SH_SERVER,
  MONGODB_URI: process.env.MONGODB_URI,
  CLOUDINARY_URL: process.env.CLOUDINARY_URL,
  CLOUDINARY_MASK: process.env.CLOUDINARY_MASK
};

// 检查必要的环境变量
function checkEnvironment() {
  const required = [];

  if (!env.PRODUCT_WDIO_PASSWORD) {
    required.push('PRODUCT_WDIO_PASSWORD');
  }

  if (env.SSH_PROXY_HOST && (!env.SSH_PROXY_USER || (!env.SSH_PROXY_PASSWORD && !env.SSH_PROXY_KEY))) {
    required.push('SSH_PROXY_USER 和 SSH_PROXY_PASSWORD/SSH_PROXY_KEY (如果使用 SSH 代理)');
  }

  if (required.length > 0) {
    console.error('缺少必要的环境变量:');
    required.forEach(varName => {
      console.error(`  - ${varName}`);
    });
    console.error('\n请在 .env 文件中设置这些变量，或直接在命令行中设置。');
    process.exit(1);
  }
}

// 打印配置信息
function printConfig() {
  console.log('='.repeat(50));
  console.log('本地 CRX 测试配置');
  console.log('='.repeat(50));

  console.log(`测试环境: ${env.IN_DEV === 'true' ? '开发环境' : '生产环境'}`);
  console.log(`平台: ${env.E2E_PLATFORM}`);

  if (env.SSH_PROXY_HOST) {
    console.log(`SSH 代理: ${env.SSH_PROXY_USER}@${env.SSH_PROXY_HOST}:${env.SSH_PROXY_PORT}`);
    console.log(`认证方式: ${env.SSH_PROXY_KEY ? 'SSH 密钥' : '密码'}`);
  } else {
    console.log('SSH 代理: 未启用');
  }

  console.log('='.repeat(50));
}

// 运行测试
function runTest() {
  const testScript = path.join(__dirname, 'tests', 'crxTest.js');

  console.log('开始本地测试...');
  console.log(`测试脚本: ${testScript}`);
  console.log('='.repeat(50));

  const testProcess = spawn('node', [testScript], {
    stdio: 'inherit',
    env: env,
    shell: true
  });

  testProcess.on('close', (code) => {
    console.log('='.repeat(50));
    console.log(`测试完成，退出码: ${code}`);

    if (code === 0) {
      console.log('✅ 测试成功');
    } else {
      console.log('❌ 测试失败');
    }

    console.log('='.repeat(50));
  });

  testProcess.on('error', (err) => {
    console.error('测试执行失败:', err);
    process.exit(1);
  });
}

// 主函数
function main() {
  console.log('🚀 本地 CRX 测试启动器');
  console.log('');

  // 检查环境变量
  checkEnvironment();

  // 打印配置信息
  printConfig();

  // 运行测试
  runTest();
}

// 运行主函数
if (require.main === module) {
  main();
}

module.exports = {
  checkEnvironment,
  printConfig,
  runTest
};