@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js가 필요합니다. Node.js 22.12 이상을 설치한 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)
node start.mjs %*
if errorlevel 1 pause
