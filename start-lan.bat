@echo off
title Phong hoc TOEIC 3D - LAN Launcher
cd /d "%~dp0"
node scripts\start-lan.mjs %*
if errorlevel 1 pause
