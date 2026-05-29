@echo off
title AI Tool
cd /d "%~dp0"
if not exist "node_modules" (
  echo Installing dependencies...
  call npm install --legacy-peer-deps
)
call npm run electron:dev
