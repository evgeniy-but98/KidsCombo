# Сжатие ассетов: assets_src/ -> assets/ + дополнение assets/manifest.js
# Запуск: scripts\optimize.cmd (двойной клик) или
#   powershell -ExecutionPolicy Bypass -File scripts\optimize.ps1 [-DryRun] [-Force] [-Only <имя>[,<имя>]] [-MaxHeight <px>]
# Скрипт только дополняет: в assets_src/ достаточно положить новые или обновлённые материалы.
#   Всё, что уже есть в assets/ и в manifest.js (включая музыку), сохраняется: ничего не удаляется,
#   файлы без исходника в assets_src/ не перекодируются. Пропал файл из манифеста -> остановка с ошибкой.
#   -DryRun     показать план и ничего не менять (FFmpeg не нужен)
#   -Force      перекодировать исходники из assets_src/, даже если готовый файл новее исходника
#   -Only       обработать только эти исходники (имя без расширения, например stop__scene08)
#   -MaxHeight  уменьшить видео выше этой высоты (например 720); по умолчанию разрешение исходника
# Соглашение об именах в assets_src/video/:
#   stop__<id>.mp4        цикл остановки
#   tr__<from>__<to>.mp4  пролёт (обратный генерируется реверсом, если нет ручного tr__<to>__<from>)
#   still__<id>.webp|png|jpg  статичная картинка для остановки без цикла
#   once__<id>.mp4        играет один раз, последний кадр остаётся (логотип); не цикл — стык не проверяется,
#                         цвет размечается как BT.709, чтобы сплошной фон страницы совпадал с фоном ролика
param([switch]$Force, [switch]$DryRun, [string[]]$Only, [int]$MaxHeight = 0)
$Only = @($Only | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })   # -File передаёт "a,b" одной строкой

$Root = Split-Path $PSScriptRoot -Parent
$Src = Join-Path $Root 'assets_src'
$Out = Join-Path $Root 'assets'
$ManifestFile = Join-Path $Out 'manifest.js'

$LoopPsnrWarn = 30   # дБ: первый/последний кадр цикла ниже порога -> рывок на стыке
$JoinPsnrWarn = 20   # дБ: последний кадр пролёта vs первый кадр цикла цели ниже порога -> нужна склейка
$VideoArgs = @('-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p',
               '-g', '24', '-keyint_min', '24', '-sc_threshold', '0', '-movflags', '+faststart')

$Inv = [Globalization.CultureInfo]::InvariantCulture
$IdRe = '[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*'   # id без двойного подчёркивания
$VideoExt = '\.(mp4|mov|webm|mkv)$'
$ImageExt = '\.(webp|png|jpe?g)$'

function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }
function Rel($path) { $path.Substring($Root.Length + 1).Replace('\', '/') }
function MissingTools { 'ffmpeg', 'ffprobe' | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) } }

# ---------- текущий манифест: всё, что в нём есть, сохраняется ----------
function ToOrdered($o) {   # объект из ConvertFrom-Json -> [ordered] с прежним порядком ключей
    $h = [ordered]@{}
    if ($o) { foreach ($p in $o.PSObject.Properties) { $h[$p.Name] = $p.Value } }
    $h
}
$stops = [ordered]@{}; $edges = [ordered]@{}; $music = $null; $OldText = $null
if (Test-Path -LiteralPath $ManifestFile) {
    $OldText = [IO.File]::ReadAllText($ManifestFile)
    $old = $null
    if ($OldText -match '(?s)window\.MANIFEST\s*=\s*(\{.*\})\s*;') { try { $old = $Matches[1] | ConvertFrom-Json -ErrorAction Stop } catch { } }
    if (-not $old) { Fail 'Не удалось прочитать assets/manifest.js. Ничего не изменено. Верните его из git: git restore assets/manifest.js' }
    $stops = ToOrdered $old.stops; foreach ($k in @($stops.Keys)) { $stops[$k] = ToOrdered $stops[$k] }
    $edges = ToOrdered $old.edges; foreach ($k in @($edges.Keys)) { $edges[$k] = ToOrdered $edges[$k] }
    $music = $old.music
}
elseif (Get-ChildItem (Join-Path $Out 'video') -File -ErrorAction SilentlyContinue) {
    Fail 'Нет assets/manifest.js, хотя в assets/video/ есть ролики. Ничего не изменено. Верните манифест из git: git restore assets/manifest.js'
}

