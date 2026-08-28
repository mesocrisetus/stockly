# Arranca el inventario en tu ordenador para probarlo.
#   1. Clic derecho en este fichero  ->  "Ejecutar con PowerShell"
#   2. Abre en el navegador:  http://localhost:8080
#   3. Deja esta ventana abierta mientras lo uses. Ciérrala para parar.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$php  = Join-Path $here "php\php.exe"
$ini  = Join-Path $here "php\php.ini"
$pub  = Join-Path $root "public_html"

$env:PHP_CLI_SERVER_WORKERS = "6"   # varias peticiones a la vez (solo en local)
Write-Host ""
Write-Host "  Stockly  ->  http://localhost:8080" -ForegroundColor Cyan
Write-Host "  (cierra esta ventana para parar)" -ForegroundColor DarkGray
Write-Host ""
& $php -c $ini -S localhost:8080 -t $pub (Join-Path $pub "router.php")
