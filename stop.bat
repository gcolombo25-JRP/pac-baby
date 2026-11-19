@echo off
rem ============================================================
rem  Pac-Baby: 개발 서버 종료 (3000 포트)
rem  - run.bat 창을 닫지 못한 경우 사용하세요.
rem ============================================================
setlocal EnableExtensions
chcp 65001 >nul
title Pac-Baby - Stop Server
cd /d "%~dp0"
set "PORT=%~1"
if not defined PORT set "PORT=3000"

echo Pac-Baby 개발 서버(%PORT% 포트)를 확인합니다...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$conns = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if (-not $conns) { Write-Host '  실행 중인 서버가 없습니다.'; exit 0 }; $targets = $conns.OwningProcess | Sort-Object -Unique; foreach ($procId in $targets) { $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue; if ($null -eq $proc) { continue }; if ($proc.ProcessName -eq 'node') { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; Write-Host ('  종료됨: node PID ' + $procId) } else { Write-Host ('  건너뜀: PID ' + $procId + ' (' + $proc.ProcessName + ')') } }"

echo.
pause
