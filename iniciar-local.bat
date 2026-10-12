@echo off
rem Liga o backend (porta 8000) e a interface (porta 5173) em duas janelas e abre o navegador. Duplo clique para usar.
rem Requer: Node.js e o ambiente Python do backend em ..\backend-run (veja backend\README.md).
rem Uso para checar os caminhos sem abrir nada:  iniciar-local.bat --teste
setlocal
set "RAIZ=%~dp0"
set "PY=%RAIZ%..\backend-run\Scripts\python.exe"

if not exist "%PY%" (
  echo [ERRO] Ambiente do backend nao encontrado em: %PY%
  echo Crie-o uma vez com estes dois comandos:
  echo   python -m venv "%RAIZ%..\backend-run"
  echo   "%PY%" -m pip install -r "%RAIZ%backend\requirements.txt"
  pause
  exit /b 1
)

if /I "%~1"=="--teste" (
  echo RAIZ do projeto : %RAIZ%
  echo Python backend  : %PY%
  echo Comando backend : "%PY%" -m uvicorn app.main:app --port 8000   ^(pasta: %RAIZ%backend^)
  echo Comando interface: npm run dev   ^(pasta: %RAIZ%interface^)
  exit /b 0
)

start "Backend GENCO (porta 8000) - feche para parar" /D "%RAIZ%backend" cmd /k ""%PY%" -m uvicorn app.main:app --port 8000"
start "Interface GENCO (porta 5173) - feche para parar" /D "%RAIZ%interface" cmd /k "npm run dev"
timeout /t 8 /nobreak >nul
start "" "http://localhost:5173"
endlocal
