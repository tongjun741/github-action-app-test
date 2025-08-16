const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp'); // 用于图像处理

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 配置静态文件目录
app.use(express.static(path.join(__dirname, 'public')));

// 存储客户端和屏幕状态
const clients = new Map(); // 客户端ID -> WebSocket连接
let lastScreenshot = null; // 上一帧截图数据
let lastScreenshotTime = 0;

// 存储最后一次鼠标位置
let lastMousePosition = { x: -1, y: -1 };
// 移动命令的最小距离阈值
const MOVE_THRESHOLD = 2;
// 记录当前是否处于拖拽状态
let isDragging = false;

// macOS键盘按键码映射表 (key值 -> key code)
const KEY_CODE_MAP = {
    // 字母键
    'a': 0, 'b': 11, 'c': 8, 'd': 2, 'e': 14, 'f': 3, 'g': 5,
    'h': 4, 'i': 34, 'j': 38, 'k': 40, 'l': 37, 'm': 46, 'n': 45,
    'o': 31, 'p': 35, 'q': 12, 'r': 15, 's': 1, 't': 17, 'u': 32,
    'v': 9, 'w': 13, 'x': 7, 'y': 16, 'z': 6,

    // 数字键
    '0': 29, '1': 18, '2': 19, '3': 20, '4': 21, '5': 23,
    '6': 22, '7': 26, '8': 28, '9': 25,

    // 功能键
    'Enter': 36, 'Backspace': 51, 'Delete': 117,
    'ArrowUp': 126, 'ArrowDown': 125, 'ArrowLeft': 123, 'ArrowRight': 124,
    'Tab': 48, 'Escape': 53, ' ': 49,
    'Shift': 56, 'ShiftLeft': 56, 'ShiftRight': 60,
    'Control': 59, 'ControlLeft': 59, 'ControlRight': 62,
    'Alt': 58, 'AltLeft': 58, 'AltRight': 61,
    'Meta': 55, 'MetaLeft': 55, 'MetaRight': 54,
    'F1': 122, 'F2': 120, 'F3': 99, 'F4': 118, 'F5': 96,
    'F6': 97, 'F7': 98, 'F8': 100, 'F9': 101, 'F10': 109,
    'F11': 103, 'F12': 111,

    // 符号键
    '!': 18, '@': 19, '#': 20, '$': 21, '%': 23, '^': 22,
    '&': 26, '*': 28, '(': 25, ')': 29,
    '-': 27, '_': 27, '=': 24, '+': 24,
    '[': 33, '{': 33, ']': 30, '}': 30,
    ';': 41, ':': 41, "'": 39, '"': 39,
    ',': 43, '<': 43, '.': 47, '>': 47,
    '/': 44, '?': 44, '`': 50, '~': 50,
    '\\': 42, '|': 42
};

// 执行鼠标点击命令
function simulateClick(x, y) {
    const command = `cliclick c:${x},${y}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`执行点击命令失败: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`命令错误输出: ${stderr}`);
            return;
        }
        console.log(`已在位置 (${x}, ${y}) 执行点击`);
    });
}

// 执行鼠标双击命令
function simulateMouseDoubleClick(x, y) {
    const command = `cliclick dc:${x},${y}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`执行双击命令失败: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`命令错误输出: ${stderr}`);
            return;
        }
        console.log(`已在位置 (${x}, ${y}) 执行双击`);
    });
}

// 执行鼠标按下命令 (开始拖拽)
function simulateMouseDown(x, y) {
    isDragging = true;
    /**
     * dd:x,y  Will press down to START A DRAG at the given coordinates.
          Example: “dd:12,34” will press down at the point with x
          coordinate 12 and y coordinate 34. Instead of x and y values,
          you may also use “.”, which means: the current position.
     */
    const command = `cliclick dd:${x},${y}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`执行按下命令失败: ${error.message}`);
            isDragging = false;
            return;
        }
        if (stderr) {
            console.error(`命令错误输出: ${stderr}`);
            return;
        }
        console.log(`已在位置 (${x}, ${y}) 按下鼠标`);
    });
}

// 执行鼠标释放命令 (结束拖拽)
function simulateMouseUp(x, y) {
    isDragging = false;
    /*
    du Will release to END A DRAG at the given coordinates.
          Example: “du:112,134” will release at the point with x
          coordinate 112 and y coordinate 134.
    */
    const command = `cliclick du:${x},${y}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`执行释放命令失败: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`命令错误输出: ${stderr}`);
            return;
        }
        console.log(`已在位置 (${x}, ${y}) 释放鼠标`);
    });
}

// 执行拖动命令
function simulateDragMove(x, y) {
    // 更新最后位置
    lastMousePosition.x = x;
    lastMousePosition.y = y;

    /**dm:x,y  Will continue the DRAG event to the given coordinates.
          Example: “dm:112,134” will drag and continue to the point with x
          coordinate 112 and y coordinate 134.
    */
    const command = `cliclick dm:${x},${y}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`执行拖动命令失败: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`命令错误输出: ${stderr}`);
            return;
        }
    });
    console.log(`已将鼠标拖动到 (${x}, ${y}) `);
}

// 执行鼠标移动命令
function simulateMouseMove(x, y) {
    // 计算与上次位置的距离
    const distance = Math.sqrt(
        Math.pow(x - lastMousePosition.x, 2) +
        Math.pow(y - lastMousePosition.y, 2)
    );

    // 如果距离小于阈值，则不执行移动命令
    if (distance < MOVE_THRESHOLD) {
        return;
    }

    // 更新最后位置
    lastMousePosition.x = x;
    lastMousePosition.y = y;

    // 移动命令
    /**m:x,y   Will MOVE the mouse to the point with the given coordinates.
          Example: “m:12,34” will move the mouse to the point with
          x coordinate 12 and y coordinate 34.
    */
    const command = `cliclick m:${x},${y}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`执行移动命令失败: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`命令错误输出: ${stderr}`);
            return;
        }
    });
    console.log(`已将鼠标移动到 (${x}, ${y}) `);
}

// 处理键盘事件（使用osascript实现）
function simulateKey(key, isDown) {
    // 获取对应的key code
    let keyCode = KEY_CODE_MAP[key];

    // 处理大写字母（需要Shift键）
    if (!keyCode && key >= 'A' && key <= 'Z') {
        keyCode = KEY_CODE_MAP[key.toLowerCase()];
        if (keyCode) {
            // 对于大写字母，先按下Shift，再按下字母，再释放Shift
            if (isDown) {
                exec(`osascript -e 'tell application "System Events" to key down shift'`);
                setTimeout(() => {
                    exec(`osascript -e 'tell application "System Events" to key code ${keyCode}'`);
                }, 50);
            } else {
                exec(`osascript -e 'tell application "System Events" to key up shift'`);
            }
            return;
        }
    }

    if (keyCode === undefined) {
        console.warn(`未找到键 "${key}" 的映射，无法模拟`);
        return;
    }

    // 构建osascript命令
    const command = `osascript -e 'tell application "System Events" to ${isDown ? "key down" : "key up"} key code ${keyCode}'`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`执行键盘命令失败: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`命令错误输出: ${stderr}`);
            return;
        }
        console.log(`已${isDown ? '按下' : '释放'}键: ${key} (code: ${keyCode})`);
    });
}

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
            buffer.writeUInt32BE(region.x, offset); offset += 4;
            buffer.writeUInt32BE(region.y, offset); offset += 4;
            buffer.writeUInt32BE(region.width, offset); offset += 4;
            buffer.writeUInt32BE(region.height, offset); offset += 4;
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
            data: current.slice(1024, 1024 + 200 * 150 * 4) // 假设的差异区域数据
        }
    ];
}

