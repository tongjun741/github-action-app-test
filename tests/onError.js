const screenshot = require('screenshot-desktop');
const { feishuNotify, uploadFile, showResultTable } = require('./include/tools');

async function main() {
    let url = "屏幕截图失败";
    let errorMsg = "";
    try {
        // 屏幕截图
        await screenshot({ filename: 'screenshot.png' })
            .then((imagePath) => {
                console.log('Screenshot saved at:', imagePath);
            })
            .catch((err) => {
                console.error('Error taking screenshot:', err);
            });

        url = await uploadFile('screenshot.png');
    } catch (e) {
        errorMsg += e.message + '\n';
        console.error(e);
    }

    let msg = `E2E屏幕截图：${url}\n<at user_id=\"${process.env.FEISHU_ME}\">me</at>\n${errorMsg}`;
    let rs = await showResultTable();
    msg += `${rs}`;
    console.log(msg);
    await feishuNotify(msg);
}

main();