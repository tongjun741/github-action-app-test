# 安装 VNC Server
Invoke-WebRequest -UseBasicParsing https://downloads.realvnc.com/download/file/vnc.files/VNC-Server-7.9.0-Windows.exe -OutFile "VNC-Server.exe"
Start-Process -FilePath "VNC-Server.exe" -ArgumentList "/S /norestart" -Wait

# 启动 VNC Server
& "C:\Program Files\RealVNC\VNC Server\vncserver.exe" -service
