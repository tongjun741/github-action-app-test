const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp'); // 用于图像处理

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 存储客户端和屏幕状态
const clients = new Map(); // 客户端ID -> WebSocket连接
let lastScreenshot = null; // 上一帧截图数据
let lastScreenshotTime = 0;

// 处理屏幕差分数据的函数（修复Buffer offset错误的核心部分）
function processScreenDiff(currentBuffer, previousBuffer) {
    try {
        // 1. 确保两帧图像尺寸相同（简化处理，实际应先验证尺寸）
        if (!previousBuffer) {
            return { isFullFrame: true, buffer: currentBuffer };
        }

        // 2. 计算差异区域（这里简化处理，实际应逐像素比较）
        const diffRegions = findDiffRegions(currentBuffer, previousBuffer);
        
        // 3. 准备差分数据Buffer
        // 每个差异区域需要: x(4字节) + y(4字节) + width(4字节) + height(4字节) + 数据长度(4字节) + 数据
        const headerSize = 4; // 存储差异区域数量（4字节）
        const regionHeaderSize = 4 * 5; // 每个区域的元数据大小
        const regionsDataSize = diffRegions.reduce((sum, region) => {
            return sum + region.data.length;
        }, 0);
        
        // 计算总需要的Buffer长度（确保足够容纳所有数据）
        const totalSize = headerSize + diffRegions.length * regionHeaderSize + regionsDataSize;
        const buffer = Buffer.alloc(totalSize);
        let offset = 0;

        // 写入区域数量（4字节）
        buffer.writeUInt32BE(diffRegions.length, offset);
        offset += 4;

        // 写入每个差异区域的数据（修复offset计算错误）
        for (const region of diffRegions) {
            // 验证offset是否足够写入当前区域的元数据（4*5=20字节）
            if (offset + 20 > buffer.length) {
                throw new Error(`Buffer容量不足，无法写入区域元数据，当前offset: ${offset}, 所需: 20, 总长度: ${buffer.length}`);
            }

            // 写入区域元数据（x, y, width, height, dataLength）
            buffer.writeUInt32BE(region.x, offset);         offset += 4;
            buffer.writeUInt32BE(region.y, offset);         offset += 4;
            buffer.writeUInt32BE(region.width, offset);     offset += 4;
            buffer.writeUInt32BE(region.height, offset);    offset += 4;
            buffer.writeUInt32BE(region.data.length, offset); offset += 4;

            // 验证offset是否足够写入当前区域的图像数据
            if (offset + region.data.length > buffer.length) {
                throw new Error(`Buffer容量不足，无法写入区域数据，当前offset: ${offset}, 数据长度: ${region.data.length}, 总长度: ${buffer.length}`);
            }

            // 写入区域图像数据
            region.data.copy(buffer, offset);
            offset += region.data.length;
        }

        return { isFullFrame: false, buffer };
    } catch (error) {
        console.error('处理差分数据失败:', error);
        // 出错时返回完整帧，避免客户端异常
        return { isFullFrame: true, buffer: currentBuffer };
    }
}

// 模拟查找差异区域（实际应实现像素级比较）
function findDiffRegions(current, previous) {
    // 这里简化处理，实际项目中需要：
    // 1. 解析图像像素数据
    // 2. 比较两帧的像素差异
    // 3. 合并相邻的差异像素为矩形区域
    return [
        {
            x: 100,
            y: 100,
            width: 200,
            height: 150,
            data: current.slice(1024, 1024 + 200*150*4) // 假设的差异区域数据
        }
    ];
}

// 定时截取屏幕并发送
setInterval(async () => {
    try {
        const tempPath = path.join(__dirname, `screenshot-${Date.now()}.png`);
        
        // 截取屏幕（macOS示例，Windows/Linux需替换命令）
        await new Promise((resolve, reject) => {
            exec(`screencapture -x -t png ${tempPath}`, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        // 读取并处理图像
        const currentBuffer = await sharp(tempPath)
            .webp({ quality: 70 }) // 转为WebP减少体积
            .toBuffer();

        // 清理临时文件
        fs.unlinkSync(tempPath);

        // 计算差分数据（或完整帧）
        const { isFullFrame, buffer } = processScreenDiff(currentBuffer, lastScreenshot);
        lastScreenshot = currentBuffer;
        lastScreenshotTime = Date.now();

        // 发送给所有客户端
        clients.forEach((ws, clientId) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: isFullFrame ? 'fullFrame' : 'diffFrame',
                    timestamp: Date.now(),
                    data: buffer.toString('base64')
                }));
            }
        });
    } catch (error) {
        console.error('截图处理失败:', error);
    }
}, 1000);

// 处理WebSocket连接
wss.on('connection', (ws) => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    clients.set(clientId, ws);
    console.log(`新客户端连接: ${clientId}`);

    // 处理客户端消息
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            // 处理鼠标/键盘事件（根据实际需求实现）
            if (message.type === 'mouseEvent' || message.type === 'keyEvent') {
                // 执行系统操作（如模拟鼠标点击）
                // simulateInput(message);
            }
        } catch (error) {
            console.error('处理客户端消息失败:', error);
        }
    });

    // 客户端断开连接
    ws.on('close', () => {
        clients.delete(clientId);
        console.log(`客户端断开连接: ${clientId}`);
    });

    // 处理错误
    ws.on('error', (error) => {
        console.error(`客户端错误 [${clientId}]:`, error);
    });
});

// 启动服务器
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
});