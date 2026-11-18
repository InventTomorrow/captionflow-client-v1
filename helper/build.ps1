# Builds the Asaan Caption Helper into public/helper/AsaanCaptionHelper.exe, which
# the website offers as its download. Needs only Windows: the C# compiler
# ships with .NET Framework 4.8.
#   powershell -ExecutionPolicy Bypass -File helper/build.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here '..\public\helper'
New-Item -ItemType Directory -Force $out | Out-Null
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /optimize+ /platform:anycpu "/win32icon:$here\app.ico" "/out:$out\AsaanCaptionHelper.exe" `
  /r:System.Web.dll /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll `
  "$here\AsaanCaptionHelper.cs"
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
Get-Item "$out\AsaanCaptionHelper.exe" | Select-Object Name, Length
