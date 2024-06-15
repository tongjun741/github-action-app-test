set NODE_SKIP_PLATFORM_CHECK=1
c:\node\node -v

REM 获取当前时间，并格式化为 "HHMMSS" 格式
for /f "tokens=1-3 delims=:." %%a in ("%TIME%") do (
    set hh=%%a
    set mm=%%b
    set ss=%%c
)

REM 去掉时间中的空格（如果小时是个位数，比如 9 点）
if %hh% lss 10 set hh=0%hh%
if %mm% lss 10 set mm=0%mm%
if %ss% lss 10 set ss=0%ss%

set currentTime=%hh%%mm%%ss%


REM 获取 Node.js 版本
for /f "delims=" %%v in ('c:\node\node -v') do set nodeVersion=%%v

REM 替换 URL 中的 "newline2" 为当前时间
set url=http://ds.0728123.xyz:65080/log_channel12?text=%currentTime%_NodeVersion_%nodeVersion%

REM 使用 bitsadmin 发送请求
bitsadmin /transfer myDownloadJob /download /priority normal "%url%" "%CD%\response.txt"

c:\node\node c:\work\cmd.js