@echo off
REM Arranca el inventario en tu ordenador. Doble clic aqui.
REM Luego abre en el navegador:  http://localhost:8080
setlocal
set "HERE=%~dp0"
set "PHP_CLI_SERVER_WORKERS=6"
echo.
echo   Stockly  -^>  http://localhost:8080
echo   (cierra esta ventana para parar)
echo.
"%HERE%php\php.exe" -c "%HERE%php\php.ini" -S localhost:8080 -t "%HERE%..\public_html" "%HERE%..\public_html\router.php"
