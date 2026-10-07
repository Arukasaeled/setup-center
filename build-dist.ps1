# build-dist.ps1 — produce the two separated deliverables.
#
#   DevKit   : the vendor's own tools + template. Does NOT bundle real business ledger.
#   UserKit  : the NSIS installer that end users receive.
#
# The split is the point: the DevKit must never contain plaintext codes or real business
# operational records, and the UserKit must never contain the ledger.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "输出根目录，必须显式指定且不可为空")]
    [string]$OutRoot,

    [Parameter(Mandatory = $false, HelpMessage = "外部经营账本路径（必须在公共仓库与构建目录之外）")]
    [string]$LedgerPath,

    [Parameter(Mandatory = $false, HelpMessage = "明文码源文件路径（必须在公共仓库之外）")]
    [string]$PlainCodePath,

    [Parameter(Mandatory = $false, HelpMessage = "私有输出目标目录（必须在公共仓库之外）")]
    [string]$PrivateOutputRoot,

    # --- Windows Authenticode 代码签名参数 (Issue J02) ---
    [Parameter(Mandatory = $false, HelpMessage = "代码签名证书指纹 (SHA1/SHA256 Thumbprint)")]
    [string]$SignCertThumbprint = $env:CODE_SIGN_CERT_THUMBPRINT,

    [Parameter(Mandatory = $false, HelpMessage = "代码签名证书文件路径 (.pfx)")]
    [string]$SignCertPath = $env:CODE_SIGN_CERT_PATH,

    [Parameter(Mandatory = $false, HelpMessage = "代码签名证书密码")]
    [string]$SignCertPassword = $env:CODE_SIGN_CERT_PASSWORD,

    [Parameter(Mandatory = $false, HelpMessage = "RFC 3161 时间戳服务器 URL")]
    [string]$TimestampServer = "http://timestamp.digicert.com",

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

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "  OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  !!  $msg" -ForegroundColor Yellow }
function Die($msg) { Write-Host "  XX  $msg" -ForegroundColor Red; exit 1 }

# ------------------------------------------------------------- path validation

if ([string]::IsNullOrWhiteSpace($OutRoot)) {
    Die "OutRoot 必须显式指定，不能使用默认写死路径。"
}

