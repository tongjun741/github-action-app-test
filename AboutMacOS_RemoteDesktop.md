(./frpc -c ./macOS_VNC/frpc_15897721.ini > /tmp/frpc.log 2>&1 &)

(node screenShareServer.js > /tmp/s.log 2>&1 &)

screencapture -l$(osascript -e 'tell app "Finder" to id of window 1') safari_window.png

screencapture -T0 -V 10 foo.mov

screencapture /tmp/a.png

osascript -e 'tell application "System Events" to keystroke "abc"'

# 回车
osascript -e 'tell application "System Events" to key code 36'
# 退格
osascript -e 'tell application "System Events" to key code 51'

open -a "Safari"
