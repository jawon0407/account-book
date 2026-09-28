# 외부 코드·문서 라이선스 고지

이 문서는 저장소에 복사해 보관한 아래 외부 개발 도구의 출처와 고지 파일을 연결합니다. 계정·거래 API 등 **가계부 앱 자체의 라이선스를 정하거나 변경하는 문서가 아닙니다.** 각 구성요소의 실제 이용 조건은 연결된 원문을 따릅니다.

확인일: 2026-09-28. 패키지 관리자 의존성 전체의 라이선스 목록이나 법률 검토 완료를 의미하지 않습니다. 저장소가 비공개이더라도 이 원문과 고지를 함께 보존합니다.

## 1. 적용 경로와 원문

| 구성요소 | 이 저장소에서의 경로·범위 | 보존한 고지 |
| --- | --- | --- |
| Impeccable | `.agents/skills/impeccable/`의 복사본; 아래 별도 구성요소의 조건도 함께 적용 | [Apache-2.0 LICENSE](licenses/impeccable/LICENSE), [원본 NOTICE](licenses/impeccable/NOTICE.md) |
| modern-screenshot 4.7.0 | `.agents/skills/impeccable/scripts/modern-screenshot.umd.js` 번들 | [MIT LICENSE](licenses/modern-screenshot/LICENSE) |
| Platform Design Skills | `.agents/skills/impeccable/reference/ios.md`, `.agents/skills/impeccable/reference/android.md`에 포함된 파생 내용 | [MIT LICENSE](licenses/platform-design-skills/LICENSE), [파생 출처 NOTICE](licenses/impeccable/NOTICE.md) |

`licenses/`는 원문 보관 장소입니다. 그 폴더에 있다는 이유로 라이선스가 그 폴더에만 적용되거나 앱 전체에 적용되는 것은 아닙니다. 영어 원문은 번역·요약으로 대체하지 않았습니다.

## 2. Impeccable

- 원 프로젝트: [pbakaus/impeccable](https://github.com/pbakaus/impeccable).
- 원문 저작권 고지: Copyright 2025 Paul Bakaus.
- 복사본 표시 버전: **3.9.1**. 다만 같은 이름의 릴리스 태그와 정확히 같은 복사본은 아닙니다.
- 내용이 일치하는 공식 스냅샷: [`da99645a58400ed7acb201e6904f9413efd89c6e`](https://github.com/pbakaus/impeccable/tree/da99645a58400ed7acb201e6904f9413efd89c6e).
- 출처 대응: 공식 스냅샷의 `.agents/skills/impeccable/` 아래 파일이 이 저장소에서도 같은 경로에 보관돼 있습니다. **105개 파일 모두 Git blob이 일치**합니다.
- 변경 여부: 해당 스냅샷 대비 파일 내용 변경은 확인되지 않았습니다. 작업 파일 비교에서는 CRLF를 LF로 정규화했습니다. 이번 보완은 고지 파일만 추가하며 기존 외부 파일을 수정·업데이트하지 않습니다.
- 최초 다운로드 경로 자체나 유일한 원본 커밋을 재현했다는 뜻은 아닙니다. 내용이 일치하는 스냅샷과 고지의 출처를 고정한 것입니다.

보존한 [LICENSE 원본](https://github.com/pbakaus/impeccable/blob/da99645a58400ed7acb201e6904f9413efd89c6e/LICENSE)과 [NOTICE 원본](https://github.com/pbakaus/impeccable/blob/da99645a58400ed7acb201e6904f9413efd89c6e/NOTICE.md)은 이 스냅샷 기준입니다.

## 3. modern-screenshot

- 원 프로젝트: [qq15725/modern-screenshot](https://github.com/qq15725/modern-screenshot).
- 원문 저작권 고지: Copyright (c) 2021-present wxm.
- 확인한 버전: **4.7.0**, MIT.
- 공식 [npm 4.7.0 배포 정보](https://registry.npmjs.org/modern-screenshot/4.7.0)의 tarball SHA-512 무결성을 확인했습니다.
- 파일 대응: npm 배포본의 `package/dist/index.js`가 이 저장소에서는 `scripts/modern-screenshot.umd.js`라는 이름입니다. LF 정규화 후 내용이 일치합니다.
- 번들 SHA-256: `bb36665889124a0b6e15f16045265737449c3bdcf2712cdb08af3cfa01563e2b`.
- npm에 포함된 LICENSE와 [v4.7.0 커밋의 LICENSE](https://github.com/qq15725/modern-screenshot/blob/792d6db7411839c62940a6e930161f8e376e817f/LICENSE)가 일치합니다. 로컬 고지는 이 원문을 보존합니다.

이번 작업에서 패키지를 설치하거나 번들을 실행하지 않았습니다. 파일명 대응 확인은 번들의 안전성을 보증하지 않습니다.

## 4. Platform Design Skills 파생 문서

Impeccable의 원본 NOTICE는 iOS·Android 참고 문서가 [ehmo/platform-design-skills](https://github.com/ehmo/platform-design-skills)의 내용을 추려 Impeccable의 표현으로 다시 작성한 것임을 밝힙니다. 원 작성자 표기는 **ehmo**, 원 라이선스는 **MIT**입니다. NOTICE의 `skill/reference/` 경로는 이 저장소에서 `.agents/skills/impeccable/reference/`에 대응합니다.

보존한 MIT 원문은 [커밋 dc2be825d8b439caea78e9eaa8fb3ac23b0ff3e9](https://github.com/ehmo/platform-design-skills/blob/dc2be825d8b439caea78e9eaa8fb3ac23b0ff3e9/LICENSE)에서 확인했습니다. Impeccable NOTICE에 파생 문서의 정확한 원본 베이스 커밋은 명시돼 있지 않으므로, 이 SHA를 그 베이스라고 단정하지 않습니다.

MIT 원문의 `Copyright (c) 2026` 표기를 그대로 보존했습니다. 저작권자 이름을 원문에 임의로 추가하지 않았으며, 작성자 출처는 위 설명과 원본 NOTICE로 연결합니다.

## 5. 유지보수·재배포 시 확인할 것

1. 외부 파일을 복사하거나 배포할 때 해당 LICENSE와 NOTICE도 함께 제공합니다. 하위 폴더만 따로 전달할 때도 이 고지가 빠지지 않도록 합니다.
2. 외부 파일을 수정하면 해당 파일에 수정 사실을 명시하고, 이 문서에 수정 범위·출처를 갱신합니다. 원저작권·귀속 고지는 지우지 않습니다.
3. 버전 교체 시 표시 버전만 믿지 않고 스냅샷·파일 대응·새 제3자 고지까지 다시 확인합니다.
4. 원문 검증 해시와 보완 결과는 [상세 계획·검증 기록](docs/superpowers/plans/2026-09-28-third-party-license-notices.md)에 있습니다.

라이선스 고지 보완은 도구의 보안 결함 해결이나 실행 승인과 별개입니다. 기존 Impeccable live 도구 실행 보류와 [공개 전 남은 보안·개인정보 조건](docs/security/2026-09-28-public-exposure-audit.ko.md)은 그대로 유지합니다.
