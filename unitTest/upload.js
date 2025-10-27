
const { uploadFile } = require('../tests/include/tools');

async function main() {
    let url = await uploadFile('./tests/include/browser-screenshot.png');
    console.log(`截图上传结果：${url}`);
}

main();