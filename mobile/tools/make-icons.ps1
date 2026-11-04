# Makes every platform's app icon from the RejBoard brand logo (the Electron app's icon-512.png), so the native apps show
# the same logo. Run from anywhere (Windows PowerShell, uses .NET System.Drawing):
#   powershell -ExecutionPolicy Bypass -File mobile/tools/make-icons.ps1
# Re-run it if the logo changes; the generated PNGs are checked in.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$logo = [System.Drawing.Image]::FromFile((Join-Path $root 'icon-512.png'))
$mobile = Join-Path $root 'mobile'

# the logo's own pink (top and bottom of its gradient), sampled inside the rounded square
$bmp = New-Object System.Drawing.Bitmap $logo
$top = $bmp.GetPixel(256, 24)
$bottom = $bmp.GetPixel(256, 488)
$bmp.Dispose()

function New-Canvas([int]$w, [int]$h) {
    $b = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($b)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    return @($b, $g)
}

function Fill-Gradient($g, [int]$w, [int]$h) {
    $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $top, $bottom, 90
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()
}

# $size x $size image: the logo drawn at $logoSize, centred; $opaque fills the background with the logo's pink
function Save-Icon([string]$path, [int]$w, [int]$h, [int]$logoSize, [bool]$opaque) {
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $c = New-Canvas $w $h
    $b = $c[0]; $g = $c[1]
    if ($opaque) { Fill-Gradient $g $w $h }
    $x = [int](($w - $logoSize) / 2); $y = [int](($h - $logoSize) / 2)
    $g.DrawImage($logo, $x, $y, $logoSize, $logoSize)
    $b.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $b.Dispose()
    Write-Host "icon: $path"
}

# Android: adaptive icon. Foreground = the logo inside the 72dp safe zone of the 108dp layer, so the launcher's mask
# (circle, squircle, rounded square) never cuts the pencil or the sparkles; background = the logo's pink gradient.
$res = Join-Path $mobile 'android\src\main\res'
foreach ($d in @(@('mdpi', 1.0), @('hdpi', 1.5), @('xhdpi', 2.0), @('xxhdpi', 3.0), @('xxxhdpi', 4.0))) {
    $s = $d[1]
    Save-Icon (Join-Path $res "mipmap-$($d[0])\ic_launcher_foreground.png") ([int](108 * $s)) ([int](108 * $s)) ([int](76 * $s)) $false
    Save-Icon (Join-Path $res "mipmap-$($d[0])\ic_launcher_background.png") ([int](108 * $s)) ([int](108 * $s)) 0 $true
    # the plain logo, for launchers that do not use adaptive icons and for in-app use
    Save-Icon (Join-Path $res "mipmap-$($d[0])\ic_launcher_logo.png") ([int](48 * $s)) ([int](48 * $s)) ([int](48 * $s)) $false
}

# iOS: one 1024 px icon; iOS forbids transparency and applies its own rounded mask, so the corners are filled with the pink
Save-Icon (Join-Path $mobile 'ios\RejBoard\Assets.xcassets\AppIcon.appiconset\AppIcon-1024.png') 1024 1024 1024 $true

# Windows MSIX tiles (scale-100 sizes plus a scale-200 set for high-DPI screens)
$assets = Join-Path $mobile 'windows\RejBoardNative\Assets'
foreach ($scale in @(100, 200)) {
    $k = $scale / 100
    $suffix = ".scale-$scale"
    Save-Icon (Join-Path $assets "Square150x150Logo$suffix.png") ([int](150 * $k)) ([int](150 * $k)) ([int](150 * $k)) $false
    Save-Icon (Join-Path $assets "Square44x44Logo$suffix.png") ([int](44 * $k)) ([int](44 * $k)) ([int](44 * $k)) $false
    Save-Icon (Join-Path $assets "StoreLogo$suffix.png") ([int](50 * $k)) ([int](50 * $k)) ([int](50 * $k)) $false
    Save-Icon (Join-Path $assets "Wide310x150Logo$suffix.png") ([int](310 * $k)) ([int](150 * $k)) ([int](140 * $k)) $false
    Save-Icon (Join-Path $assets "SplashScreen$suffix.png") ([int](620 * $k)) ([int](300 * $k)) ([int](260 * $k)) $false
}
# taskbar / Start list icons at exact pixel sizes, without the plated background
foreach ($t in @(16, 24, 32, 48, 256)) {
    Save-Icon (Join-Path $assets "Square44x44Logo.targetsize-$t`_altform-unplated.png") $t $t $t $false
}
# the window's own icon (title bar, Alt+Tab): the Electron app's .ico
Copy-Item (Join-Path $root 'build\icon.ico') (Join-Path $assets 'AppIcon.ico') -Force
Write-Host "icon: $assets\AppIcon.ico"

$logo.Dispose()
