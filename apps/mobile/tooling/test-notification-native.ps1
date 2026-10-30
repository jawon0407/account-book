param([Parameter(Mandatory=$true)][string]$JavaHome, [Parameter(Mandatory=$true)][string]$GradleCache)
$ErrorActionPreference = 'Stop'
# Reuse the installed Android compiler; never download or inspect device notifications.
$modules = Join-Path $GradleCache 'caches/modules-2/files-2.1'
$coordinates = @('org.jetbrains.kotlin/kotlin-compiler-embeddable/2.1.20', 'org.jetbrains.kotlin/kotlin-stdlib/2.1.20', 'org.jetbrains.kotlin/kotlin-script-runtime/2.1.20', 'org.jetbrains.kotlin/kotlin-reflect/2.1.20', 'org.jetbrains/annotations/13.0', 'org.jetbrains.intellij.deps/trove4j/1.0.20200330', 'org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm/1.8.0')
$jars = @($coordinates | ForEach-Object { Get-ChildItem -LiteralPath (Join-Path $modules $_) -Recurse -Filter '*.jar' | Select-Object -ExpandProperty FullName })
$classpath = $jars -join ';'
$root = Split-Path $PSScriptRoot -Parent
$output = Join-Path $root 'dist/native-tests'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$sources = @(Get-ChildItem -LiteralPath (Join-Path $root 'modules/notification-access/android/src/main/java/com/accountbook/notificationaccess') -Filter '*.kt' | Where-Object { $_.Name -in @('CaptureEngine.kt','CashNotificationParser.kt') } | Select-Object -ExpandProperty FullName)
$sources += Join-Path $root 'modules/notification-access/android/src/test/kotlin/CaptureBehaviorTest.kt'
& (Join-Path $JavaHome 'bin/java.exe') -cp $classpath org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -classpath $classpath -d $output @sources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $JavaHome 'bin/java.exe') -cp "$output;$classpath" com.accountbook.notificationaccess.CaptureBehaviorTestKt
exit $LASTEXITCODE
