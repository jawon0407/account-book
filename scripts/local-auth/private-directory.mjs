import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Windows ACL 조회 결과에서 사용자/SYSTEM 외 접근과 불완전한 상속을 거부합니다.
 * @param {object} acl 값 대신 권한 여부만 담은 조회 결과.
 * @returns {boolean} 현재 사용자 소유, 보호된 DACL, 자식 파일에도 적용될 최소 허용 목록 여부.
 */
export function isPrivateAcl(acl) {
  return acl?.ownerMatches === true && acl?.protected === true && Array.isArray(acl.rules) &&
    acl.rules.length === 2 && new Set(acl.rules.map((rule) => rule.principal)).size === 2 &&
    acl.rules.every((rule) => ["user", "system"].includes(rule.principal) && rule.allow === true && rule.fullControl === true && rule.inheritable === true);
}

/**
 * 비밀 쓰기 전 실제 NTFS ACL을 읽습니다. mode:0600에 의존하지 않으며 ACL을 임의 수정하지 않습니다.
 * @param {string} directory 사용자 로컬 비밀 디렉터리의 절대 경로.
 * @returns {void} 안전하지 않거나 검증할 수 없으면 고정 오류로 중단합니다.
 */
export function assertPrivateDirectory(directory) {
  try {
    if (process.platform !== "win32" || !existsSync(directory) || lstatSync(directory).isSymbolicLink() || realpathSync(directory).toLowerCase() !== resolve(directory).toLowerCase()) throw new Error();
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot) throw new Error();
    const script = String.raw`
      $ErrorActionPreference='Stop'
      $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      $acl=Get-Acl -LiteralPath $env:AB_PRIVATE_DIRECTORY
      $owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
      $rules=@($acl.Access | ForEach-Object {
        $principal=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        $kind=if($principal -eq $sid){'user'}elseif($principal -eq 'S-1-5-18'){'system'}else{'other'}
        @{
          principal=$kind
          allow=($_.AccessControlType -eq 'Allow')
          fullControl=($_.FileSystemRights -eq [System.Security.AccessControl.FileSystemRights]::FullControl)
          inheritable=(($_.InheritanceFlags -band 3) -eq 3 -and $_.PropagationFlags -eq 'None')
        }
      })
      @{ownerMatches=($owner -eq $sid);protected=$acl.AreAccessRulesProtected;rules=$rules}|ConvertTo-Json -Depth 4 -Compress
    `;
    const output = execFileSync(join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { env: { SystemRoot: systemRoot, AB_PRIVATE_DIRECTORY: directory }, windowsHide: true, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8", timeout: 10_000 });
    if (!isPrivateAcl(JSON.parse(output))) throw new Error();
  } catch { throw new Error("LOCAL_AUTH_PRIVATE_ACL_INVALID"); }
}
