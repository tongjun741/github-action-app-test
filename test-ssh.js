#!/usr/bin/env node

/**
 * SSH 连接测试脚本
 * 用于验证 SSH 服务器连接是否正常
 */

require('dotenv').config();
const { Client } = require('ssh2');

// SSH 配置
const sshConfig = {
  host: process.env.SSH_PROXY_HOST,
  port: parseInt(process.env.SSH_PROXY_PORT || '22'),
  username: process.env.SSH_PROXY_USER,
  password: process.env.SSH_PROXY_PASSWORD,
  privateKey: process.env.SSH_PROXY_KEY,
  tryKeyboard: true
};

// 验证配置
function validateConfig() {
  if (!sshConfig.host) {
    console.error('❌ 未配置 SSH_PROXY_HOST');
    return false;
  }

  if (!sshConfig.username) {
    console.error('❌ 未配置 SSH_PROXY_USER');
    return false;
  }

  if (!sshConfig.password && !sshConfig.privateKey) {
    console.error('❌ 未配置 SSH_PROXY_PASSWORD 或 SSH_PROXY_KEY');
    return false;
  }

  return true;
}

// 测试 SSH 连接
function testSSHConnection() {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    console.log('='.repeat(50));
    console.log('SSH 连接测试');
    console.log('='.repeat(50));
    console.log(`服务器: ${sshConfig.host}:${sshConfig.port}`);
    console.log(`用户名: ${sshConfig.username}`);
    console.log(`认证方式: ${sshConfig.privateKey ? 'SSH 密钥' : '密码'}`);
    console.log('='.repeat(50));

    conn.on('ready', () => {
      console.log('✅ SSH 连接成功！');

      // 测试动态端口转发 (模拟 ssh -D 命令)
      console.log('🔄 测试动态端口转发...');
      conn.forwardOut('127.0.0.1', 5080, '', 0, (err) => {
        if (err) {
          console.error('❌ 动态转发失败:', err.message);

          // 尝试备用方法：传统端口转发
          console.log('🔄 尝试备用方法：传统端口转发...');
          conn.forwardOut('', 5080, 'localhost', 5080, (err2) => {
            if (err2) {
              console.error('❌ 备用方法也失败:', err2.message);
              conn.end();
              reject(err2);
            } else {
              console.log('✅ 备用方法成功！SOCKS5 代理可用 (端口: 5080)');
              conn.end();
              resolve();
            }
          });
        } else {
          console.log('✅ 动态转发成功！SOCKS5 代理可用 (端口: 5080)');
          console.log('✅ 等同于执行: ssh -D 5080 命令');
          conn.end();
          resolve();
        }
      });
    });

    conn.on('error', (err) => {
      console.error('❌ SSH 连接失败:', err.message);
      reject(err);
    });

    conn.on('end', () => {
      console.log('📡 SSH 连接已关闭');
    });

    conn.on('close', () => {
      console.log('🔒 SSH 连接已关闭');
    });

    console.log('🔄 正在连接 SSH 服务器...');
    conn.connect(sshConfig);
  });
}

// 测试 SOCKS5 代理
async function testSOCKSProxy() {
  console.log('='.repeat(50));
  console.log('SOCKS5 代理测试');
  console.log('='.repeat(50));

  try {
    // 使用 fetch 测试代理（如果可用）
    const fetch = require('node-fetch');
    const { SocksProxyAgent } = require('socks-proxy-agent');

    const proxyAgent = new SocksProxyAgent(`socks5://localhost:5080`);

    console.log('🔄 通过代理获取 IP 地址...');

    const response = await fetch('https://api.ipify.org?format=json', {
      agent: proxyAgent,
      timeout: 10000
    });

    const data = await response.json();
    console.log(`✅ 代理工作正常！当前 IP: ${data.ip}`);

  } catch (error) {
    console.error('❌ SOCKS5 代理测试失败:', error.message);
    console.log('💡 可能原因:');
    console.log('   - SSH 隧道未建立');
    console.log('   - 端口 5080 被占用');
    console.log('   - 网络连接问题');
  }
}

// 主函数
async function main() {
  console.log('🚀 SSH 连接测试工具');
  console.log('');

  // 验证配置
  if (!validateConfig()) {
    console.log('\n💡 请在 .env 文件中配置以下变量:');
    console.log('   - SSH_PROXY_HOST');
    console.log('   - SSH_PROXY_USER');
    console.log('   - SSH_PROXY_PASSWORD 或 SSH_PROXY_KEY');
    process.exit(1);
  }

  try {
    // 测试 SSH 连接
    await testSSHConnection();

    // 等待一下再测试代理
    console.log('\n⏳ 等待 2 秒...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 测试 SOCKS5 代理
    await testSOCKSProxy();

    console.log('\n🎉 所有测试完成！');

  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    process.exit(1);
  }
}

// 运行主函数
if (require.main === module) {
  main();
}

module.exports = {
  validateConfig,
  testSSHConnection,
  testSOCKSProxy
};