@echo off
setlocal
cd /d "%~dp0"
title Interview Local Chat v1

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required.
  echo Download it from https://nodejs.org/
  pause
  exit /b 1
)

node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major^>22 ^|^| major===22 ^&^& minor^>=13?0:1)"
if errorlevel 1 (
  echo Node.js 22.13 or newer is required. Current version:
  node --version
  pause
  exit /b 1
)

if not exist "node_modules\@openai\codex\bin\codex.js" (
  echo Installing local dependencies. This happens only on the first run...
  call npm ci
  if errorlevel 1 (
    echo Installation failed. Check your network connection and try again.
    pause
    exit /b 1
  )
)

echo Starting Interview Local Chat v1 with your own ChatGPT account...
echo Keep this window open while using the chat.
call npm run local:open
pause
