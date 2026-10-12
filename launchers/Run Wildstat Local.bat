@echo off
rem Double-click to run WildStat locally on Windows (see run-wildstat-local.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-wildstat-local.ps1"
if errorlevel 1 pause
