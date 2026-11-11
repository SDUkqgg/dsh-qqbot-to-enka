@echo off
chcp 65001 >nul
cd /d "%~dp0"
set MIHOYO_STANDALONE_BOT=1
call "%~dp0start.bat"