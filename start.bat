@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите LTS-версию с https://nodejs.org и запустите этот файл снова.
  pause
  exit /b 1
)
if not exist "node_modules\electron" (
  echo Первый запуск: устанавливаю зависимости, это займёт 1-2 минуты...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)
call npm start
