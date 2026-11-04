@echo off
title Cap nhat Portproxy va Docker LAN
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\setup-docker-lan.ps1"
pause
