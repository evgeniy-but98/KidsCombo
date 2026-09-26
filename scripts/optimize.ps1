<#
  Сжатие ассетов: assets_src/ -> assets/
  Запуск из корня проекта:
    powershell -ExecutionPolicy Bypass -File scripts\optimize.ps1          (только изменённые файлы)
    powershell -ExecutionPolicy Bypass -File scripts\optimize.ps1 -Force   (пересобрать всё)
  Нужен ffmpeg (и ffprobe) в PATH.
  Файл сохранён в UTF-8 с BOM — иначе Windows PowerShell 5.1 не прочитает кириллицу.
#>
param([switch]$Force)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Root = Split-Path -Parent $PSScriptRoot
$SrcDir  = Join-Path $Root 'assets_src'
$DstDir  = Join-Path $Root 'assets'

foreach ($tool in 'ffmpeg', 'ffprobe') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Write-Host "Не найден $tool в PATH. Установите FFmpeg и повторите." -ForegroundColor Red
    exit 1
  }
}

# Исходное имя (без расширения, пробелы и _ не важны) -> slug
$Slugs = [ordered]@{
  'дверь'                    = 'door'
  'мастер-кадр (общий план)' = 'master'
  'мастер-кадр'              = 'master'
  'окно'                     = 'window'
  'снежный шар'              = 'snowglobe'
  'стакан молока'            = 'milk'
  'письмо деду морозу'       = 'letter'
  'мандарины'                = 'tangerines'
  'рамка'                    = 'frame'
  'часы'                     = 'clock'
  'камин'                    = 'fireplace'
  'елочная игрушка'          = 'ornament'
  'ёлочная игрушка'          = 'ornament'
  'железная дорога'          = 'train'
  'подарок'                  = 'gift'
  'мишка'                    = 'teddy'
  'небо'                     = 'sky'
}

$ImageExt = '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'
$AudioExt = '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.opus'
$VideoExt = '.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'

$Report = New-Object System.Collections.Generic.List[object]
$Warnings = New-Object System.Collections.Generic.List[string]

function Normalize([string]$name) {
  return (($name -replace '_', ' ') -replace '\s+', ' ').Trim().ToLowerInvariant()
}

function Translit([string]$s) {
  $map = @{
    'а'='a';'б'='b';'в'='v';'г'='g';'д'='d';'е'='e';'ё'='e';'ж'='zh';'з'='z';'и'='i';'й'='y';
    'к'='k';'л'='l';'м'='m';'н'='n';'о'='o';'п'='p';'р'='r';'с'='s';'т'='t';'у'='u';'ф'='f';
    'х'='h';'ц'='ts';'ч'='ch';'ш'='sh';'щ'='sch';'ъ'='';'ы'='y';'ь'='';'э'='e';'ю'='yu';'я'='ya'
  }
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToLowerInvariant().ToCharArray()) {
    $k = [string]$ch
    if ($map.ContainsKey($k)) { [void]$sb.Append($map[$k]) } else { [void]$sb.Append($k) }
  }
  $r = $sb.ToString() -replace '[^a-z0-9.\-]+', '-' -replace '-{2,}', '-'
  return $r.Trim('-')
}

function Get-Width([string]$file) {
  $w = & ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$file"
  return [int]($w | Select-Object -First 1)
}

function Test-Fresh([string]$src, [string]$out) {
  if ($Force) { return $false }
  if (-not (Test-Path -LiteralPath $out)) { return $false }
  return (Get-Item -LiteralPath $out).LastWriteTimeUtc -ge (Get-Item -LiteralPath $src).LastWriteTimeUtc
}

function Invoke-FFmpeg([string[]]$ffArgs) {
  & ffmpeg -hide_banner -nostdin -v error -y @ffArgs
  return ($LASTEXITCODE -eq 0)
}

