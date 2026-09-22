# build-dist.ps1 — produce the two separated deliverables.
#
#   DevKit   : the vendor's own tools + ledger. Contains hashes only.
#   UserKit  : the NSIS installer that end users receive.
#
# The split is the point: the DevKit must never contain plaintext codes, and
# the UserKit must never contain the ledger. Keeping both rules in one script
# means neither can drift.

[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$SkipUserKit
)

$ErrorActionPreference = 'Stop'
# The repo root is where this script lives: it sits beside src-tauri/.
$Repo = $PSScriptRoot
if (-not $Repo) { $Repo = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $Repo) { $Repo = (Get-Location).Path }
$SrcTauri = Join-Path $Repo 'src-tauri'
if (-not (Test-Path $SrcTauri)) {
    Write-Host "  XX  cannot find src-tauri under '$Repo'" -ForegroundColor Red
    exit 1
}
$OutRoot = 'D:\license-export'
$DevKit = Join-Path $OutRoot '开发端\SetupCenter-DevKit'
$ExportDir = $OutRoot

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "  OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  !!  $msg" -ForegroundColor Yellow }
function Die($msg) { Write-Host "  XX  $msg" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- dev tools

if (-not $SkipBuild) {
    Step 'Compiling release tools'
    Push-Location $SrcTauri
    try {
        & cargo build --release --example issue --example license_admin --example lookup
        if ($LASTEXITCODE -ne 0) { Die 'cargo build failed' }
    } finally { Pop-Location }
    Ok 'issue.exe / license_admin.exe / lookup.exe built'
}

Step "Assembling DevKit -> $DevKit"
# What this script itself produces. Anything in $DevKit outside this set was put
# there by hand and cannot be regenerated — the ledger's pre-mark .bak (the
# documented restore path) and the *.utf8bak encoding backups. Wiping the folder
# silently destroyed them, so they are lifted out first and put back after.
$scriptOwns = @(
    'issue.exe', 'license_admin.exe', '查码.exe',
    'license_inventory.csv', '使用说明.md', '生成新码.bat', '记账.bat'
)
$preserved = @()
if (Test-Path $DevKit) {
    $keepDir = Join-Path ([System.IO.Path]::GetTempPath()) ("devkit-keep-" + [System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $keepDir -Force | Out-Null
    foreach ($f in Get-ChildItem $DevKit -Recurse -File) {
        if ($f.Name -notin $scriptOwns) {
            $relPath = $f.FullName.Substring($DevKit.Length).TrimStart('\')
            $dest = Join-Path $keepDir $relPath
            New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
            Copy-Item $f.FullName $dest -Force
            $preserved += $relPath
        }
    }
    if ($preserved) { Ok "preserved $($preserved.Count) hand-made file(s): $($preserved -join ', ')" }
    Remove-Item $DevKit -Recurse -Force
}
New-Item -ItemType Directory -Path $DevKit -Force | Out-Null
if ($preserved) {
    foreach ($relPath in $preserved) {
        Copy-Item (Join-Path $keepDir $relPath) (Join-Path $DevKit $relPath) -Force
    }
    Remove-Item $keepDir -Recurse -Force -ErrorAction SilentlyContinue
}

$rel = Join-Path $SrcTauri 'target\release\examples'
$map = @{
    'issue.exe'         = 'issue.exe'
    'license_admin.exe' = 'license_admin.exe'
    'lookup.exe'        = '查码.exe'
}
foreach ($src in $map.Keys) {
    $from = Join-Path $rel $src
    if (-not (Test-Path $from)) { Die "missing built tool: $from" }
    Copy-Item $from (Join-Path $DevKit $map[$src])
}
Ok 'three tools copied (lookup.exe shipped as 查码.exe)'

$ledger = Join-Path $SrcTauri 'license_inventory.csv'
if (-not (Test-Path $ledger)) { Die "ledger not found: $ledger" }
Copy-Item $ledger (Join-Path $DevKit 'license_inventory.csv')
$rowCount = (Import-Csv $ledger).Count
Ok "ledger copied ($rowCount rows)"

foreach ($doc in 'DEVDOC_使用说明.md', 'DEVDOC_生成新码.bat', 'DEVDOC_记账.bat') {
    $f = Join-Path $SrcTauri $doc
    if (-not (Test-Path $f)) { Die "missing doc: $f" }
    $name = $doc -replace '^DEVDOC_', ''
    Copy-Item $f (Join-Path $DevKit $name)
}
Ok 'docs + bat helpers copied'

# ------------------------------------------------- plaintext export placement

Step 'Placing plaintext export (outside DevKit, on purpose)'
$exports = Get-ChildItem -Path $SrcTauri, $Repo -Filter 'codes_export_*.txt' -File -ErrorAction SilentlyContinue
if ($exports.Count -eq 0) {
    Warn 'no codes_export_*.txt found — 查码 will only show ledger status'
} else {
    foreach ($e in $exports) {
        $dest = Join-Path $ExportDir $e.Name
        if ($e.FullName -ne $dest) {
            Move-Item $e.FullName $dest -Force
            Ok "moved $($e.Name) -> $ExportDir"
        } else {
            Ok "$($e.Name) already in $ExportDir"
        }
    }
}

# ------------------------------------------------------------ leak guardrail

Step 'Guardrail: DevKit must contain no plaintext codes'
$codes = @()
# Every page, not just the newest one. The earlier version took
# `Sort-Object Name | Select-Object -Last 1` — which is page 10 of a paged
# export, so codes 1-450 were invisible to this check. That is not a theoretical
# gap: it passed while 使用说明.md was shipping real codes 001 and 002, because
# those live on page 1. A guardrail that samples 50 of 500 codes is a guardrail
# that reports "clean" over a live leak.
$exportPages = Get-ChildItem $ExportDir -Filter 'codes_export_*.txt' -File -ErrorAction SilentlyContinue |
    Sort-Object Name
$latest = $exportPages | Select-Object -Last 1
if ($exportPages) {
    $codes = foreach ($page in $exportPages) {
        Get-Content $page.FullName |
            Where-Object { $_ -match 'SC-' } |
            ForEach-Object { ($_ -split '\s+')[-1].Trim() } |
            Where-Object { $_ -like 'SC-*' }
    }
    $codes = $codes | Select-Object -Unique
    Ok "sample pool: $($codes.Count) plaintext codes across $($exportPages.Count) page(s)"
}

$leaks = 0
foreach ($f in Get-ChildItem $DevKit -Recurse -File) {
    if ($f.Name -like 'codes_export_*.txt') {
        Write-Host "  XX  export file inside DevKit: $($f.FullName)" -ForegroundColor Red
        $leaks++
        continue
    }
    $text = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $text) { continue }
    foreach ($c in $codes) {
        if ($text.Contains($c)) {
            Write-Host "  XX  plaintext code present in $($f.Name): $c" -ForegroundColor Red
            $leaks++
            break
        }
    }
}
if ($leaks -gt 0) { Die "$leaks leak(s) detected — DevKit NOT shippable" }
Ok 'no plaintext code found anywhere in DevKit'

# ---------------------------------------------------------------- user side

$bundleDir = Join-Path $Repo 'src-tauri\target\release\bundle\nsis'
$installer = $null
if (-not $SkipUserKit) {
    Step 'Building NSIS installer (user side)'
    $dist = Join-Path $Repo 'dist'
    if (-not (Test-Path $dist)) {
        Push-Location $Repo
        try {
            & npm run build
            if ($LASTEXITCODE -ne 0) { Die 'npm run build failed' }
        } finally { Pop-Location }
        Ok 'frontend built'
    } else {
        Ok 'frontend dist/ already present'
    }

    Push-Location $Repo
    try {
        & npm run tauri build -- --bundles nsis
        $rc = $LASTEXITCODE
    } finally { Pop-Location }
    if ($rc -ne 0) { Die "tauri build failed (exit $rc)" }

    $installer = Get-ChildItem $bundleDir -Filter '*-setup.exe' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime | Select-Object -Last 1
    if (-not $installer) { Die "no installer produced under $bundleDir" }
    Ok "installer: $($installer.FullName) ($([math]::Round($installer.Length / 1MB, 1)) MB)"
}

if ($installer) {
    $userKit = Join-Path $OutRoot '用户端'
    New-Item -ItemType Directory -Path $userKit -Force | Out-Null
    Copy-Item $installer.FullName (Join-Path $userKit $installer.Name) -Force
    Ok "user installer copied -> $userKit"
}

# ------------------------------------------------------------ final summary

Step 'Summary'
Write-Host "  DevKit : $DevKit"
Get-ChildItem $DevKit | ForEach-Object {
    $sz = if ($_.PSIsContainer) { '' } else { "  $([math]::Round($_.Length / 1KB, 1)) KB" }
    Write-Host "            $($_.Name)$sz"
}
Write-Host "  Codes  : $ExportDir"
if ($latest) { Write-Host "            $($latest.Name)  ($($codes.Count) plaintext codes)" }
if ($installer) { Write-Host "  UserKit: $(Join-Path $OutRoot '用户端')" }
Write-Host ''
