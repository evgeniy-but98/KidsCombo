# Сжатие ассетов: assets_src/ -> assets/ + генерация assets/manifest.js
# Запуск: scripts\optimize.cmd (двойной клик) или
#   powershell -ExecutionPolicy Bypass -File scripts\optimize.ps1 [-Force]
# Соглашение об именах в assets_src/video/:
#   stop__<id>.mp4        цикл остановки
#   tr__<from>__<to>.mp4  пролёт (обратный генерируется реверсом, если нет ручного tr__<to>__<from>)
#   still__<id>.webp|png|jpg  статичная картинка для остановки без цикла
param([switch]$Force)

$Root = Split-Path $PSScriptRoot -Parent
$Src = Join-Path $Root 'assets_src'
$Out = Join-Path $Root 'assets'

$LoopPsnrWarn = 30   # дБ: первый/последний кадр цикла ниже порога -> рывок на стыке
$JoinPsnrWarn = 20   # дБ: последний кадр пролёта vs первый кадр цикла цели ниже порога -> нужна склейка
$VideoArgs = @('-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p',
               '-g', '24', '-keyint_min', '24', '-sc_threshold', '0', '-movflags', '+faststart')

$Inv = [Globalization.CultureInfo]::InvariantCulture
$IdRe = '[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*'   # id без двойного подчёркивания
$VideoExt = '\.(mp4|mov|webm|mkv)$'
$ImageExt = '\.(webp|png|jpe?g)$'

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { Write-Host 'ffmpeg не найден в PATH' -ForegroundColor Red; exit 1 }

