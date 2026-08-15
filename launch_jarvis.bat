@echo off
title J.A.R.V.I.S Desktop Launcher
echo Launching J.A.R.V.I.S Control Center...
start "" chrome --app=http://localhost:3000 --window-size=1280,820 || start "" msedge --app=http://localhost:3000 --window-size=1280,820 || start http://localhost:3000
