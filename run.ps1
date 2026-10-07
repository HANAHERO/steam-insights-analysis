$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist/index.html'))) {
    throw 'Prebuilt frontend not found. Use start.ps1 in the source checkout.'
}
python server.py
if ($LASTEXITCODE -ne 0) { throw 'Steam Atlas server stopped with an error.' }
