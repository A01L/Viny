@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите LTS-версию с https://nodejs.org и запустите этот файл снова.
  pause
  exit /b 1
)
if not exist "node_modules\electron-builder" (
  echo Устанавливаю зависимости...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)
echo Собираю Viny для Windows...
call npm run dist
if errorlevel 1 (
  echo.
  echo Сборка не удалась. Если в ошибке есть "Cannot create symbolic link",
  echo запустите этот файл от имени администратора или включите
  echo "Режим разработчика" в Параметрах Windows и повторите.
  pause
  exit /b 1
)
echo.
echo Готово! Установщик и портативная версия лежат в папке dist.
start "" "%~dp0dist"
pause
