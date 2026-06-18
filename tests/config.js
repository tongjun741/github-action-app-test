let devConfig = {
    username: '945b33aa5652@drmail.in',
    teamName: '945b33的团队',
    shopName: ['demo-1'],
    win7shopName: 'UA109',
};

let productConfig = {
    username: '8606d3fbe819@drmail.in',
    teamName: '用户8606的团队',
    shopName1: ['UA146', 'UA144', 'UA142'],
    shopName: [
        "UA146",
        "UA144",
        "UA142",
        "UA140",
        "UA138",
        "UA136",
        "UA134",
        "UA132",
        "UA130",
        "UA128",
        "UA125",
        // "UA120", --- 120似乎无法连接调试端口，先不管 ---
    ],
    win7shopName: 'UA109',
};

let ipTestConfig = {
    username: '1bc01c597f3b@drmail.in',
    teamName: 'TK私信-只养不发',
    // teamName: "童俊的测试团队",
    shopName: ['UA146'],
};

let devCrxTestConfig = {
    username: '74dc8891867e@drmail.in',
};

let productCrxTestConfig = {
    username: 'd5972c511557@drmail.in',
};

module.exports = {
    devConfig, productConfig, ipTestConfig, devCrxTestConfig, productCrxTestConfig
};
