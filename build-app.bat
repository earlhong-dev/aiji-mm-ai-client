@echo off
title Aiji Multi-Model AI Client - Build
cd /d "%~dp0"

echo Cleaning old .exe files...
del /q release\*.exe 2>nul

echo Building new executable...
npm run electron:build
pause
