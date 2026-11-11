@echo off
chcp 65001 >nul
cd /d "%~dp0"
if "%DSH_MIHOYO_HOME%"=="" set DSH_MIHOYO_HOME=F:\dsh\mihoyo
node server.mjs --no-open
pause