# ---------- все файлы из манифеста должны быть на месте ----------
$Missing = New-Object System.Collections.ArrayList
function CheckRef($where, $path) {
    if ($path -and -not (Test-Path -LiteralPath (Join-Path $Root $path) -PathType Leaf)) { [void]$Missing.Add("  $path  ($where)") }
}
foreach ($id in $stops.Keys) { foreach ($f in 'loop', 'once', 'poster', 'last', 'still') { CheckRef "stops.$id.$f" $stops[$id][$f] } }
foreach ($key in $edges.Keys) { foreach ($f in 'src', 'first', 'last') { CheckRef "edges['$key'].$f" $edges[$key][$f] } }
CheckRef 'music' $music
if ($Missing.Count) {
    Fail ("Остановлено: в assets/manifest.js указаны файлы, которых нет в assets/:`n" + ($Missing -join "`n") +
          "`nНичего не изменено. Верните их из git (git restore assets/) или, если материал больше не нужен, удалите его запись из assets/manifest.js.")
}

# ---------- план: что сделать с каждым исходником ----------
# новый - готового файла нет; обновить - исходник новее готового файла (или -Force);
# пропустить - готовый файл не старше исходника и уже в манифесте; в манифест - готов, но записи нет
$Jobs = New-Object System.Collections.ArrayList
$Warnings = New-Object System.Collections.ArrayList   # жёлтым: стоит проверить
$Notes = New-Object System.Collections.ArrayList      # серым: для сведения
function Plan($kind, $key, $source, $target, $listed, $reverseOf) {
    if ($Only.Count -and $Only -notcontains [IO.Path]::GetFileNameWithoutExtension($source)) { return }
    $action = if (-not (Test-Path -LiteralPath $target)) { 'новый' }
        elseif ($Force -or (Get-Item -LiteralPath $target).LastWriteTime -lt (Get-Item -LiteralPath $source).LastWriteTime) { 'обновить' }
        elseif ($listed) { 'пропустить' }
        else { 'в манифест' }
    [void]$Jobs.Add([pscustomobject]@{ kind = $kind; key = $key; source = $source; target = $target; reverseOf = $reverseOf; action = $action })
}

$srcVideo = Join-Path $Src 'video'
$files = if (Test-Path $srcVideo) { Get-ChildItem $srcVideo -File | Sort-Object Name } else { @() }
$trNames = $files | Where-Object { $_.Name -match "^tr__${IdRe}__${IdRe}$VideoExt" } | ForEach-Object { $_.BaseName }

foreach ($f in $files) {
    if ($f.Name -match "^stop__($IdRe)$VideoExt") {
        $id = $Matches[1]; $o = Join-Path $Out "video\stop__$id.mp4"
        Plan 'stop' $id $f.FullName $o ($stops[$id].loop -eq (Rel $o))
    }
    elseif ($f.Name -match "^tr__($IdRe)__($IdRe)$VideoExt") {
        $a = $Matches[1]; $b = $Matches[2]; $o = Join-Path $Out "video\tr__${a}__$b.mp4"
        Plan 'edge' "$a>$b" $f.FullName $o ($edges["$a>$b"].src -eq (Rel $o))
        if ($trNames -contains "tr__${b}__$a") { continue }   # ручной обратный пролёт лежит рядом
        if ($edges["$b>$a"] -and -not $edges["$b>$a"].reverseOf) { [void]$Notes.Add("Обратный пролёт '$b>$a' уже есть отдельным роликом - реверс не делаю."); continue }
        $r = Join-Path $Out "video\tr__${b}__$a.rev.mp4"
        Plan 'edge' "$b>$a" $f.FullName $r ($edges["$b>$a"].src -eq (Rel $r)) "$a>$b"
    }
    elseif ($f.Name -match "^once__($IdRe)$VideoExt") {
        $id = $Matches[1]; $o = Join-Path $Out "video\once__$id.mp4"
        Plan 'once' $id $f.FullName $o ($stops[$id].once -eq (Rel $o))
    }
    elseif ($f.Name -match "^still__($IdRe)$ImageExt") {
        $id = $Matches[1]; $o = Join-Path $Out "still\$id.webp"
        Plan 'still' $id $f.FullName $o ($stops[$id].still -eq (Rel $o))
    }
    else { [void]$Warnings.Add("Проигнорирован (имя не по соглашению): video/$($f.Name)") }
}

