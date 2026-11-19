@echo off
chcp 65001 >nul
cd /d "%~dp0"
node server.js
if errorlevel 1 (
  echo.
  echo اجرا ناموفق بود. مطمئن شوید Node.js نصب شده است.
  pause
)
