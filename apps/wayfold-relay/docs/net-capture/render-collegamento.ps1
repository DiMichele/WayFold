Add-Type -AssemblyName System.Drawing

$outPng = Join-Path $PSScriptRoot "collegamento-luce.png"
$W = 1920
$H = 1080

$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

function C([int]$r, [int]$g, [int]$b) {
  return [System.Drawing.Color]::FromArgb($r, $g, $b)
}

$ink = C 26 26 26
$muted = C 70 70 70
$paper = C 255 255 255
$bg = C 246 244 239
$air = C 214 228 255
$airInk = C 20 58 120
$screen = C 244 246 249
$bar = C 198 208 220
$blue = C 31 91 232

$brushBg = New-Object System.Drawing.SolidBrush $bg
$brushInk = New-Object System.Drawing.SolidBrush $ink
$brushMuted = New-Object System.Drawing.SolidBrush $muted
$brushPaper = New-Object System.Drawing.SolidBrush $paper
$brushAir = New-Object System.Drawing.SolidBrush $air
$brushAirInk = New-Object System.Drawing.SolidBrush $airInk
$brushScreen = New-Object System.Drawing.SolidBrush $screen
$brushBar = New-Object System.Drawing.SolidBrush $bar
$brushBlue = New-Object System.Drawing.SolidBrush $blue
$brushWhite = New-Object System.Drawing.SolidBrush $paper

$penInk = New-Object System.Drawing.Pen $ink, 4
$penInkThin = New-Object System.Drawing.Pen $ink, 3
$penCable = New-Object System.Drawing.Pen $ink, 14
$penCable.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$penCable.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$penBlue = New-Object System.Drawing.Pen $blue, 6
$penBlue.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$penBlue.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$penGlobe = New-Object System.Drawing.Pen $ink, 3

$fontTitle = New-Object System.Drawing.Font "Segoe UI", 58, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fontSub = New-Object System.Drawing.Font "Segoe UI", 30, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$fontName = New-Object System.Drawing.Font "Segoe UI", 34, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fontHint = New-Object System.Drawing.Font "Segoe UI", 26, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$fontBadge = New-Object System.Drawing.Font "Segoe UI", 28, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fontAir = New-Object System.Drawing.Font "Segoe UI", 36, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fontSmall = New-Object System.Drawing.Font "Segoe UI", 24, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$fontLegend = New-Object System.Drawing.Font "Segoe UI", 24, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)