# контент (картинки и видео для шаблонов): в манифест не входит, ссылки на него - в config.js
$srcContent = Join-Path $Src 'content'
if (Test-Path $srcContent) {
    foreach ($f in Get-ChildItem $srcContent -File | Sort-Object Name) {
        if ($f.Name -match $ImageExt) { Plan 'content-image' $f.BaseName $f.FullName (Join-Path $Out "content\$($f.BaseName).webp") $true }
        elseif ($f.Name -match $VideoExt) { Plan 'content-video' $f.BaseName $f.FullName (Join-Path $Out "content\$($f.BaseName).mp4") $true }
        else { [void]$Warnings.Add("Проигнорирован: content/$($f.Name)") }
    }
}

# музыка: без исходника остаётся та, что в манифесте
$m = Get-ChildItem (Join-Path $Src 'audio') -File -Filter 'music.*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($m) { $o = Join-Path $Out 'audio\music.mp3'; Plan 'music' 'music' $m.FullName $o ($music -eq (Rel $o)) }

# фавикон и превью для соцсетей
foreach ($f in Get-ChildItem (Join-Path $Src 'image') -File -ErrorAction SilentlyContinue) {
    if ($f.BaseName -eq 'og-preview') { Plan 'og' $f.BaseName $f.FullName (Join-Path $Out 'image\og-preview.jpg') $true }
    else { Plan 'copy' $f.BaseName $f.FullName (Join-Path $Out "image\$($f.Name)") $true }
}

$Work = @($Jobs | Where-Object { $_.action -ne 'пропустить' })

function Messages {
    foreach ($w in $Warnings) { Write-Host "! $w" -ForegroundColor Yellow }
    foreach ($n in $Notes) { Write-Host "  $n" -ForegroundColor DarkGray }
}
function Kept {
    $ws = @($Work | Where-Object { $_.kind -in 'stop', 'still', 'once' } | ForEach-Object { $_.key })
    $we = @($Work | Where-Object { $_.kind -eq 'edge' } | ForEach-Object { $_.key })
    $ks = @($stops.Keys | Where-Object { $ws -notcontains $_ })
    $ke = @($edges.Keys | Where-Object { $we -notcontains $_ })
    $km = if (-not $music) { 'нет' } elseif ($Work | Where-Object { $_.kind -eq 'music' }) { 'из assets_src' } else { $music }
    Write-Host ("Без изменений (файлы не трогаются): остановки [{0}], рёбра [{1}], музыка: {2}" -f ($ks -join ', '), ($ke -join ', '), $km)
}

if (-not $Jobs.Count) {
    Kept; Messages
    Write-Host $(if ($Only.Count) { "Под -Only ($($Only -join ', ')) не подошёл ни один исходник - ничего не изменено." } else { 'В assets_src/ нет исходников с подходящими именами - ничего не изменено.' }) -ForegroundColor Green
    exit 0
}

$Jobs | ForEach-Object {
    [pscustomobject]@{ 'Исходник' = Rel $_.source; 'Результат' = Rel $_.target; 'Действие' = $_.action + $(if ($_.reverseOf) { ' (реверс)' }) }
} | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
if ($Only.Count) { Write-Host "Только исходники: $($Only -join ', ')" }
if ($MaxHeight -gt 0) { Write-Host "Видео выше $MaxHeight px уменьшаются до $MaxHeight px по высоте" }

