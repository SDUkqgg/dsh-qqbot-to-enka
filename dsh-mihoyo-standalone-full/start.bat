@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [dsh-mihoyo-standalone] starting...

set "NODE=node"
if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if exist "%~dp0runtime\node\bin\node.exe" set "NODE=%~dp0runtime\node\bin\node.exe"
echo Node: 
"%NODE%" -v

if not exist "node_modules\pngjs" if not exist "node_modules\@tencent-connect" if not exist "node_modules\qrcode" (
  echo installing dependencies, one time only...
  call npm install --omit=dev --registry https://registry.npmmirror.com
  if errorlevel 1 ( echo dependency install failed & pause & exit /b 1 )
)
rem data dir defaults to .\data ; set DSH_MIHOYO_HOME to reuse an existing install
if "%MIHOYO_STANDALONE_PORT%"=="" set MIHOYO_STANDALONE_PORT=8788
"%NODE%" server.mjs
echo.
echo server stopped.
pause