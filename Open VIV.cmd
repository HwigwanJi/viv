@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-viv.ps1" -Resume -OpenBrowser
if errorlevel 1 (
  pause
  exit /b 1
)
