@echo off
pushd "\\vboxsvr\vagrant"
cd >nul
node start.js > "\\VBOXSVR\vagrant\start.log" 2>&1
popd
