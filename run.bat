@echo off
@REM Serve the webui on localhost:8077

setlocal enabledelayedexpansion
echo "Starting Minerva..."
npm install
node server.js