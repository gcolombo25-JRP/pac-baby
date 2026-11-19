@echo off
rem ============================================================
rem  Pac-Baby: Node.js 탐색 및 PATH 보정 (내부 공용 파일)
rem  - run.bat / test.bat 에서 call 로 사용합니다.
rem  - 직접 실행하지 마세요.
rem ============================================================
if defined PACBABY_NODE_ENV_READY exit /b 0
set "PACBABY_NODE_ENV_READY=1"

rem 1) PATH 에 node 가 있으면 그 경로를 사용
for /f "delims=" %%P in ('where node 2^>nul') do if not defined PACBABY_NODE_EXE set "PACBABY_NODE_EXE=%%~fP"

rem 2) 없으면 자주 쓰는 설치 경로를 확인
if not defined PACBABY_NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "PACBABY_NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined PACBABY_NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PACBABY_NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined PACBABY_NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PACBABY_NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined PACBABY_NODE_EXE (
  echo [ERROR] Node.js 를 찾을 수 없습니다.
  echo         https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  exit /b 1
)

rem 3) node 폴더를 PATH 앞에 추가 ^(npm 내부 스크립트가 node 를 찾을 수 있도록^)
for %%I in ("%PACBABY_NODE_EXE%") do set "PACBABY_NODE_DIR=%%~dpI"
set "PATH=%PACBABY_NODE_DIR%;%PATH%"

rem 4) npm.cmd 경로 확인 ^(PowerShell 실행 정책 우회를 위해 .cmd 사용^)
set "PACBABY_NPM_CMD=%PACBABY_NODE_DIR%npm.cmd"
if not exist "%PACBABY_NPM_CMD%" set "PACBABY_NPM_CMD=npm.cmd"

exit /b 0
