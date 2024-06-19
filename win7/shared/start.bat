set NODE_SKIP_PLATFORM_CHECK=1
c:\node\node -v

REM 等待网络共享文件夹就绪
set SHARE_PATH=\\host.lan\Data

:MapDrive
net use %SHARE_PATH% /persistent:no >nul 2>&1
if errorlevel 1 (
    echo Failed to map %SHARE_PATH%. Waiting 10 seconds...
    timeout /t 10 >nul
    goto MapDrive
)

echo Network share %SHARE_PATH% is accessible.

cd c:\work
c:\node\node c:\work\cmd.js > \\host.lan\Data\start.log
echo "start.bat over" >> "\\host.lan\Data\done.log"

pause