$normOut = $OutRoot.Replace('/', '\').TrimEnd('\')
$normRepo = $Repo.Replace('/', '\').TrimEnd('\')

if ($normOut.StartsWith($normRepo, [System.StringComparison]::OrdinalIgnoreCase)) {
    Die "OutRoot ($OutRoot) 不能位于代码仓库目录内 ($Repo)。"
}

if ($LedgerPath) {
    $normLedger = $LedgerPath.Replace('/', '\')
    if ($normLedger.StartsWith($normRepo, [System.StringComparison]::OrdinalIgnoreCase) -or
        $normLedger.StartsWith($normOut, [System.StringComparison]::OrdinalIgnoreCase) -or
        $normLedger -match 'setup-center-vault') {
        Die "经营账本 -LedgerPath 必须位于源码仓库与公开构建目录之外，拒绝使用内部路径: $LedgerPath"
    }
    if (-not (Test-Path $LedgerPath)) {
        Die "指定的外部经营账本不存在: $LedgerPath"
    }
    Ok "验证外部经营账本路径: $LedgerPath"
}

$DevKit = Join-Path $OutRoot '开发端\SetupCenter-DevKit'

if (Test-Path $DevKit) {
    $existing = Get-ChildItem -Path $DevKit -Force -ErrorAction SilentlyContinue
    if ($existing.Count -gt 0) {
        Die "DevKit 目标目录已存在且包含文件，拒绝清空或覆盖已有经营数据: $DevKit。请指定全新输出根目录。"
    }
}

New-Item -ItemType Directory -Path $DevKit -Force | Out-Null

# ---------------------------------------------------------------- dev tools

if ($SkipBuild) {
    Step 'SkipBuild 模式：仅生成准备态 DevKit'
    $pkgJsonPath = Join-Path $Repo 'package.json'
    $pkgVersion = 'unknown'
    if (Test-Path $pkgJsonPath) {
        try {
            $pkgVersion = (Get-Content $pkgJsonPath -Raw | ConvertFrom-Json).version
        } catch { }
    }

    $preparedStatus = [PSCustomObject]@{
        status = 'preparedOnly'
        skipBuild = $true
        sourceVersion = $pkgVersion
        expectedArtifactVersion = 'unknown'
        generatedAt = (Get-Date).ToString('o')
        notice = '构建已跳过 (-SkipBuild)，未复制历史或陈旧二进制文件。请运行完整构建生成真实交付物。'
    }
    $statusFile = Join-Path $DevKit 'DEV_BUILD_STATUS.json'
    $preparedStatus | ConvertTo-Json -Depth 4 | Set-Content $statusFile -Encoding utf8
    Warn "SkipBuild 模式：仅生成准备态 DevKit 清单，不抓取历史产物，不冒充新发行包"
} else {
    Step 'Compiling release tools'
    Push-Location $SrcTauri
    try {
        & cargo build --release --example issue --example license_admin --example lookup
        if ($LASTEXITCODE -ne 0) { Die 'cargo build failed' }
    } finally { Pop-Location }
    Ok 'issue.exe / license_admin.exe / lookup.exe built'

    Step "Assembling DevKit -> $DevKit"
    $rel = Join-Path $SrcTauri 'target\release\examples'
    $map = @{
        'issue.exe'         = 'issue.exe'
        'license_admin.exe' = 'license_admin.exe'
        'lookup.exe'        = '查码.exe'
    }
    foreach ($src in $map.Keys) {
        $from = Join-Path $rel $src
        if (-not (Test-Path $from)) { Die "missing built tool: $from" }
        Copy-Item $from (Join-Path $DevKit $map[$src]) -Force
    }
    Ok 'three tools copied (lookup.exe shipped as 查码.exe)'
}

# ------------------------------------------------------- ledger template placement

Step 'Placing ledger template (Issue A08: 不复制真实历史账本)'
$templateSrc = Join-Path $SrcTauri 'license_inventory_template.csv'
if (-not (Test-Path $templateSrc)) {
    # Fallback to header only
    "id,code_hash,tier,format,created_at,status,activated_at,device_hash,note" | Set-Content $templateSrc -Encoding utf8
}
Copy-Item $templateSrc (Join-Path $DevKit 'license_inventory.example.csv') -Force
Ok 'clean ledger template copied (license_inventory.example.csv)'

$readmeContent = @"
# DevKit 经营账本配置与安全须知

1. **数据隔离原则**：本工具包绝不内置任何真实已发行客户授权记录或经营数据。
2. **账本路径契约**：使用 `license_admin.exe` 时，必须通过 `--ledger <外部绝对路径>`（或 `--ledger-path`）显式指定独立存放的经营账本 CSV。
3. **安全禁止**：严禁将包含真实授权哈希或设备绑定的账本放置在开源仓库、Git 工作区或公开分发包中。
4. **模板参考**：同级目录下的 `license_inventory.example.csv` 为标准列头格式定义，供初始化外部账本时使用。
"@
Set-Content (Join-Path $DevKit '经营账本配置说明.md') $readmeContent -Encoding utf8
Ok 'ledger security notice written (经营账本配置说明.md)'

foreach ($doc in 'DEVDOC_使用说明.md', 'DEVDOC_生成新码.bat', 'DEVDOC_记账.bat') {
    $f = Join-Path $SrcTauri $doc
    if (Test-Path $f) {
        $name = $doc -replace '^DEVDOC_', ''
        Copy-Item $f (Join-Path $DevKit $name) -Force
    }
}
Ok 'docs + bat helpers copied'

# ------------------------------------------------- plaintext export placement

Step 'Plaintext export handling (Issue J05, J06)'
if ($PlainCodePath -and $PrivateOutputRoot) {
    $normPlain = $PlainCodePath.Replace('/', '\')
    $normPriv = $PrivateOutputRoot.Replace('/', '\')
    if ($normPlain.StartsWith($normRepo, [System.StringComparison]::OrdinalIgnoreCase) -or
        $normPriv.StartsWith($normRepo, [System.StringComparison]::OrdinalIgnoreCase)) {
        Die "明文码路径与私有输出目录必须在仓库目录之外。"
    }
    if (-not (Test-Path $PlainCodePath)) {
        Die "指定的明文码源文件不存在: $PlainCodePath"
    }
    if (-not (Test-Path $PrivateOutputRoot)) {
        New-Item -ItemType Directory -Path $PrivateOutputRoot -Force | Out-Null
    }
    $targetName = Split-Path -Leaf $PlainCodePath
    $dest = Join-Path $PrivateOutputRoot $targetName
    if (Test-Path $dest) {
        Die "私有输出目标已存在同名文件，拒绝覆盖: $dest"
    }
    Copy-Item $PlainCodePath $dest
    Ok "明文码安全转移至私有目录: $dest"
} else {
    Ok "未指定 -PlainCodePath / -PrivateOutputRoot，跳过明文码搬运（此轮只改工具源码，不搬真实码）"
}

# ------------------------------------------------------------ leak guardrail

Step 'Guardrail: DevKit must contain no plaintext codes (Issue J06)'
$scannedFiles = Get-ChildItem $DevKit -Recurse -File | Where-Object { $_.Extension -match '^\.(csv|txt|md|bat|json|xml)$' }
$leaks = 0

foreach ($f in $scannedFiles) {
    if ($f.Name -like 'codes_export_*.txt') {
        Write-Host "  XX  发现明文导出文件位于 DevKit 中: $($f.Name)" -ForegroundColor Red
        $leaks++
        continue
    }
    $text = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $text) { continue }
    # Detect standard activation code format SC-XXXXX-XXXXX-XXXXX-XXXXX without printing raw codes
    if ($text -match 'SC-[A-Za-z0-9]{5}-[A-Za-z0-9]{5}-[A-Za-z0-9]{5}-[A-Za-z0-9]{5}') {
        Write-Host "  XX  检测到疑似明文码格式内容，文件: $($f.Name)" -ForegroundColor Red
        $leaks++
    }
}

if ($leaks -gt 0) {
    Die "$leaks 处疑似泄露 — DevKit NOT shippable"
}
Ok "扫描了 $($scannedFiles.Count) 个文本文件，未发现显式明文码模式匹配（注：仅覆盖已知文本模式与文件范围，不构成非文本/二进制全量无秘密数学证明）"

# ---------------------------------------------------------------- user side

$bundleDir = Join-Path $Repo 'src-tauri\target\release\bundle\nsis'
$installer = $null
if ((-not $SkipUserKit) -and (-not $SkipBuild)) {
    Step 'Building NSIS installer (user side)'
    Push-Location $Repo
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { Die 'npm run build failed' }
    } finally { Pop-Location }
    Ok 'frontend built'

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
} elseif ($SkipBuild) {
    Warn "SkipBuild 模式：跳过 UserKit 构建"
}

$signStatus = "未配置 (BLOCKED_INPUT: 待外部提供代码签名证书或 Thumbprint)"
if ($installer) {
    Step 'Windows Authenticode 代码签名 (Issue J02)'
    $signtool = $null
    $sdkPaths = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe",
        "${env:ProgramFiles}\Windows Kits\10\bin\*\x64\signtool.exe"
    )
    foreach ($p in $sdkPaths) {
        $found = Get-Item $p -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
        if ($found) { $signtool = $found.FullName; break }
    }
    if (-not $signtool) {
        $signtoolCmd = Get-Command 'signtool.exe' -ErrorAction SilentlyContinue
        if ($signtoolCmd) { $signtool = $signtoolCmd.Source }
    }

    if ($SignCertThumbprint -or $SignCertPath) {
        if (-not $signtool) {
            Die "已配置签名证书参数，但在系统中未找到 signtool.exe（请安装 Windows SDK）。"
        }
        $targetFile = $installer.FullName
        $signArgs = @('sign', '/fd', 'SHA256', '/tr', $TimestampServer, '/td', 'SHA256')
        if ($SignCertThumbprint) {
            $signArgs += @('/sha1', $SignCertThumbprint)
        } elseif ($SignCertPath) {
            $signArgs += @('/f', $SignCertPath)
            if ($SignCertPassword) { $signArgs += @('/p', $SignCertPassword) }
        }
        $signArgs += $targetFile

        Write-Host "  >>  正在对安装程序进行代码签名: $targetFile" -ForegroundColor Cyan
        & $signtool @signArgs
        if ($LASTEXITCODE -ne 0) {
            Die "signtool 签名执行失败 (Exit code: $LASTEXITCODE)"
        }
        & $signtool verify /pa $targetFile
        if ($LASTEXITCODE -ne 0) {
            Die "signtool 签名验证失败 (Exit code: $LASTEXITCODE)"
        }
        $signStatus = "已签名并验证 (SHA256 + RFC3161 Timestamp)"
        Ok "Windows Authenticode 签名成功并通过验证: $signStatus"
    } else {
        Warn "Windows Authenticode 代码签名未配置（状态：BLOCKED_INPUT - 等待外部提供有效代码签名证书或证书指纹）。已保留未签名安装包。"
    }

    $userKit = Join-Path $OutRoot '用户端'
    New-Item -ItemType Directory -Path $userKit -Force | Out-Null
    Copy-Item $installer.FullName (Join-Path $userKit $installer.Name) -Force
    Ok "user installer copied -> $userKit"
}

# ------------------------------------------------------------ final summary

Step 'Summary'
Write-Host "  DevKit   : $DevKit"
Get-ChildItem $DevKit | ForEach-Object {
    $sz = if ($_.PSIsContainer) { '' } else { "  $([math]::Round($_.Length / 1KB, 1)) KB" }
    Write-Host "              $($_.Name)$sz"
}
if ($installer) {
    Write-Host "  UserKit  : $(Join-Path $OutRoot '用户端')"
    Write-Host "  CodeSign : $signStatus"
}
Write-Host ''

