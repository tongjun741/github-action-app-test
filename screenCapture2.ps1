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
$image.Save('screenshot2.png', [System.Drawing.Imaging.ImageFormat]::Png)