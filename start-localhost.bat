@echo off
title Eternalgy CRM Local Server
cd /d "%~dp0"
echo ========================================================
echo        Eternalgy CRM - Local Server Runner
echo ========================================================
echo Starting server on http://localhost:8935 ...
echo Press Ctrl+C in this window to stop the server.
echo ========================================================
node serve.cjs case-hub-api.html 8935
pause
