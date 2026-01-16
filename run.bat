@echo off
@REM Serve the webui on localhost:8077


echo "Starting Minerva..."

cd server
call npm install
call npm start