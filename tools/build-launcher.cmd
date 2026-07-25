@echo off
rem 重新编译 MiniTelephone 一键启动器（使用 Windows 自带的 csc.exe，无需安装 .NET SDK）
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo [错误] 未找到 csc.exe，请确认系统安装了 .NET Framework 4.x
  pause
  exit /b 1
)
"%CSC%" /nologo /target:exe /out:"%~dp0..\MiniTelephone.exe" "%~dp0MiniTelephoneLauncher.cs"
if errorlevel 1 (
  echo [错误] 编译失败
  pause
  exit /b 1
)
echo 编译成功：%~dp0..\MiniTelephone.exe
pause
