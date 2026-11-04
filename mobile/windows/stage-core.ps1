# Copies the Kotlin core (rejboard_core.dll) and the MinGW DLLs it needs (SQLite, ...) into the Visual Studio project folder,
# so MSBuild packages them next to RejBoardNative.exe. Also checks that rejboard_core.h / .def still match the functions
# the core exports.
#
#   gradle -p mobile :core:linkReleaseSharedMingwX64 -Prb.sqliteMingwDir=C:/msys64/mingw64/lib
#   pwsh mobile/windows/stage-core.ps1 -Msys2Root C:\msys64
param(
    [Parameter(Mandatory = $true)][string]$Msys2Root
)
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Join-Path $here 'RejBoardNative'
$out = Join-Path $here '..\core\build\bin\mingwX64\releaseShared'

$dll = Get-ChildItem $out -Filter '*.dll' | Select-Object -First 1
if (-not $dll) { throw "No DLL in ${out}: build the core first (gradle :core:linkReleaseSharedMingwX64)" }
Copy-Item $dll.FullName (Join-Path $project 'rejboard_core.dll') -Force
Write-Host "core: $($dll.Name) -> rejboard_core.dll"

# every function rejboard_core.def lists must be declared in the header Kotlin/Native generated
$api = Get-ChildItem $out -Filter '*_api.h' | Select-Object -First 1
if (-not $api) { throw "No *_api.h in ${out}" }
$header = Get-Content $api.FullName -Raw
$names = Select-String -Path (Join-Path $project 'rejboard_core.def') -Pattern '^\s+(rb_\w+)' | ForEach-Object { $_.Matches[0].Groups[1].Value }
foreach ($n in $names) {
    if ($header -notmatch "\b$n\s*\(") { throw "rejboard_core.def lists $n but the core does not export it ($($api.Name))" }
}
Write-Host "exports checked: $($names -join ', ')"

# MinGW DLLs the core depends on (found with MSYS2's ldd), plus SQLite itself as a fallback
$mingwBin = Join-Path $Msys2Root 'mingw64\bin'
$deps = @('libsqlite3-0.dll')
$ldd = Join-Path $Msys2Root 'usr\bin\ldd.exe'
if (Test-Path $ldd) {
    $env:PATH = "$mingwBin;$env:PATH"
    foreach ($line in (& $ldd (Join-Path $project 'rejboard_core.dll') 2>$null)) {
        if ($line -match '^\s*(\S+\.dll)\s*=>\s*/mingw64/bin/') { $deps += $Matches[1] }
    }
}
foreach ($d in ($deps | Sort-Object -Unique)) {
    $src = Join-Path $mingwBin $d
    if (-not (Test-Path $src)) { throw "Missing $src (install mingw-w64-x86_64-sqlite3 in MSYS2)" }
    Copy-Item $src $project -Force
    Write-Host "dependency: $d"
}
