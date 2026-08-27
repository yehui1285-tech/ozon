@echo off
chcp 65001 >nul
setlocal
title Ozon批量扫描MD转JSON

powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0tools\md-to-json-gui.ps1"
if errorlevel 1 (
  echo.
  echo 转换没有完成，请查看上方提示。
  pause
)

endlocal
