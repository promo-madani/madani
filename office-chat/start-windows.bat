@echo off
title AI Department Chat Server
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this again.& pause & exit /b 1)
node server.js
pause
