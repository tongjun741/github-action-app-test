const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { MongoClient, ServerApiVersion } = require('mongodb');

const e2eResultKey = "e2eTestResult";
let mongoClient;

const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const outputLog = (msg) => {
    console.log(`【${new Date().toUTCString()}】${msg}`);
}

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

const uploadFile = async (filePath) => {
    let fileName = path.basename(filePath);
    // 读取要上传的文件
    const fileStream = fs.createReadStream(filePath);

    // 设置请求参数
    const uploadUrl = `${process.env.TRANSITER_SH_SERVER}/${fileName}`;

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

const screenshot = async (browser, fileName) => {
    let url = "截图失败";

    // 截图
    const filePath = path.join(__dirname, fileName);
    try {
        await browser.saveScreenshot(filePath);
    } catch (e) {
        return `截图失败：${e.message}`;
    }

    url = uploadFile(filePath);
    return url;
};

const saveResult = async (isDev, platform, result) => {
    let rs = {};
    let myColl;
    // 先取出上次保存的结果
    try {
        myColl = await getMongoConnect();
        const documents = await myColl.find({
            "key": e2eResultKey
        }).toArray();
        rs = documents[0];
        if (typeof rs !== "object") {
            rs = {};
        }
    } catch (e) {
        rs = {};
    }

    // 区分是否测试环境
    let env = isDev ? 'dev' : 'product';
    if (!rs[env]) {
        rs[env] = {};
    }

    if (!rs[env][platform]) {
        rs[env][platform] = [];
    }
    rs[env][platform].push(result);
    // 最多保留10个结果
    let maxLength = 10;
    if (rs[env][platform].length > maxLength) {
        rs[env][platform] = rs[env][platform].slice(-maxLength);
    }

    // 保存新结果
    try {
        myColl = await getMongoConnect();
        // 执行更新操作
        let r = await myColl.updateOne({
            "key": e2eResultKey
        }, {
            $set: rs,
        }, { upsert: true });
        console.log(r);
    } catch (error) {
        console.error('保存E2E测试结果失败:', error);
    }

    // 输出到日志服务器，方便查看
    let data = `text=`;
    data += await showResultTable(true);
    data += await showResultTable(false);
    await axios.post('http://ds.0728123.xyz:65080/e2eTestResult', data, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    })
        .then(response => {
            console.log('Response:', response.data);
        })
        .catch(error => {
            console.error('Error:', error);
        });
};

const showResultTable = async (isDev) => {
    let rs = {};
    // 先取出之前保存的测试结果
    try {
        let myColl = await getMongoConnect();
        const documents = await myColl.find({
            "key": e2eResultKey
        }).toArray();
        rs = documents[0] || {};
    } catch (e) {
        rs = {};
    }

    // 输出每个平台的最后三次测试结果
    let env = isDev ? 'dev' : 'product';
    let str = "";
    if (rs[env]) {
        str = Object.keys(rs[env]).sort().map((k) => {
            let v = rs[env][k];
            let t = v.slice(-3).join(',');
            return `${k}: ${t}`;
        }).join('\n');
    }

    return `【${isDev ? "测试环境" : "生产环境"}】E2E测试记录汇总：\n${str}\n`;
};

const getMongoConnect = async () => {
    let client;
    if (!mongoClient) {
        let uri = process.env.MONGODB_URI;
        // Create a MongoClient with a MongoClientOptions object to set the Stable API version
        client = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });

        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
    }
    const myDB = client.db("myDB");
    const myColl = myDB.collection("e2e");
    return myColl;
}

module.exports = {
    sleep, feishuNotify, screenshot, saveResult, showResultTable, uploadFile, outputLog
};