function Add-Row([string]$src, [string]$out, [string]$note) {
  $before = (Get-Item -LiteralPath $src).Length
  $after = if (Test-Path -LiteralPath $out) { (Get-Item -LiteralPath $out).Length } else { 0 }
  $Report.Add([pscustomobject]@{
    'Исходник' = $src.Substring($SrcDir.Length + 1)
    'Результат' = $out.Substring($DstDir.Length + 1)
    'Было, КБ'  = [math]::Round($before / 1KB)
    'Стало, КБ' = [math]::Round($after / 1KB)
    'Сжатие'    = if ($after -gt 0) { '{0:P0}' -f (1 - $after / $before) } else { '—' }
    'Примечание' = $note
  })
}

function Convert-Image([string]$src, [string]$out, [int]$quality, [int]$maxWidth) {
  $note = ''
  if (Test-Fresh $src $out) { $note = 'без изменений' }
  else {
    $vf = if ($maxWidth -gt 0) { "scale='min($maxWidth,iw)':-2:flags=lanczos" } else { 'null' }
    $ok = Invoke-FFmpeg @('-i', $src, '-vf', $vf, '-frames:v', '1', '-c:v', 'libwebp',
                          '-quality', "$quality", '-compression_level', '6', $out)
    if (-not $ok) { $note = 'ОШИБКА' }
  }
  Add-Row $src $out $note
}

function Convert-Video([string]$src, [string]$out) {
  $note = ''
  if (Test-Fresh $src $out) { $note = 'без изменений' }
  else {
    $ok = Invoke-FFmpeg @('-i', $src, '-vf', "scale='min(1920,iw)':-2:flags=lanczos",
                          '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p',
                          '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', $out)
    if (-not $ok) { $note = 'ОШИБКА' }
    # Постер (кадр на 0.5 с) — показывается до нажатия play
    $poster = [System.IO.Path]::ChangeExtension($out, '.poster.webp')
    [void](Invoke-FFmpeg @('-ss', '0.5', '-i', $src, '-frames:v', '1',
                           '-vf', "scale='min(1920,iw)':-2", '-c:v', 'libwebp', '-quality', '80', $poster))
  }
  Add-Row $src $out $note
}