if ($DryRun) {
    Kept; Messages
    $miss = MissingTools
    if ($miss) { Write-Host "Для настоящего запуска нужен FFmpeg, сейчас не найдены: $($miss -join ', ')" -ForegroundColor Yellow }
    Write-Host 'Пробный запуск (-DryRun): ничего не изменено.' -ForegroundColor Green
    exit 0
}
if (-not $Work.Count) {
    Kept; Messages
    Write-Host 'Все исходники уже обработаны - ничего не изменено. Перекодировать их заново: -Force.' -ForegroundColor Green
    exit 0
}
$miss = MissingTools
if ($miss) { Fail "Не найдены в PATH: $($miss -join ', '). Установите FFmpeg (ffprobe входит в комплект) и запустите снова. Ничего не изменено." }

# ---------- кодирование ----------
# аргументы одним массивом: через $args PowerShell 5.1 режет токены вида -c:v
function FF([string[]]$a) {
    & ffmpeg -hide_banner -v error -y $a
    if ($LASTEXITCODE) { throw "ffmpeg: ошибка ($a)" }
}
# ffmpeg пишет во временную папку; файл в assets/ заменяется только после успешного кодирования
function FFTo([string[]]$a, $outFile) {
    $t = Join-Path $Tmp ([IO.Path]::GetFileName($outFile))
    FF ($a + @($t))
    Move-Item -LiteralPath $t $outFile -Force -ErrorAction Stop
}
# -MaxHeight: уменьшение по высоте, ширина чётная; видео ниже порога не увеличиваются
function ScaleVf { if ($MaxHeight -gt 0) { "scale=-2:'min($MaxHeight,ih)'" } }
function Fresh($in, $outFile) {
    -not $Force -and (Test-Path -LiteralPath $outFile) -and (Get-Item -LiteralPath $outFile).LastWriteTime -ge (Get-Item -LiteralPath $in).LastWriteTime
}
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
$StatusText = @{ 'новый' = 'сжат'; 'обновить' = 'обновлён'; 'в манифест' = 'добавлен в манифест'; 'пропустить' = 'пропущен' }
function Row($j) {
    $before = if ($j.reverseOf) { $null } else { [math]::Round((Get-Item -LiteralPath $j.source).Length / 1KB) }
    $status = $StatusText[$j.action] + $(if ($j.reverseOf) { ' (реверс)' })
    [void]$Rows.Add([pscustomobject]@{ 'Файл' = Rel $j.target; 'Было, КБ' = $before; 'Стало, КБ' = [math]::Round((Get-Item -LiteralPath $j.target).Length / 1KB); 'Статус' = $status })
}

