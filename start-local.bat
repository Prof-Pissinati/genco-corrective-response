@echo off
rem Starts the backend (port 8000) and the interface (port 5173) in two windows and opens the browser. Double-click to use.
rem Requires: Node.js and the backend Python environment in ..\backend-run (see backend\README.md).
rem Usage to check the paths without opening anything:  start-local.bat --check
setlocal
set "RAIZ=%~dp0"
set "PY=%RAIZ%..\backend-run\Scripts\python.exe"

if not exist "%PY%" (
  echo [ERROR] Backend environment not found at: %PY%
  echo Create it once with these two commands:
  echo   python -m venv "%RAIZ%..\backend-run"
  echo   "%PY%" -m pip install -r "%RAIZ%backend\requirements.txt"
  pause
  exit /b 1
)

if /I "%~1"=="--check" (
  echo Project ROOT      : %RAIZ%
  echo Backend Python    : %PY%
  echo Backend command   : "%PY%" -m uvicorn app.main:app --port 8000   ^(folder: %RAIZ%backend^)
  echo Interface command : npm run dev   ^(folder: %RAIZ%interface^)
  exit /b 0
)

start "GENCO Backend (port 8000) - close to stop" /D "%RAIZ%backend" cmd /k ""%PY%" -m uvicorn app.main:app --port 8000"
start "GENCO Interface (port 5173) - close to stop" /D "%RAIZ%interface" cmd /k "npm run dev"
timeout /t 8 /nobreak >nul
start "" "http://localhost:5173"
endlocal