function Round-Path([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
  $p.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
  $p.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Fill-Round($g, $brush, $pen, [single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = Round-Path $x $y $w $h $r
  $g.FillPath($brush, $p)
  if ($pen) { $g.DrawPath($pen, $p) }
  $p.Dispose()
}

function Draw-Centered($g, $text, $font, $brush, [single]$cx, [single]$y) {
  $size = $g.MeasureString($text, $font)
  $g.DrawString($text, $font, $brush, ($cx - $size.Width / 2), $y)
}

function Test-FinderBit([int]$rr, [int]$cc) {
  $edge = ($rr -eq 0 -or $rr -eq 6 -or $cc -eq 0 -or $cc -eq 6)
  $core = ($rr -ge 2 -and $rr -le 4 -and $cc -ge 2 -and $cc -le 4)
  return ($edge -or $core)
}

function Draw-Qr($g, [single]$x, [single]$y, [single]$size, [int]$n, $modBrush) {
  $quiet = $size
  Fill-Round $g $brushPaper $null $x $y $quiet $quiet ([Math]::Max(8, $size * 0.06))
  $pad = $size * 0.08
  $mod = ($size - 2 * $pad) / $n
  for ($r = 0; $r -lt $n; $r++) {
    for ($c = 0; $c -lt $n; $c++) {
      $on = $false
      $origins = @(
        @(0, 0),
        @(0, ($n - 7)),
        @(($n - 7), 0)
      )
      $inFinder = $false
      foreach ($o in $origins) {
        $rr = $r - $o[0]
        $cc = $c - $o[1]
        if ($rr -ge 0 -and $rr -lt 7 -and $cc -ge 0 -and $cc -lt 7) {
          $inFinder = $true
          $on = Test-FinderBit $rr $cc
          break
        }
      }
      if (-not $inFinder) {
        if ($r -eq 6 -or $c -eq 6) {
          $on = ((($r + $c) % 2) -eq 0)
        } else {
          $on = (((($r * 13 + $c * 7 + 3) % 5) -gt 1))
        }
      }
      if ($on) {
        $mx = $x + $pad + $c * $mod
        $my = $y + $pad + $r * $mod
        $g.FillRectangle($modBrush, $mx, $my, ($mod + 0.4), ($mod + 0.4))
      }
    }
  }
}

function Draw-Monitor($g, [single]$x, [single]$y, [single]$w, [single]$h, [string]$mode, [string]$camSide) {
  Fill-Round $g $brushPaper $penInk $x $y $w $h 22
  $sx = $x + 18
  $sy = $y + 18
  $sw = $w - 36
  $sh = $h - 78
  Fill-Round $g $brushScreen $null $sx $sy $sw $sh 10

  if ($mode -eq "page") {
    $g.FillRectangle($brushBar, $sx, $sy, $sw, 42)
    Fill-Round $g $brushPaper $null ($sx + 56) ($sy + 8) ($sw - 112) 26 13
    $widths = @(0.86, 0.72, 0.9, 0.55, 0.78)
    $ly = $sy + 64
    foreach ($frac in $widths) {
      $g.FillRectangle($brushBar, ($sx + 22), $ly, (($sw - 44) * $frac), 16)
      $ly += 30
    }
  } else {
    $qs = [Math]::Min(150, $sh - 36)
    Draw-Qr $g ($sx + ($sw - $qs) / 2) ($sy + ($sh - $qs) / 2) $qs 21 $brushInk
  }

  $neckW = 46
  $neckX = $x + ($w - $neckW) / 2
  $g.FillRectangle($brushInk, $neckX, ($y + $h), $neckW, 18)
  $standW = 150
  Fill-Round $g $brushInk $null ($x + ($w - $standW) / 2) ($y + $h + 16) $standW 16 8

  $camR = 22
  if ($camSide -eq "right") { $camX = $x + $w + 6 } else { $camX = $x - 6 }
  $camY = $y + 18 + $sh / 2
  $g.FillEllipse($brushPaper, ($camX - $camR), ($camY - $camR), ($camR * 2), ($camR * 2))
  $g.DrawEllipse($penInk, ($camX - $camR), ($camY - $camR), ($camR * 2), ($camR * 2))
  $g.FillEllipse($brushBlue, ($camX - 9), ($camY - 9), 18, 18)
  $g.FillEllipse($brushInk, ($camX - 4), ($camY - 4), 8, 8)
  return @{ CamX = $camX; CamY = $camY; MidY = ($y + $h / 2); Right = ($x + $w); Bottom = ($y + $h + 32) }
}

$g.FillRectangle($brushBg, 0, 0, $W, $H)

$g.DrawString("La pagina passa nell'aria", $fontTitle, $brushInk, 64, 46)
$g.DrawString("Fra i due computer ci sono solo QR. Il cavo parte dopo.", $fontSub, $brushMuted, 64, 124)

$monY = 300
$monW = 400
$monH = 320
$leftX = 36
$rightX = 1024
$bandX = 470
$bandW = 520
$bandY = 248
$bandH = 500

Fill-Round $g $brushAir $null $bandX $bandY $bandW $bandH 36

$left = Draw-Monitor $g $leftX $monY $monW $monH "page" "right"
$right = Draw-Monitor $g $rightX $monY $monW $monH "qr" "left"

$qrSize = 248
$qrX = $bandX + ($bandW - $qrSize) / 2
$qrY = 352
Draw-Qr $g $qrX $qrY $qrSize 25 $brushInk

Draw-Centered $g "Solo luce" $fontAir $brushAirInk ($bandX + $bandW / 2) 268
Draw-Centered $g "Codice 827638" $fontName $brushAirInk ($bandX + $bandW / 2) 616
Draw-Centered $g "schermo e fotocamera" $fontHint $brushAirInk ($bandX + $bandW / 2) 662

function Draw-Badge($g, [single]$cx, [single]$cy, [string]$n, $fill, $textBrush) {
  $r = 26
  $g.FillEllipse($fill, ($cx - $r), ($cy - $r), ($r * 2), ($r * 2))
  $size = $g.MeasureString($n, $fontBadge)
  $g.DrawString($n, $fontBadge, $textBrush, ($cx - $size.Width / 2), ($cy - $size.Height / 2 - 1))
}

Draw-Badge $g ($leftX + $monW / 2) 236 "1" $brushInk $brushWhite
Draw-Badge $g ($bandX + $bandW / 2) 236 "2" $brushBlue $brushWhite
Draw-Badge $g ($rightX + $monW / 2) 236 "3" $brushInk $brushWhite

$capY = 820
Draw-Centered $g "PC che naviga" $fontName $brushInk ($leftX + $monW / 2) $capY
Draw-Centered $g "Qui si apre il sito" $fontHint $brushMuted ($leftX + $monW / 2) ($capY + 42)
Draw-Centered $g "PC che condivide" $fontName $brushInk ($rightX + $monW / 2) $capY
Draw-Centered $g "Da qui esce il cavo" $fontHint $brushMuted ($rightX + $monW / 2) ($capY + 42)

$cableY = $right.MidY
$cableX1 = $right.Right + 18
$globeR = 78
$globeCx = 1804
$globeCy = $cableY
$cableX2 = $globeCx - $globeR - 18
$g.DrawLine($penCable, $cableX1, $cableY, $cableX2, $cableY)
$ah = 16
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddPolygon(@(
  (New-Object System.Drawing.PointF ($cableX2 - 6), ($cableY - $ah)),
  (New-Object System.Drawing.PointF ($cableX2 + 22), $cableY),
  (New-Object System.Drawing.PointF ($cableX2 - 6), ($cableY + $ah))
))
$g.FillPath($brushInk, $path)
$path.Dispose()

$g.FillEllipse($brushPaper, ($globeCx - $globeR), ($globeCy - $globeR), ($globeR * 2), ($globeR * 2))
$state = $g.Save()
$clip = New-Object System.Drawing.Drawing2D.GraphicsPath
$clip.AddEllipse(($globeCx - $globeR), ($globeCy - $globeR), ($globeR * 2), ($globeR * 2))
$g.SetClip($clip)
$g.DrawEllipse($penGlobe, ($globeCx - 28), ($globeCy - $globeR), 56, ($globeR * 2))
$g.DrawEllipse($penGlobe, ($globeCx - 52), ($globeCy - $globeR), 104, ($globeR * 2))
$g.DrawLine($penGlobe, ($globeCx - $globeR), $globeCy, ($globeCx + $globeR), $globeCy)
$g.Restore($state)
$clip.Dispose()
$g.DrawEllipse($penInk, ($globeCx - $globeR), ($globeCy - $globeR), ($globeR * 2), ($globeR * 2))

Draw-Centered $g "209.993 B" $fontSmall $brushInk (($cableX1 + $cableX2) / 2) ($cableY - 52)
Draw-Centered $g "casa, poi Hetzner" $fontSmall $brushMuted (($cableX1 + $cableX2) / 2) ($cableY + 28)
Draw-Centered $g "Wikipedia" $fontName $brushInk $globeCx ($globeCy + $globeR + 18)
Draw-Centered $g "204.016 B" $fontHint $brushMuted $globeCx ($globeCy + $globeR + 58)

$legendY = 990
$g.FillRectangle($brushAir, 64, $legendY, 28, 28)
$g.DrawString("Azzurro = luce dei QR, non un cavo", $fontLegend, $brushInk, 104, ($legendY - 2))
$g.FillRectangle($brushInk, 760, ($legendY + 10), 42, 8)
$g.DrawString("Linea nera = cavo di rete", $fontLegend, $brushInk, 816, ($legendY - 2))

$bmp.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output $outPng
