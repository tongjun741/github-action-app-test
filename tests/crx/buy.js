const WebdriverAjax = require('wdio-intercept-service').default; // 关键：.default
const { feishuNotify, sleep, outputLog, dateFormat } = require('../include/tools');

const interceptServiceLauncher = new WebdriverAjax();

async function buy(targetBrowser) {
    if (targetBrowser) {
        browser = targetBrowser;
    }

    let isDev = process.env.IN_DEV === "true";
    let domain = isDev ? "dev.thinkoncloud.cn" : "tkshop.szdamai.com";
    let apiDomain = isDev ? "dev.thinkoncloud.cn" : "api.szdamai.com";
    let adminDomain = isDev ? "admin.thinkoncloud.cn" : "admin.szdamai.com";

    interceptServiceLauncher.before(null, null, browser);
    // 新开一个窗口，访问购买页面
    await browser.newWindow(`https://${domain}/newCombo`);
    browser.setupInterceptor();

    // 验证页面标题
    outputLog("验证页面标题");
    let title = await browser.getTitle();
    outputLog(`当前窗口标题是${title}`);

    outputLog("开始购买")
    await browser.$(`.main .card:nth-child(2) button`).waitForExist({ timeout: 30 * 1000 });
    await browser.$(`.main .card:nth-child(2) button`).click();
    await sleep(1000);
    await browser.$(`.pay-method.BankPay`).waitForExist();
    await browser.$(`.pay-method.BankPay`).click();
    await sleep(1000);
    await browser.$(`.react-draggable .ant-modal-footer .ant-btn-primary`).waitForExist();
    await browser.$(`.react-draggable .ant-modal-footer .ant-btn-primary`).click();
    await sleep(1000);
    await browser.$(`.ant-modal-confirm-btns .ant-btn-primary`).waitForExist();
    await browser.$(`.ant-modal-confirm-btns .ant-btn-primary`).click();
    await sleep(1000);
    await browser.$(`//span[text()="已完成转账"]`).waitForExist();
    await browser.$(`//span[text()="已完成转账"]`).click();
    await sleep(1000);
    await browser.$(`//span[text()="确认已付款"]`).waitForExist();
    await browser.$(`//span[text()="确认已付款"]`).click();
    await sleep(3 * 1000);

    // 6. 获取拦截的请求
    const requests = await browser.getRequests();
    console.log('拦截到的请求:', requests);
    // 请求URL: https://api.szdamai.com/api/payment/orders/328322783387663/detail, 方法: GET
    // 响应内容: {"success":true,"code":0,"message":null,"data":{"id":328322783387663,"serialNumber":"2025102812093269","orderType":"BuyTkshop","automatic":null,"createTime":"Tue, 28 Oct 2025 11:06:14 +0800","lockTime":"Tue, 28 Oct 2025 11:06:14 +0800","creatorId":325281164300294,"nickname":"用户d5972c511557","parentOrderId":null,"totalPrice":600,"payablePrice":600,"discountReason":null,"realPrice":600,"presentAmount":null,"balanceAmount":0,"voucherCardNumber":null,"voucherAmount":0,"cashPayType":"BankPay","payStatus":"Locked","productionStatus":"NotStart","productionRemarks":null,"salesReduction":null,"earnedPartner":null,"bankPayConfig":{"accountName":"深圳市云上悦动科技有限公司","accountNumber":"337010100102252166","bankName":"兴业银行股份有限公司深圳分行"},"earnedPartnerDto":null},"requestId":null}
    let orderDetailReq = requests.find(o => o.url.match(/\/api\/payment\/orders\/\d+\/detail/) && o.method === 'GET');
    if (!orderDetailReq) {
        throw new Error("未找到购买订单详情请求");
    }
    let orderId = orderDetailReq.response.body.data.id;
    // api/tkshop/createBuyTkshop
    let createBuyTkshopReq = requests.find(o => o.url.match(/\/api\/tkshop\/createBuyTkshop/));
    if (!createBuyTkshopReq) {
        throw new Error("未找到购买请求");
    }
    let teamId = createBuyTkshopReq.response.body.data.team.id;
    outputLog(`购买完成，需要管理员确认，订单ID是${orderId}，团队ID是${teamId}`);
    let adminUrl = `https://${adminDomain}/operationData/orderManage/orderDetail/${orderId}`;

    let msg = `插件测试，购买TK套餐完成，需要管理员确认\n${adminUrl}\n` + `\n<at user_id=\"${process.env.FEISHU_ME}\">me</at>`;
    outputLog(`发送飞书消息通知管理员确认`);
    await feishuNotify(msg);

    while (true) {
        await sleep(10 * 1000);
        // 发送ajax请求，查询订单状态
        let result = await browser.executeAsync((url, teamId, done) => {
            fetch(url, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'x-dm-team-id': teamId
                }
            })
                .then(response => response.json())
                .then(data => done(data))
                .catch(error => done({ error: error.message }));
        }, `https://${apiDomain}/api/payment/orders/${orderId}/detail`, teamId);
        console.log('订单详情查询结果:', JSON.stringify(result, null, 2));
        if (result.data && result.data.payStatus === "PAID") {
            outputLog("管理员已确认订单，购买流程结束");
            break;
        }
    }

    await browser.url(`https://${domain}/team/${teamId}/shop`);
    await browser.$(`#teamName`).waitForExist({ timeout: 30 * 1000 });
    await browser.$(`#teamName`).click();
    let teamName=`crxTest-${dateFormat(new Date())}`;
    await browser.$('#teamName').setValue(teamName);
    await browser.$(`.react-draggable .ant-btn-primary`).click();
    return {
        orderId, teamId, teamName
    }
};

module.exports = buy;
