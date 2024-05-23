const axios = require('axios');

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
    await axios.post(webhookUrl, message)
        .then(response => {
            console.log('通知发送成功:', response.data);
        })
        .catch(error => {
            console.error('发送通知时出错:', error);
        });
}

module.exports = {
    sleep, feishuNotify
};