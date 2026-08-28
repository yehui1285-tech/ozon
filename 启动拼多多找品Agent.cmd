@echo off
cd /d "%~dp0"
title Ozon Pinduoduo Sourcing Agent
node pinduoduo-agent\server.mjs
echo.
echo Agent stopped. Press any key to close.
pause >nul