function EncodeVideo($j) {
    if ($j.action -ne 'в манифест') {
        $vf = @(ScaleVf) + $(if ($j.reverseOf) { @('reverse') } else { @() })
        # once: явная разметка BT.709 — иначе браузеры по-разному пересчитывают цвет и фон ролика не совпадёт с фоном страницы
        $color = @()
        if ($j.kind -eq 'once') {
            $vf += 'scale=out_color_matrix=bt709:out_range=tv', 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv'
            $color = @('-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv')
        }
        $a = @('-i', $j.source); if ($vf.Count) { $a += '-vf', ($vf -join ',') }
        FFTo ($a + $VideoArgs + $color + @('-an')) $j.target
    }
    # постеры: первый и последний кадр из уже сжатого видео (совпадают с тем, что увидит зритель)
    $base = Join-Path $Out ('poster\' + [IO.Path]::GetFileNameWithoutExtension($j.target))
    $first = "$base.first.webp"; $last = "$base.last.webp"
    if (-not (Fresh $j.target $first)) { FFTo @('-i', $j.target, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '85') $first }
    if (-not (Fresh $j.target $last)) { FFTo @('-sseof', '-0.5', '-i', $j.target, '-vf', 'reverse', '-frames:v', '1', '-c:v', 'libwebp', '-quality', '85') $last }
    Row $j
    $info = Probe $j.target
    $e = [ordered]@{ src = Rel $j.target; duration = $info.duration; fps = $info.fps; first = Rel $first; last = Rel $last }
    if ($j.reverseOf) { $e.reverseOf = $j.reverseOf }
    $e
}

function EncodeImage($j, $quality) {
    if ($j.action -ne 'в манифест') { FFTo @('-i', $j.source, '-vf', "scale='min(2560,iw)':-1", '-c:v', 'libwebp', '-quality', "$quality") $j.target }
    Row $j
}

foreach ($d in 'video', 'poster', 'still', 'content', 'audio', 'image') { New-Item -ItemType Directory -Force (Join-Path $Out $d) | Out-Null }
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ('kidscombo-optimize-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $Tmp | Out-Null
$Touched = @{}   # 'stop:<id>' / 'edge:<from>><to>' - для них пересчитываются проверки стыков
try {
    foreach ($j in $Jobs) {
        if ($j.action -eq 'пропустить') { Row $j; continue }
        $encode = $j.action -ne 'в манифест'
        switch ($j.kind) {
            'stop' {
                $v = EncodeVideo $j
                if (-not $stops[$j.key]) { $stops[$j.key] = [ordered]@{} }
                $s = $stops[$j.key]
                $s.loop = $v.src; $s.poster = $v.first; $s.last = $v.last; $s.duration = $v.duration; $s.fps = $v.fps
                $Touched["stop:$($j.key)"] = $true
            }
            'edge' { $edges[$j.key] = EncodeVideo $j; $Touched["edge:$($j.key)"] = $true }
            'once' { # без проверки стыка цикла: ролик не повторяется
                $v = EncodeVideo $j
                if (-not $stops[$j.key]) { $stops[$j.key] = [ordered]@{} }
                $s = $stops[$j.key]
                $s.once = $v.src; $s.poster = $v.first; $s.last = $v.last; $s.duration = $v.duration; $s.fps = $v.fps
            }
            'still' {
                EncodeImage $j 82
                if (-not $stops[$j.key]) { $stops[$j.key] = [ordered]@{} }
                $stops[$j.key].still = Rel $j.target
                if (-not $stops[$j.key].loop) { $stops[$j.key].poster = Rel $j.target }
            }
            'content-image' { EncodeImage $j 82 }
            'content-video' {
                $a = @('-i', $j.source); if ($MaxHeight -gt 0) { $a += '-vf', (ScaleVf) }
                if ($encode) { FFTo ($a + $VideoArgs + @('-c:a', 'aac', '-b:a', '128k')) $j.target }; Row $j
            }
            'music' { if ($encode) { FFTo @('-i', $j.source, '-vn', '-c:a', 'libmp3lame', '-b:a', '160k') $j.target }; Row $j; $music = Rel $j.target }
            'og' { FFTo @('-i', $j.source, '-q:v', '3') $j.target; Row $j }
            'copy' { Copy-Item -LiteralPath $j.source $j.target -Force -ErrorAction Stop; Row $j }
        }
    }
}
catch {
    Write-Host "Ошибка: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'assets/manifest.js не изменён, файлы без исходника в assets_src/ не тронуты. Исправьте причину и запустите снова с -Force.' -ForegroundColor Red
    exit 1
}
finally { Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue }

# ---------- проверки стыков: только для добавленного и обновлённого ----------
foreach ($id in $stops.Keys) {
    $s = $stops[$id]
    if (-not $Touched["stop:$id"] -or -not $s.loop) { continue }
    $p = Psnr (Join-Path $Root $s.poster) (Join-Path $Root $s.last)
    $s.loopPsnr = if ($p -ne $null) { [math]::Round($p, 1) } else { $null }
    if ($p -ne $null -and $p -lt $LoopPsnrWarn) {
        [void]$Warnings.Add(("Цикл '{0}': первый и последний кадр различаются (PSNR {1:N1} дБ) - возможен рывок на стыке. Попробуй loopMode: 'pingpong' или перегенерируй цикл." -f $id, $p))
    }
}
foreach ($key in $edges.Keys) {
    $e = $edges[$key]; $to = $key.Split('>')[1]
    if (-not ($Touched["edge:$key"] -or $Touched["stop:$to"])) { continue }
    if (-not $stops[$to] -or -not $stops[$to].loop) { continue }
    $p = Psnr (Join-Path $Root $e.last) (Join-Path $Root $stops[$to].poster)
    $e.joinPsnr = if ($p -ne $null) { [math]::Round($p, 1) } else { $null }
    if ($p -ne $null -and $p -lt $JoinPsnrWarn) {
        $hint = if ($e.reverseOf) { "склейка ребра '$($e.reverseOf)' зеркалится на старте" } else { "поставь join: 'push' в config.js или догенерируй недостающий кусок" }
        [void]$Warnings.Add(("Пролёт '{0}' не стыкуется с циклом '{1}' (PSNR {2:N1} дБ): {3}." -f $key, $to, $p, $hint))
    }
}

# ---------- файлы, на которые манифест не ссылается: не удаляются, только перечисляются ----------
$Refs = @{}
foreach ($s in $stops.Values) { foreach ($f in 'loop', 'once', 'poster', 'last', 'still') { if ($s[$f]) { $Refs[(Join-Path $Root $s[$f]).Replace('/', '\')] = $true } } }
foreach ($e in $edges.Values) { foreach ($f in 'src', 'first', 'last') { if ($e[$f]) { $Refs[(Join-Path $Root $e[$f]).Replace('/', '\')] = $true } } }
$Unused = @(foreach ($d in 'video', 'poster', 'still') {
    Get-ChildItem (Join-Path $Out $d) -File -ErrorAction SilentlyContinue | Where-Object { -not $Refs[$_.FullName] } | ForEach-Object { Rel $_.FullName }
})

# ---------- манифест ----------
$manifest = [ordered]@{ stops = $stops; edges = $edges; music = $music }
$json = $manifest | ConvertTo-Json -Depth 6
$js = "// Сгенерировано scripts/optimize.ps1 - скрипт только дополняет файл; вручную можно лишь удалить ненужную запись (см. README).`nwindow.MANIFEST = $json;`n"
$changed = -not $OldText -or $OldText.Replace("`r`n", "`n") -ne $js.Replace("`r`n", "`n")
if ($changed) { [IO.File]::WriteAllText($ManifestFile, $js, (New-Object Text.UTF8Encoding $false)) }

# ---------- отчёт ----------
$Rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$b = ($Rows | Where-Object { $_.'Было, КБ' } | Measure-Object 'Было, КБ' -Sum).Sum
$a = ($Rows | Measure-Object 'Стало, КБ' -Sum).Sum
Write-Host ("Итого: исходники {0:N0} КБ -> {1:N0} КБ (с реверсами, без постеров)" -f $b, $a)
Write-Host ("Остановок: {0}, рёбер: {1}, музыка: {2}" -f $stops.Count, $edges.Count, $(if ($music) { 'есть' } else { 'нет' }))
Kept; Messages
if ($Unused.Count) {
    Write-Host 'Не используются манифестом (оставлены на месте, удалить можно вручную):' -ForegroundColor DarkGray
    foreach ($u in $Unused) { Write-Host "  $u" -ForegroundColor DarkGray }
}
if ($Jobs | Where-Object { $_.action -eq 'пропустить' }) { Write-Host 'Пропущенные исходники не новее готовых файлов. Чтобы заменить ими готовые, запустите с -Force.' -ForegroundColor DarkGray }
Write-Host $(if ($changed) { 'Готово: assets/manifest.js обновлён' } else { 'Готово: assets/manifest.js не изменился' }) -ForegroundColor Green
