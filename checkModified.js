const https = require('https');
const fs = require('fs');

async function main() {
    // 先检查生产环境
    let checkModifiedResult = [];
    try {
        // 生产环境检查https://www.szdamai.com/static.config.json
        const fileUrl = 'https://www.szdamai.com/static.config.json';
        try {
            // 检查last_modified_product.json文件是否存在
            const filePath = './last_modified_product.json';
            let lastModified = {};
            if (fs.existsSync(filePath)) {
                // 文件存在，读取并解析 JSON 对象
                const content = fs.readFileSync(filePath);
                lastModified = JSON.parse(content);
                console.log(data);
            } else {
                console.error('last_modified_product.json文件不存在！');
            }

            const response = https.get(fileUrl);
            console.log('文件下载完成！');
            const versions = JSON.parse(response.body);

            // 对比版本是否有变化
            const versionEventList = [
                {
                    key: 'windows10AppVersion',
                    platform: 'win10',
                    url: 'https://dl.szdamai.com/downloads/win10_app_zh/HuaYoungApp_Win10_%version%_zh_setup.exe'
                },
                {
                    key: 'windows7AppVersion',
                    platform: 'win7',
                    url: 'https://dl.szdamai.com/downloads/win7_app_zh/HuaYoungApp_Win7_%version%_zh_setup.exe'
                },
                {
                    key: 'macX64AppVersion',
                    platform: 'macOS',
                    url: 'https://dl.szdamai.com/downloads/mac_x64_app_zh/HuaYoungApp_Mac_x64_%version%_zh_setup.dmg'
                },
                {
                    key: 'linuxAppVersion',
                    platform: 'linux',
                    url: 'https://dl.szdamai.com/downloads/ubuntu_app_zh/HuaYoungApp_Ubuntu_%version%_zh_setup.deb'
                }
            ];
            versionEventList.forEach(o => {
                if (!lastModified[o.platform] || versions[o.key] != lastModified[o.platform]) {
                    checkModifiedResult.push(`${o.platform}=${o.url.replace('%version%', versions[o.key])}`);
                    lastModified[o.platform] = versions[o.key];
                }
            });

            // 写入last_modified_product.json
            fs.writeFileSync('last_modified_product.json', JSON.stringify(lastModified));
        } catch (err) {
            console.error(`文件下载失败：${err.message}`);
        }

        // 如果生产环境没有变化就检查测试环境
        if (checkModifiedResult.length < 1) {
            // 检查last_modified_product.json文件是否存在
            const filePath = './last_modified_dev.json';
            let lastModified = {};
            if (fs.existsSync(filePath)) {
                // 文件存在，读取并解析 JSON 对象
                const content = fs.readFileSync(filePath);
                lastModified = JSON.parse(content);
                console.log(data);
            } else {
                console.error('last_modified_dev.json文件不存在！');
            }

            // 测试环境通过检查last-modified是否有新的变化
            // 对比版本是否有变化
            const versionEventList = [
                {
                    platform: 'win10',
                    url: 'https://dev.thinkoncloud.cn/downloads/win10_app_zh/HuaYoungApp_Win10_dev_zh_setup.exe'
                },
                {
                    platform: 'win7',
                    url: 'https://dev.thinkoncloud.cn/downloads/win7_app_zh/HuaYoungApp_Win7_dev_zh_setup.exe'
                },
                {
                    platform: 'macOS',
                    url: 'https://dev.thinkoncloud.cn/downloads/mac_x64_app_zh/HuaYoungApp_Mac_x64_dev_zh_setup.dmg'
                },
                {
                    platform: 'linux',
                    url: 'https://dev.thinkoncloud.cn/downloads/ubuntu_app_zh/HuaYoungApp_Ubuntu_dev_zh_setup.deb'
                }
            ];
            for (let i = 0; i < versionEventList.length; i++) {
                let o = versionEventList[i];
                await getLastModified(o.url)
                    .then((lastModified) => {
                        console.log(`文件的 Last-Modified 信息为：${lastModified}`);
                        if (!lastModified[o.platform] || lastModified != lastModified[o.platform]) {
                            checkModifiedResult.push(`${o.platform}=${o.url}`);
                            lastModified[o.platform] = lastModified;
                        }
                    })
                    .catch((error) => {
                        console.error(`请求出错：${error.message}`);
                    });
            }

            // 写入last_modified_dev.json
            fs.writeFileSync('last_modified_dev.json', JSON.stringify(lastModified));
        }

        // 写入checkModified.result
        fs.writeFileSync('checkModified.result', checkModifiedResult.join('\n'));
    } catch (err) {
        console.error(`检查失败：${err.message}`);
    }
}

function getLastModified(url) {
    return new Promise((resolve, reject) => {
        const options = {
            method: 'HEAD',
            headers: {
                'User-Agent': 'Mozilla/5.0' // 设置一个 User-Agent，模拟浏览器请求
            }
        };

        const request = http.request(url, options, (response) => {
            const lastModified = response.headers['last-modified'];

            if (lastModified) {
                resolve(lastModified);
            } else {
                reject(new Error('无法获取文件的 Last-Modified 信息！'));
            }
        });

        request.on('error', (error) => {
            reject(error);
        });

        request.end();
    });
}

main();