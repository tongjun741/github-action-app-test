## 指定驱动Electron的chromedirver目录
Windows:
C:\Users\<Username>\AppData\Local\Temp
C:\Users\<Username>\AppData\Local\Temp\chromedriver\win64-108\chromedriver-win64\chromedriver.exe
Ubuntu:
/tmp
macOS:
/tmp/chromedriver/mac-108/chromedriver-mac-x64/chromedriver
/tmp/chromedriver/mac_arm-108/chromedriver-mac-arm64/chromedriver
需要通过wdio.conf.js中的cacheDir来指定，具体逻辑可以查看以下代码：
```
node_modules\@wdio\utils\build\node\utils.js:235

let executablePath = computeExecutablePath({
```

## 打开会话的chromedirver版本需要由opensession.js中的browserVersion变量指定

## Win 10 本地调试
1、下载https://chromedriver.storage.googleapis.com/108.0.5359.71/chromedriver_win32.zip解压缩出chromedriver.exe放到%temp%\chromedriver\win64-108\chromedriver-win64下
2、以管理员启动CMD，进入项目根目录
3、执行 
```
set "PRODUCT_WDIO_PASSWORD=xxxx"
node yarn wdio
```

## Win7的docker镜像参数只能是7u
win7x64及以下版本会被识别成mido版本，没有sp1
  "7" | "7e" | "win7" | "win7e" | "windows7" | "windows 7" 
  下面的版本用的是en_windows_7_with_sp1_x64.iso
  "7u" | "win7u" | "windows7u" | "windows 7u" 

## 执行IP测试脚本
完成Win 10 的前两条配置后执行下面的脚本：
```
set "PRODUCT_IP_TEST_PASSWORD=xxxx"
node tests\ipTest.js
```

## 远程触发
# Win 10 E2E 测试
```
curl -X POST \
  -H "Authorization: token github_Token" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/tongjun741/github-action-app-test/actions/workflows/Windows10.yml/dispatches \
  -d '{"ref": "main", "inputs": {"do_ip_test": "false", "do_wdio": "true", "in_dev": "false", "software_download_url": "https://dl.szdamai.com/downloads/win10_app_zh/HuaYoungApp_Win10_10.0.648_zh_setup.exe"}}'
```

# Win 10 dev E2E 测试
  curl -X POST \
  -H "Authorization: token github_Token" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/tongjun741/github-action-app-test/actions/workflows/Windows10.yml/dispatches \
  -d '{"ref": "main", "inputs": {"do_ip_test": "false", "do_wdio": "true", "in_dev": "true", "software_download_url": "https://dev.thinkoncloud.cn/downloads/win10_app_zh/HuaYoungApp_Win10_dev_zh_setup.exe"}}'

# Win 10 IP 测试
```
curl -X POST \
  -H "Authorization: token github_Token" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/tongjun741/github-action-app-test/actions/workflows/Windows10.yml/dispatches \
  -d '{"ref": "main", "inputs": {"do_ip_test": "true", "software_download_url": "https://dl.szdamai.com/downloads/win10_app_zh/HuaYoungApp_Win10_10.0.648_zh_setup.exe"}}'
```


# Mac E2E 测试
```
curl -X POST \
  -H "Authorization: token github_Token" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/tongjun741/github-action-app-test/actions/workflows/macOS.yml/dispatches \
  -d '{"ref": "main", "inputs": {"in_dev": "false", "is_arm": "true", "software_download_url": "https://dl.szdamai.com/downloads/mac_arm64_app_zh/HuaYoungApp_Mac_arm64_10.0.559_zh_setup.dmg"}}'
```

# Ubuntu E2E 测试
```
curl -X POST \
  -H "Authorization: token github_Token" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/tongjun741/github-action-app-test/actions/workflows/Linux.yml/dispatches \
  -d '{"ref": "main", "inputs": {"in_dev": "false", "software_download_url": "https://dl.szdamai.com/downloads/ubuntu_app_zh/HuaYoungApp_Ubuntu_10.0.533_zh_setup.deb"}}'
```