set NODE_SKIP_PLATFORM_CHECK=1
c:\node\node -v

cd c:\work
c:\node\node c:\work\cmd.js > \\host.lan\Data\start.log
echo "start.bat over" >> "\\host.lan\Data\done.log"

pause