set NODE_SKIP_PLATFORM_CHECK=1
c:\node\node -v

REM 等待网络共享文件夹就绪
set SHARE_PATH=\\host.lan\Data

:CheckShare
ping -n 1 %SHARE_PATH% >nul
if errorlevel 1 (
    echo Network share %SHARE_PATH% is not accessible. Waiting 10 seconds...
    timeout /t 10 >nul
    goto CheckShare
)

echo Network share %SHARE_PATH% is accessible.

cd c:\work
c:\node\node c:\work\cmd.js > \\host.lan\Data\start.log
echo "start.bat over" >> "\\host.lan\Data\done.log"

pause