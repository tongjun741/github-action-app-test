const axios = require('axios');
const path = require('path');
const fs = require('fs');

const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const feishuNotify = async (msg) => {
    // 飞书机器人Webhook URL
    const webhookUrl = `https://open.feishu.cn/open-apis/bot/v2/hook/${process.env.FEISHU_TOKEN}`;

    // 要发送的消息内容
    const message = {
        msg_type: 'text',
        content: {
            text: `【花漾】${msg}`
        }
    };

    // 发送POST请求
    console.log(message);
    await axios.post(webhookUrl, message)
        .then(response => {
            console.log('通知发送成功:', response.data);
        })
        .catch(error => {
            console.error('发送通知时出错:', error);
        });
}

const screenshot = async (browser, fileName) => {
    let url = "截图失败";

    // 截图
    const filePath = path.join(__dirname, fileName);
    try {
        await browser.saveScreenshot(filePath);
    } catch (e) {
        return `截图失败：${e.message}`;
    }

    // 读取要上传的文件
    const fileStream = fs.createReadStream(filePath);

    // 设置请求参数
    const uploadUrl = `http://ds.0728123.xyz:6180/${fileName}`;

    // 发起请求
    url = "截图上传失败";
    await axios({
        method: 'put',
        url: uploadUrl,
        data: fileStream,
        headers: {
            'Content-Type': 'image/jpeg' // 设置文件类型
        }
    }).then((response) => {
        // 检查响应状态
        if (response.status === 200) {
            console.log("File uploaded successfully.");
        } else {
            console.log("Error occurred:", response.status);
        }

        // 输出完整的响应头
        console.log("Response Headers:");
        for (const [header, value] of Object.entries(response.headers)) {
            console.log(`${header}: ${value}`);
        }

        // 输出响应体
        console.log("\nResponse Body:");
        console.log(response.data);

        // 使用正则表达式解析 URL
        const match = response.data.match(/(?<protocol>http[s]?:\/\/)(?<domain>.*?)(\/(?<path>.*))/);

        if (match) {
            // 提取匹配到的各部分
            const { protocol, domain, path } = match.groups;

            // 在路径之前添加 inline
            url = `${protocol}${domain}/inline/${path}`;

            console.log("预览地址:", url);
        } else {
            console.log("URL parsing failed.");
        }
    })
        .catch((error) => {
            url = `截图上传失败：${error.message}`;
            console.error("Error occurred:", error.message);
        });
    return url;
}

module.exports = {
    sleep, feishuNotify, screenshot
};