@echo off
rem ============================================================
rem  Pac-Baby: 테스트 + 빌드 검증 (더블클릭으로 실행하세요)
rem  - 단위 테스트: node --test tests/
rem  - 프로덕션 빌드: vite build
rem ============================================================
setlocal EnableExtensions
chcp 65001 >nul
title Pac-Baby - Test
cd /d "%~dp0"

call "%~dp0_node-env.bat"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo   Pac-Baby 테스트
echo ============================================================
echo   Node.js : %PACBABY_NODE_EXE%
"%PACBABY_NODE_EXE%" -v
echo.

if not exist "node_modules\vite\package.json" (
  echo [0/2] 의존성이 없어 먼저 설치합니다...
  call "%PACBABY_NPM_CMD%" install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] npm install 에 실패했습니다.
    pause
    exit /b 1
  )
  echo.
)

echo [1/2] 단위 테스트 실행
call "%PACBABY_NPM_CMD%" run test
if errorlevel 1 (
  echo.
  echo [실패] 테스트가 실패했습니다. 위 로그를 확인해 주세요.
  pause
  exit /b 1
)

echo.
echo [2/2] 프로덕션 빌드 확인
call "%PACBABY_NPM_CMD%" run build
if errorlevel 1 (
  echo.
  echo [실패] 빌드에 실패했습니다.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   모든 테스트와 빌드가 통과했습니다.
echo ============================================================
pause
