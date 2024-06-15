@echo off

REM 获取当前时间，并格式化为 "HHMMSS" 格式
set currentTime=%time:~0,2%%time:~3,2%%time:~6,2%

REM 去掉时间中的空格（如果小时是个位数，比如 9 点）
set currentTime=%currentTime: =0%

REM 替换 URL 中的 "newline2" 为当前时间
set url=http://ds.0728123.xyz:65080/log_channel12?text=%currentTime%

echo "%url%"

REM 使用 curl 发送请求
curl "%url%"
