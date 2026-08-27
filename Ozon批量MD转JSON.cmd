@echo off
chcp 65001 >nul
setlocal
title Ozon Batch Markdown to JSON

powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0tools\md-to-json-gui.ps1" %*
if errorlevel 1 (
  echo.
  echo Conversion failed. Please review the message above.
  pause
)

endlocal
