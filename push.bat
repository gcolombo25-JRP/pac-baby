@echo off
rem ============================================================
rem  Pac-Baby: GitHub 업로드 (더블클릭으로 실행하세요)
rem  - 커밋이 없으면 만들고 origin(main) 으로 push 합니다.
rem  - 최초 1회는 GitHub 로그인 창이 뜹니다(Git Credential Manager).
rem  - 옵션 예시: push.bat "커밋 메시지"
rem ============================================================
setlocal EnableExtensions
chcp 65001 >nul
title Pac-Baby - Push to GitHub
cd /d "%~dp0"

set "REMOTE_URL=https://github.com/gcolombo25-JRP/pac-baby.git"
set "PAGES_URL=https://gcolombo25-jrp.github.io/pac-baby/"
set "MSG=%~1"
if not defined MSG set "MSG=chore: Pac-Baby update"

rem --- git 실행 파일 찾기 (PATH 에 없어도 표준 경로에서 찾는다) ---
set "GIT_EXE="
if exist "%ProgramFiles%\Git\bin\git.exe" set "GIT_EXE=%ProgramFiles%\Git\bin\git.exe"
if not defined GIT_EXE if exist "%ProgramFiles%\Git\cmd\git.exe" set "GIT_EXE=%ProgramFiles%\Git\cmd\git.exe"
if not defined GIT_EXE if exist "%ProgramFiles(x86)%\Git\bin\git.exe" set "GIT_EXE=%ProgramFiles(x86)%\Git\bin\git.exe"
if not defined GIT_EXE for /f "delims=" %%i in ('where git 2^>nul') do if not defined GIT_EXE set "GIT_EXE=%%i"

if not defined GIT_EXE (
  echo.
  echo [ERROR] git 을 찾을 수 없습니다.
  echo         Git for Windows 설치: https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo   Pac-Baby - GitHub 업로드
echo ============================================================
echo   git    : %GIT_EXE%
"%GIT_EXE%" --version
echo   remote : %REMOTE_URL%
echo.

echo [1/3] 저장소 준비
if not exist ".git" "%GIT_EXE%" init -b main >nul
"%GIT_EXE%" rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] 이 폴더를 git 저장소로 열 수 없습니다.
  echo         위에 표시되는 안내 - dubious ownership 등 - 를 따른 뒤 다시 실행해 주세요.
  echo         예: git config --global --add safe.directory "%CD:\=/%"
  "%GIT_EXE%" status
  pause
  exit /b 1
)
"%GIT_EXE%" config --local user.name >nul 2>&1 || "%GIT_EXE%" config --local user.name "gcolombo25-JRP"
"%GIT_EXE%" config --local user.email >nul 2>&1 || "%GIT_EXE%" config --local user.email "358568176+gcolombo25-JRP@users.noreply.github.com"
"%GIT_EXE%" remote get-url origin >nul 2>&1 || "%GIT_EXE%" remote add origin "%REMOTE_URL%"
echo       완료

echo [2/3] 변경사항 커밋
"%GIT_EXE%" add -A
"%GIT_EXE%" diff --cached --quiet
if errorlevel 1 (
  "%GIT_EXE%" commit -m "%MSG%"
) else (
  echo       변경사항 없음 ^(이미 커밋됨^)
)

echo [3/3] push ^(최초 1회는 GitHub 로그인 창이 뜹니다^)
"%GIT_EXE%" push -u origin main
if errorlevel 1 (
  echo.
  echo [ERROR] push 에 실패했습니다.
  echo         - 새 창에서 GitHub 로그인을 승인했는지 확인하세요.
  echo         - 2단계 인증 사용 시 비밀번호 대신 Personal Access Token ^(repo 권한^)을 입력합니다.
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   업로드 완료
echo ============================================================
echo   저장소 : https://github.com/gcolombo25-JRP/pac-baby
echo   Pages  : %PAGES_URL%
echo.
echo   * 최초 1회만: GitHub 저장소 - Settings - Pages -
echo     Build and deployment - Source 를 "GitHub Actions" 로 설정하세요.
echo   * push 후 1~2분 뒤 사이트가 갱신됩니다 ^(주소는 그대로^).
echo.
pause
