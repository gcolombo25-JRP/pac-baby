@echo off
rem ============================================================
rem  Pac-Baby: 개발 서버 실행 (더블클릭으로 실행하세요)
rem  - 첫 실행 시 의존성을 자동 설치합니다.
rem  - 브라우저가 http://localhost:3000 으로 자동 접속됩니다.
rem  - 옵션 예시: run.bat --port 3100
rem ============================================================
setlocal EnableExtensions
chcp 65001 >nul
title Pac-Baby - Dev Server
cd /d "%~dp0"

call "%~dp0_node-env.bat"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo   Pac-Baby 개발 서버
echo ============================================================
echo   Node.js : %PACBABY_NODE_EXE%
"%PACBABY_NODE_EXE%" -v
echo.

if not exist "node_modules\vite\package.json" (
  echo [1/2] 최초 실행입니다. 의존성을 설치합니다. ^(1~2분 소요^)
  call "%PACBABY_NPM_CMD%" install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install 에 실패했습니다. 네트워크 연결을 확인해 주세요.
    pause
    exit /b 1
  )
) else (
  echo [1/2] 의존성 확인 완료
)

echo [2/2] 서버를 시작합니다. 브라우저가 자동으로 열립니다.
echo       서버를 끄려면 이 창에서 Ctrl+C 를 누르거나 stop.bat 을 실행하세요.
echo.

rem 추가 인자를 Vite 로 넘기려면 `--` 구분자가 필요합니다 (예: run.bat --port 3100)
call "%PACBABY_NPM_CMD%" run dev -- %*

echo.
echo 개발 서버가 종료되었습니다.
pause