# аргументы одним массивом: через $args PowerShell 5.1 режет токены вида -c:v
function FF([string[]]$a) {
    & ffmpeg -hide_banner -v error -y $a
    if ($LASTEXITCODE) { throw "ffmpeg: ошибка ($a)" }
}
function Fresh($in, $outFile) {
    -not $Force -and (Test-Path $outFile) -and (Get-Item $outFile).LastWriteTime -ge (Get-Item $in).LastWriteTime
}
function Rel($path) { $path.Substring($Root.Length + 1).Replace('\', '/') }
function Probe($file) {
    $o = & ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate:format=duration -of default=nw=1 $file
    $d = [double]::Parse((($o | Select-String '^duration=') -replace 'duration=', ''), $Inv)
    $r = (($o | Select-String '^r_frame_rate=') -replace 'r_frame_rate=', '').Split('/')
    @{ duration = [math]::Round($d, 3); fps = [math]::Round([double]::Parse($r[0], $Inv) / [double]::Parse($r[1], $Inv), 3) }
}
function Psnr($a, $b) {
    $o = & ffmpeg -hide_banner -v error -i $a -i $b -lavfi '[0]scale=640:360[a];[1]scale=640:360[b];[a][b]psnr=stats_file=-' -f null -
    if ("$o" -match 'psnr_avg:(inf|[\d.]+)') { if ($Matches[1] -eq 'inf') { 99 } else { [double]::Parse($Matches[1], $Inv) } } else { $null }
}

$Rows = New-Object System.Collections.ArrayList
$Produced = @{}
$Warnings = New-Object System.Collections.ArrayList
function Row($srcFile, $outFile, $status) {
    $Produced[$outFile] = $true
    $before = if ($srcFile) { [math]::Round((Get-Item $srcFile).Length / 1KB) } else { $null }
    [void]$Rows.Add([pscustomobject]@{ 'Файл' = Rel $outFile; 'Было, КБ' = $before; 'Стало, КБ' = [math]::Round((Get-Item $outFile).Length / 1KB); 'Статус' = $status })
}

# ---------- видео ----------
function EncodeVideo($in, $outFile, [switch]$Reverse) {
    $status = 'пропущен'
    if (-not (Fresh $in $outFile)) {
        $vf = if ($Reverse) { @('-vf', 'reverse') } else { @() }
        FF (@('-i', $in) + $vf + $VideoArgs + @('-an', $outFile))
        $status = if ($Reverse) { 'реверс' } else { 'сжат' }
    }
    # постеры: первый и последний кадр из уже сжатого видео (совпадают с тем, что увидит зритель)
    $base = Join-Path $Out ('poster\' + [IO.Path]::GetFileNameWithoutExtension($outFile))
    $first = "$base.first.webp"; $last = "$base.last.webp"
    if (-not (Fresh $outFile $first)) { FF @('-i', $outFile, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '85', $first) }
    if (-not (Fresh $outFile $last)) { FF @('-sseof', '-0.5', '-i', $outFile, '-vf', 'reverse', '-frames:v', '1', '-c:v', 'libwebp', '-quality', '85', $last) }
    $Produced[$first] = $true; $Produced[$last] = $true
    Row $(if ($Reverse) { $null } else { $in }) $outFile $status
    $info = Probe $outFile
    [ordered]@{ src = Rel $outFile; duration = $info.duration; fps = $info.fps; first = Rel $first; last = Rel $last }
}

function EncodeImage($in, $outFile, $quality) {
    $status = 'пропущен'
    if (-not (Fresh $in $outFile)) { FF @('-i', $in, '-vf', "scale='min(2560,iw)':-1", '-c:v', 'libwebp', '-quality', "$quality", $outFile); $status = 'сжат' }
    Row $in $outFile $status
}

foreach ($d in 'video', 'poster', 'still', 'content', 'audio', 'image') { New-Item -ItemType Directory -Force (Join-Path $Out $d) | Out-Null }

$stops = [ordered]@{}
$edges = [ordered]@{}
$srcVideo = Join-Path $Src 'video'
$files = if (Test-Path $srcVideo) { Get-ChildItem $srcVideo -File | Sort-Object Name } else { @() }
$trNames = $files | Where-Object { $_.Name -match "^tr__${IdRe}__${IdRe}$VideoExt" } | ForEach-Object { $_.BaseName }

foreach ($f in $files) {
    if ($f.Name -match "^stop__($IdRe)$VideoExt") {
        $id = $Matches[1]
        $v = EncodeVideo $f.FullName (Join-Path $Out "video\stop__$id.mp4")
        if (-not $stops[$id]) { $stops[$id] = [ordered]@{} }
        $stops[$id].loop = $v.src; $stops[$id].poster = $v.first; $stops[$id].last = $v.last
        $stops[$id].duration = $v.duration; $stops[$id].fps = $v.fps
    }
    elseif ($f.Name -match "^tr__($IdRe)__($IdRe)$VideoExt") {
        $a = $Matches[1]; $b = $Matches[2]
        $edges["$a>$b"] = EncodeVideo $f.FullName (Join-Path $Out "video\tr__${a}__$b.mp4")
        if ($trNames -notcontains "tr__${b}__$a") {
            $r = EncodeVideo $f.FullName (Join-Path $Out "video\tr__${b}__$a.rev.mp4") -Reverse
            $r.reverseOf = "$a>$b"
            $edges["$b>$a"] = $r
        }
    }
    elseif ($f.Name -match "^still__($IdRe)$ImageExt") {
        $id = $Matches[1]
        $o = Join-Path $Out "still\$id.webp"
        EncodeImage $f.FullName $o 82
        if (-not $stops[$id]) { $stops[$id] = [ordered]@{} }
        $stops[$id].still = Rel $o
        if (-not $stops[$id].poster) { $stops[$id].poster = Rel $o }
    }
    else { [void]$Warnings.Add("Проигнорирован (имя не по соглашению): video/$($f.Name)") }
}

# ---------- контент (картинки и видео для шаблонов) ----------
$srcContent = Join-Path $Src 'content'
if (Test-Path $srcContent) {
    foreach ($f in Get-ChildItem $srcContent -File | Sort-Object Name) {
        if ($f.Name -match $ImageExt) { EncodeImage $f.FullName (Join-Path $Out "content\$($f.BaseName).webp") 82 }
        elseif ($f.Name -match $VideoExt) {
            $o = Join-Path $Out "content\$($f.BaseName).mp4"; $status = 'пропущен'
            if (-not (Fresh $f.FullName $o)) { FF (@('-i', $f.FullName) + $VideoArgs + @('-c:a', 'aac', '-b:a', '128k', $o)); $status = 'сжат' }
            Row $f.FullName $o $status
        }
        else { [void]$Warnings.Add("Проигнорирован: content/$($f.Name)") }
    }
}

# ---------- музыка ----------
$music = $null
$m = Get-ChildItem (Join-Path $Src 'audio') -File -Filter 'music.*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($m) {
    $o = Join-Path $Out 'audio\music.mp3'; $status = 'пропущен'
    if (-not (Fresh $m.FullName $o)) { FF @('-i', $m.FullName, '-vn', '-c:a', 'libmp3lame', '-b:a', '160k', $o); $status = 'сжат' }
    Row $m.FullName $o $status
    $music = Rel $o
}

# ---------- фавикон и превью для соцсетей ----------
foreach ($f in Get-ChildItem (Join-Path $Src 'image') -File -ErrorAction SilentlyContinue) {
    if ($f.BaseName -eq 'og-preview') {
        $o = Join-Path $Out 'image\og-preview.jpg'; $status = 'пропущен'
        if (-not (Fresh $f.FullName $o)) { FF @('-i', $f.FullName, '-q:v', '3', $o); $status = 'сжат' }
    } else {
        $o = Join-Path $Out "image\$($f.Name)"; $status = 'пропущен'
        if (-not (Fresh $f.FullName $o)) { Copy-Item $f.FullName $o -Force; $status = 'скопирован' }
    }
    Row $f.FullName $o $status
}

# ---------- проверки стыков ----------
foreach ($id in $stops.Keys) {
    $s = $stops[$id]
    if (-not $s.loop) { continue }
    $p = Psnr (Join-Path $Root $s.poster) (Join-Path $Root $s.last)
    $s.loopPsnr = if ($p -ne $null) { [math]::Round($p, 1) } else { $null }
    if ($p -ne $null -and $p -lt $LoopPsnrWarn) {
        [void]$Warnings.Add(("Цикл '{0}': первый и последний кадр различаются (PSNR {1:N1} дБ) - возможен рывок на стыке. Попробуй loopMode: 'pingpong' или перегенерируй цикл." -f $id, $p))
    }
}
foreach ($key in $edges.Keys) {
    $e = $edges[$key]; $to = $key.Split('>')[1]
    if (-not $stops[$to] -or -not $stops[$to].loop) { continue }
    $p = Psnr (Join-Path $Root $e.last) (Join-Path $Root $stops[$to].poster)
    $e.joinPsnr = if ($p -ne $null) { [math]::Round($p, 1) } else { $null }
    if ($p -ne $null -and $p -lt $JoinPsnrWarn) {
        $hint = if ($e.reverseOf) { "склейка ребра '$($e.reverseOf)' зеркалится на старте" } else { "поставь join: 'push' в config.js или догенерируй недостающий кусок" }
        [void]$Warnings.Add(("Пролёт '{0}' не стыкуется с циклом '{1}' (PSNR {2:N1} дБ): {3}." -f $key, $to, $p, $hint))
    }
}

# ---------- удаление устаревших файлов (исходник удалён или переименован) ----------
foreach ($d in 'video', 'poster', 'still', 'content', 'audio', 'image') {
    foreach ($f in Get-ChildItem (Join-Path $Out $d) -File) {
        if (-not $Produced[$f.FullName]) { Remove-Item $f.FullName; Write-Host "Удалён устаревший: $(Rel $f.FullName)" -ForegroundColor DarkGray }
    }
}

# ---------- манифест ----------
$manifest = [ordered]@{ stops = $stops; edges = $edges; music = $music }
$json = $manifest | ConvertTo-Json -Depth 6
$js = "// Сгенерировано scripts/optimize.ps1 - не редактировать вручную.`nwindow.MANIFEST = $json;`n"
[IO.File]::WriteAllText((Join-Path $Out 'manifest.js'), $js, (New-Object Text.UTF8Encoding $false))

# ---------- отчёт ----------
$Rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$b = ($Rows | Where-Object { $_.'Было, КБ' } | Measure-Object 'Было, КБ' -Sum).Sum
$a = ($Rows | Measure-Object 'Стало, КБ' -Sum).Sum
Write-Host ("Итого: исходники {0:N0} КБ -> {1:N0} КБ (с реверсами, без постеров)" -f $b, $a)
Write-Host ("Остановок: {0}, рёбер: {1}, музыка: {2}" -f $stops.Count, $edges.Count, $(if ($music) { 'есть' } else { 'нет' }))
foreach ($w in $Warnings) { Write-Host "! $w" -ForegroundColor Yellow }
Write-Host 'Готово: assets/manifest.js' -ForegroundColor Green
