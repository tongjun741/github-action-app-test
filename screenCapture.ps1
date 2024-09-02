# 截图
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
# Get the current screen resolution
$image = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
# Create a graphic object
$graphic = [System.Drawing.Graphics]::FromImage($image)
$point = New-Object System.Drawing.Point(0, 0)
$graphic.CopyFromScreen($point, $point, $image.Size);
$cursorBounds = New-Object System.Drawing.Rectangle([System.Windows.Forms.Cursor]::Position, [System.Windows.Forms.Cursor]::Current.Size)
# Get a screenshot
[System.Windows.Forms.Cursors]::Default.Draw($graphic, $cursorBounds)
# Save the screenshot as a PNG file
$image.Save('screenshot.png', [System.Drawing.Imaging.ImageFormat]::Png)

# 上传截图
$filePath = "./screenshot.png"
$uploadUrl = "http://ds.0728123.xyz:6180/screenshot.png"
# 上传文件
$response = Invoke-RestMethod -Uri $uploadUrl -Method Put -InFile $filePath -ContentType "application/octet-stream"
$returnedUrl = $response.ToString()
# 在返回的 URL 的最后一个斜线前插入 "/inline"
$inlineUrl = $returnedUrl -replace '(\/[^\/]*)$', '/inline$1'

# 发送飞书通知
$headers = @{
    "Content-Type" = "application/json"
}

$body = @{
    content = @{
        text = "【花漾】Workflow failed: $($env:GITHUB_EVENT_WORKFLOW_NAME)`n<at user_id=`"$($env:FEISHU_ME)`">me</at>(github actions request)\n\n屏幕截图：$($inlineUrl)"
    }
    msg_type = "text"
} | ConvertTo-Json

$url = "https://open.feishu.cn/open-apis/bot/v2/hook/$($env:FEISHU_TOKEN)"

Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body
