param(
  [Parameter(Mandatory=$true)][string]$AdbPath,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9._:-]+$')][string]$Serial,
  [Parameter(Mandatory=$true)][ValidateSet('expense','income','approval','amount-mismatch')][string]$Case
)
$ErrorActionPreference = 'Stop'
# Fixed, fictional examples only. No real notifications, permissions or account data are read.
$title = '출금 19,800원'
$body = "가*나 10/29 15:53 123456-**-***789 가상상점`n체크카드출금 19,800 잔액230,121"
switch ($Case) {
  'income' {
    $title = '입금 20,000원'
    $body = "가*나 10/29 15:54 123456-**-***789 가상입금자`n전자금융입금 20,000 잔액250,121"
  }
  'approval' { $title = '승인 19,800원' }
  'amount-mismatch' { $title = '출금 19,801원' }
}
$tag = 'account-book-test-' + $Case + '-' + [Guid]::NewGuid().ToString('N')
# Shell text is exclusively from the closed cases above; no user-supplied body is interpolated.
$command = "cmd notification post -S bigtext -t '$title' '$tag' '$body'"
$result = & $AdbPath -s $Serial shell $command 2>&1
if ($LASTEXITCODE -ne 0 -or ($result -join "`n") -match '(?im)exception|error|^usage:|unknown command') {
  throw 'Synthetic notification request failed. No permission was changed.'
}
# Posting success alone does not prove that NotificationListenerService received the event.
Write-Output "Submitted synthetic case: $Case (delivery unverified; confirm the app preview separately)."
