## chromedirver目录
Windows:
C:\Users\<Username>\AppData\Local\Temp
Ubuntu:
/tmp
macOS:
需要通过wdio.conf.js中的cacheDir来指定

## Win 10 本地调试
1、下载https://chromedriver.storage.googleapis.com/108.0.5359.71/chromedriver_win32.zip解压缩出chromedriver.exe放到%temp%\chromedriver\win64-108\chromedriver-win64下
2、以管理员启动CMD，进入项目根目录
3、执行 
```
set "PRODUCT_WDIO_PASSWORD=xxxx"
node yarn wdio
```


## 执行IP测试脚本
完成Win 10 的前两条配置后执行下面的脚本：
```
set "PRODUCT_IP_TEST_PASSWORD=xxxx"
node tests\ipTest.js
```