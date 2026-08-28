# Descarga el PHP portátil que usa "servir.ps1" / "servir.bat" para probar
# Stockly en Windows sin instalar nada. Solo hace falta ejecutarlo una vez.
#
#   Clic derecho -> "Ejecutar con PowerShell"
#
$ErrorActionPreference = "Stop"
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest    = Join-Path $here "php"
$version = "8.3.33"
$url     = "https://downloads.php.net/~windows/releases/php-$version-nts-Win32-vs16-x64.zip"

if (Test-Path (Join-Path $dest "php.exe")) {
    Write-Host "Ya existe tools\php\php.exe. Nada que hacer." -ForegroundColor Green
    return
}

Write-Host "Descargando PHP $version (~34 MB)..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$zip = Join-Path $env:TEMP "stockly-php.zip"
Invoke-WebRequest -Uri $url -OutFile $zip

Write-Host "Descomprimiendo en tools\php ..." -ForegroundColor Cyan
Expand-Archive -Path $zip -DestinationPath $dest -Force
Remove-Item $zip -Force

# php.ini mínimo para el servidor de pruebas (sesiones, mbstring, etc.)
$ini = @"
extension_dir = "ext"
extension = mbstring
extension = fileinfo
extension = openssl
display_errors = On
error_reporting = E_ALL & ~E_DEPRECATED & ~E_STRICT
log_errors = On
session.save_path = "`${TEMP}"
date.timezone = "America/Bogota"
upload_max_filesize = 20M
post_max_size = 24M
memory_limit = 256M
max_execution_time = 60
"@
Set-Content -Path (Join-Path $dest "php.ini") -Value $ini -Encoding utf8

& (Join-Path $dest "php.exe") -c (Join-Path $dest "php.ini") -v
Write-Host ""
Write-Host "Listo. Ahora ya puedes usar tools\servir.bat" -ForegroundColor Green
