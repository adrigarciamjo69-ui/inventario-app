# Compila los binarios del agente para Windows / Linux / macOS.
#
# No requiere Docker ni privilegios de admin.
# - Si tienes Go instalado, lo usa.
# - Si no, descarga Go portable a .\go-toolchain\ (~150 MB, una sola vez).
#
# Uso:
#   .\build.ps1
#
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
New-Item -ItemType Directory -Force -Path .\bin | Out-Null

$GoVersion = '1.22.5'
$LocalGoRoot = Join-Path $PSScriptRoot 'go-toolchain\go'
$LocalGoExe  = Join-Path $LocalGoRoot 'bin\go.exe'

function Find-Go {
    if (Test-Path $LocalGoExe) { return $LocalGoExe }
    $cmd = Get-Command go.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

$go = Find-Go
if (-not $go) {
    Write-Host "[build] Go no encontrado. Descargando Go $GoVersion portable..." -ForegroundColor Yellow
    $zip = Join-Path $PSScriptRoot 'go-toolchain\go.zip'
    New-Item -ItemType Directory -Force -Path (Split-Path $zip) | Out-Null
    $url = "https://go.dev/dl/go$GoVersion.windows-amd64.zip"
    Write-Host "[build] desde $url (esto tarda 1-3 min)..."
    # ProgressPreference SilentlyContinue acelera mucho Invoke-WebRequest
    $prev = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    } finally {
        $ProgressPreference = $prev
    }
    Write-Host "[build] extrayendo..."
    Expand-Archive -Path $zip -DestinationPath (Join-Path $PSScriptRoot 'go-toolchain') -Force
    Remove-Item $zip
    if (-not (Test-Path $LocalGoExe)) {
        throw "[build] no se encontro $LocalGoExe tras la extraccion. Aborto."
    }
    $go = $LocalGoExe
}

Write-Host "[build] usando Go: $go" -ForegroundColor Cyan
& $go version

# Aseguramos modulos al dia
Write-Host "[build] go mod tidy..."
& $go mod tidy

$env:CGO_ENABLED = '0'
$flags = @('-trimpath', '-ldflags', '-s -w')

function Build-Target {
    param([string]$Os, [string]$Arch, [string]$Out)
    Write-Host "[build] -> $Os/$Arch  =>  $Out" -ForegroundColor Green
    $env:GOOS   = $Os
    $env:GOARCH = $Arch
    & $go build @flags -o $Out .
    if ($LASTEXITCODE -ne 0) { throw "go build fallo para $Os/$Arch" }
}

Build-Target 'windows' 'amd64' 'bin\inventario-agent-windows.exe'
Build-Target 'linux'   'amd64' 'bin\inventario-agent-linux'
Build-Target 'darwin'  'amd64' 'bin\inventario-agent-darwin-amd64'
Build-Target 'darwin'  'arm64' 'bin\inventario-agent-darwin-arm64'

# Alias generico: macOS modernos son Apple Silicon. Si tu parque es mayoritariamente
# Intel, sobreescribe este fichero con el -amd64 en su lugar.
Copy-Item 'bin\inventario-agent-darwin-arm64' 'bin\inventario-agent-darwin' -Force

Write-Host ""
Write-Host "[build] OK. Binarios generados en .\bin\" -ForegroundColor Green
Get-ChildItem .\bin | Format-Table Name, Length, LastWriteTime
Write-Host "Subelos a la app desde Ajustes -> Agentes -> Binarios del agente (uno por SO)."