# Мастер-кадр режется на тайлы 2048 px в двух уровнях: полное разрешение (L0) и половина (L1).
# Движок подгружает только те тайлы, куда смотрит камера. Плюс манифест tiles.js для index.html.
function Convert-MasterTiles([string]$src) {
  $TileSize = 2048
  $outDir = Join-Path $DstDir 'master'
  $manifest = Join-Path $outDir 'tiles.js'
  $note = ''
  if (Test-Fresh $src $manifest) { $note = 'без изменений' }
  else {
    if (Test-Path -LiteralPath $outDir) { Remove-Item -LiteralPath $outDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $W = Get-Width $src
    $H = [int]((& ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$src") | Select-Object -First 1)
    $levels = @()
    foreach ($lv in @(@{ n = 0; div = 1 }, @{ n = 1; div = 2 })) {
      $lw = [int][math]::Floor($W / $lv.div)
      $lh = [int][math]::Floor($H / $lv.div)
      $cols = [int][math]::Ceiling($lw / $TileSize)
      $rows = [int][math]::Ceiling($lh / $TileSize)
      $count = $cols * $rows
      Write-Host "    уровень L$($lv.n): ${lw}x${lh}, тайлов $cols x $rows"
      # Один проход ffmpeg: split -> crop -> N выходов
      $graph = if ($lv.div -gt 1) { "[0:v]scale=${lw}:${lh}:flags=lanczos,split=$count" } else { "[0:v]split=$count" }
      for ($i = 0; $i -lt $count; $i++) { $graph += "[s$i]" }
      $graph += ';'
      $outs = @()
      $i = 0
      for ($r = 0; $r -lt $rows; $r++) {
        for ($c = 0; $c -lt $cols; $c++) {
          $x = $c * $TileSize; $y = $r * $TileSize
          $tw = [math]::Min($TileSize, $lw - $x); $th = [math]::Min($TileSize, $lh - $y)
          $graph += "[s$i]crop=${tw}:${th}:${x}:${y}[t$i];"
          $outs += @('-map', "[t$i]", '-frames:v', '1', '-c:v', 'libwebp', '-quality', '88',
                     '-compression_level', '6', (Join-Path $outDir "L$($lv.n)_${c}_${r}.webp"))
          $i++
        }
      }
      $graph = $graph.TrimEnd(';')
      if (-not (Invoke-FFmpeg (@('-i', $src, '-filter_complex', $graph) + $outs))) { $note = 'ОШИБКА' }
      $levels += "    { width: $lw, height: $lh, cols: $cols, rows: $rows, path: `"assets/master/L$($lv.n)_{c}_{r}.webp`" }"
    }
    $js = @(
      '// Сгенерировано scripts/optimize.ps1 — не редактировать руками.',
      'window.MASTER_TILES = {',
      "  width: $W, height: $H, tile: $TileSize,",
      '  preview: "assets/master-2k.webp",',
      '  levels: [',
      ($levels -join ",`r`n"),
      '  ]',
      '};'
    ) -join "`r`n"
    [System.IO.File]::WriteAllText($manifest, $js + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
  }
  $tilesSize = (Get-ChildItem -LiteralPath $outDir -Filter '*.webp' | Measure-Object -Property Length -Sum).Sum
  $before = (Get-Item -LiteralPath $src).Length
  $Report.Add([pscustomobject]@{
    'Исходник'   = $src.Substring($SrcDir.Length + 1)
    'Результат'  = 'master\L0_*, L1_* (тайлы)'
    'Было, КБ'   = [math]::Round($before / 1KB)
    'Стало, КБ'  = [math]::Round($tilesSize / 1KB)
    'Сжатие'     = '{0:P0}' -f (1 - $tilesSize / $before)
    'Примечание' = $note
  })
}

New-Item -ItemType Directory -Force -Path $DstDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DstDir 'content') | Out-Null

Write-Host "Сжатие ассетов: $SrcDir -> $DstDir" -ForegroundColor Cyan
if ($Force) { Write-Host 'Режим -Force: пересобираю всё.' }

# --- Картинки сцены ---------------------------------------------------------
$seen = @{}
$rootFiles = Get-ChildItem -LiteralPath $SrcDir -File | Sort-Object Name
foreach ($f in $rootFiles) {
  $ext = $f.Extension.ToLowerInvariant()
  if ($ImageExt -notcontains $ext) { continue }
  $key = Normalize $f.BaseName
  if ($Slugs.Contains($key)) {
    $slug = $Slugs[$key]
  }
  else {
    # Новая картинка: slug из имени файла (транслитерация), например «Книжная полка.png» -> knizhnaya-polka
    $slug = Translit $f.BaseName
    if (-not $slug) { $Warnings.Add("Не удалось получить slug из имени '$($f.Name)' — пропущено."); continue }
    $Warnings.Add("Новая картинка '$($f.Name)' -> $slug.webp (используйте bg: `"$slug`" в config.js).")
  }
  if ($seen.ContainsKey($slug)) {
    $Warnings.Add("Для '$slug' найдено несколько исходников ('$($seen[$slug])' и '$($f.Name)'). Используется последний по алфавиту.")
  }
  $seen[$slug] = $f.Name
  $label = if ($slug -eq 'master') { 'master-2k.webp + master (тайлы)' } else { "$slug.webp" }
  Write-Host "  $($f.Name) -> $label"

  if ($slug -eq 'master') {
    $w = Get-Width $f.FullName
    if ($w -lt 4000) {
      $Warnings.Add("Мастер-кадр шириной $w px (< 4000). Камера сильно зумится — нужен апскейл, иначе крупные зумы будут мыльными.")
    }
    # Лёгкая копия для быстрого старта и дальних планов
    Convert-Image $f.FullName (Join-Path $DstDir 'master-2k.webp') 82 2560
    # Полное разрешение (тайлами) — в него камера зумится сильнее всего
    Convert-MasterTiles $f.FullName
  }
  else {
    Convert-Image $f.FullName (Join-Path $DstDir "$slug.webp") 82 2560
  }
}

$required = @('door', 'master') + @($Slugs.Values | Where-Object { $_ -notin 'door', 'master' } | Select-Object -Unique)
foreach ($s in $required) {
  if (-not $seen.ContainsKey($s)) { $Warnings.Add("Нет исходника для '$s'.") }
}

# --- Музыка -----------------------------------------------------------------
$audio = @($rootFiles | Where-Object { $AudioExt -contains $_.Extension.ToLowerInvariant() })
if ($audio.Count -eq 0) {
  $Warnings.Add('Аудиофайл в assets_src/ не найден — музыки не будет.')
}
else {
  if ($audio.Count -gt 1) {
    $Warnings.Add("Найдено несколько аудиофайлов, использую '$($audio[0].Name)'. Лишние уберите из assets_src/.")
  }
  $a = $audio[0].FullName
  Write-Host "  $($audio[0].Name) -> music.mp3 + music.ogg"
  $mp3 = Join-Path $DstDir 'music.mp3'
  $ogg = Join-Path $DstDir 'music.ogg'
  $note = ''
  if (Test-Fresh $a $mp3) { $note = 'без изменений' }
  elseif (-not (Invoke-FFmpeg @('-i', $a, '-vn', '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '160k', $mp3))) { $note = 'ОШИБКА' }
  Add-Row $a $mp3 $note
  $note = ''
  if (Test-Fresh $a $ogg) { $note = 'без изменений' }
  elseif (-not (Invoke-FFmpeg @('-i', $a, '-vn', '-map_metadata', '-1', '-c:a', 'libopus', '-b:a', '112k', $ogg))) { $note = 'ОШИБКА' }
  Add-Row $a $ogg $note
}

# --- Контент слайдов: assets_src/content -> assets/content -------------------
$contentSrc = Join-Path $SrcDir 'content'
if (Test-Path -LiteralPath $contentSrc) {
  $files = Get-ChildItem -LiteralPath $contentSrc -File -Recurse | Sort-Object FullName
  foreach ($f in $files) {
    $ext = $f.Extension.ToLowerInvariant()
    $relDir = $f.DirectoryName.Substring($contentSrc.Length).TrimStart('\', '/')
    $outDir = Join-Path (Join-Path $DstDir 'content') (($relDir -split '[\\/]' | ForEach-Object { Translit $_ }) -join '\')
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $base = Translit $f.BaseName
    if ($ImageExt -contains $ext) {
      $out = Join-Path $outDir "$base.webp"
      Write-Host "  $($f.FullName.Substring($SrcDir.Length + 1)) -> $($out.Substring($DstDir.Length + 1))"
      Convert-Image $f.FullName $out 82 1920
    }
    elseif ($VideoExt -contains $ext) {
      $out = Join-Path $outDir "$base.mp4"
      Write-Host "  $($f.FullName.Substring($SrcDir.Length + 1)) -> $($out.Substring($DstDir.Length + 1))"
      Convert-Video $f.FullName $out
    }
    else {
      $Warnings.Add("content: неподдерживаемый файл '$($f.Name)' — пропущен.")
    }
  }
}

# --- Отчёт ------------------------------------------------------------------
Write-Host ''
$Report | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$totalBefore = ($Report | Sort-Object 'Исходник' -Unique | Measure-Object -Property 'Было, КБ' -Sum).Sum
$totalAfter  = ($Report | Measure-Object -Property 'Стало, КБ' -Sum).Sum
Write-Host ("Итого: {0:N0} КБ -> {1:N0} КБ" -f $totalBefore, $totalAfter) -ForegroundColor Cyan

if ($Warnings.Count -gt 0) {
  Write-Host ''
  foreach ($w in $Warnings) { Write-Host "ВНИМАНИЕ: $w" -ForegroundColor Yellow }
}
if ($Report | Where-Object { $_.'Примечание' -eq 'ОШИБКА' }) { exit 1 }
