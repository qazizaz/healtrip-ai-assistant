@echo off
rem Double-click to start HealTrip+ locally (needs Docker Desktop and Node.js 22).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dev.ps1"
pause