// 定时截取屏幕并发送
let frameIndex = 0;
setInterval(async () => {
    try {
        frameIndex++;
        // 使用系统临时目录保存截屏
        const tempPath = path.join(os.tmpdir(), `screenshot-${Date.now()}.png`);

        // 截取屏幕（macOS示例，Windows/Linux需替换命令）
        await new Promise((resolve, reject) => {
            exec(`screencapture -x -t png ${tempPath}`, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        // 读取并处理图像
        const currentBuffer = await sharp(tempPath)
            .webp({ quality: 30 }) // 转为WebP减少体积
            .toBuffer();

        // 清理临时文件
        fs.unlinkSync(tempPath);

        // 每10秒发送一次完整帧给所有客户端
        // 只发完整帧
        if (true || frameIndex % 10 == 0) {
            clients.forEach((ws, clientId) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'fullFrame',
                        timestamp: Date.now(),
                        data: currentBuffer.toString('base64')
                    }));
                }
            });
        } else {
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
        }
    } catch (error) {
        console.error('截图处理失败:', error);
    }
}, 1000);

// 处理WebSocket连接
wss.on('connection', (ws) => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    clients.set(clientId, ws);
    console.log(`新客户端连接: ${clientId}`);

    // 发送心跳包保持连接
    ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
    const heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
        }
    }, 10000);

    // 处理客户端消息
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());

            // 处理鼠标点击事件
            if (message.type === 'mouseClick') {
                const { x, y } = message;
                if (typeof x === 'number' && typeof y === 'number') {
                    simulateClick(x, y);
                }
            }
            // 处理鼠标双击事件
            else if (message.type === 'mouseDoubleClick') {
                const { x, y } = message;
                if (typeof x === 'number' && typeof y === 'number') {
                    simulateMouseDoubleClick(x, y);
                }
            }
            // 处理鼠标按下事件（开始拖拽）
            else if (message.type === 'mouseDown') {
                const { x, y } = message;
                if (typeof x === 'number' && typeof y === 'number') {
                    simulateMouseDown(x, y);
                }
            }
            // 处理鼠标拖动事件
            else if (message.type === 'dragMove') {
                const { x, y } = message;
                if (typeof x === 'number' && typeof y === 'number') {
                    simulateDragMove(x, y);
                }
            }
            // 处理鼠标释放事件（结束拖拽）
            else if (message.type === 'mouseUp') {
                const { x, y } = message;
                if (typeof x === 'number' && typeof y === 'number') {
                    simulateMouseUp(x, y);
                }
            }
            // 处理鼠标移动事件
            else if (message.type === 'mouseMove') {
                const { x, y } = message;
                if (typeof x === 'number' && typeof y === 'number') {
                    simulateMouseMove(x, y);
                }
            }
            // 处理键盘事件
            else if (message.type === 'keyEvent') {
                const { key, isDown } = message;
                if (key && typeof isDown === 'boolean') {
                    simulateKey(key, isDown);
                }
            }
        } catch (error) {
            console.error('解析客户端消息失败:', error);
            console.error('原始数据:', data.toString());
        }
    });

    // 客户端断开连接
    ws.on('close', () => {
        clients.delete(clientId);
        clearInterval(heartbeatInterval);
        console.log(`客户端断开连接: ${clientId}`);
        // 重置状态
        lastMousePosition = { x: -1, y: -1 };
        isDragging = false;
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