@echo off
rem ARYAK Assistant on Windows: installs once, then runs. Keep this window open.
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js LTS from https://nodejs.org first. & pause & exit /b 1)
if not exist node_modules call npm install
node --env-file=.env src\index.js
pause
