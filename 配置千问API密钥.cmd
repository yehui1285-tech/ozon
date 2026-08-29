@echo off
cd /d "%~dp0"
title Configure Qwen API Key
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "pinduoduo-agent\configure-qwen-key.ps1"
echo.
pause
