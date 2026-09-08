"use client";

import type { AuthProvider } from "@account-book/contracts";
import { useState } from "react";
import { AuthStatus } from "./auth-status.js";

const PROVIDERS = [
  { value: "google", label: "Google" },
  { value: "kakao", label: "Kakao" },
  { value: "naver", label: "Naver" },
] as const satisfies readonly Readonly<{ value: AuthProvider; label: string }>[];

type ProviderButtonsProps = Readonly<{
  start(provider: AuthProvider): Promise<Readonly<{ authorizationPath: string }>>;
  navigate?(path: string): void;
}>;

/**
 * OAuth 계속 경로로 브라우저 문서 전체를 이동한다.
 * @param path - begin에서 고정 형식과 일치하는지 확인한 same-origin BFF 경로다.
 * @returns 반환값 없음. window.location.assign이 페이지 이동을 시작한다.
 */
function navigateDocument(path: string): void {
  window.location.assign(path);
}

/**
 * Google/Kakao/Naver 로그인 버튼과 진행·실패 상태를 보여 준다.
 * 공급자 URL 대신 검증된 같은 출처 BFF 계속 경로만 받아 이동한다.
 * @param props - start(provider)는 시작 요청 Promise, navigate(path)는 이동 함수(기본값: 문서 이동)다.
 * @returns 공급자 버튼 UI. 클릭 시 시작 요청과 페이지 이동이 발생하며 실패는 고정 문구로 표시한다.
 */
export function ProviderButtons({ start, navigate = navigateDocument }: ProviderButtonsProps) {
  const [pending, setPending] = useState<AuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * 한 공급자의 로그인 시작 요청을 실행하고 정확히 일치하는 계속 경로로 이동한다.
   * 진행 중 재클릭은 무시하며 요청·경로 검증·이동 오류는 화면 상태로 처리한다.
   * @param provider - google/kakao/naver 중 선택된 공급자 식별자다.
   * @param label - 오류 안내에 사용할 Google/Kakao/Naver 표시 이름이다.
   * @returns 처리 완료 Promise. 실패하면 pending을 해제하고 오류 문구를 설정한다.
   */
  async function begin(provider: AuthProvider, label: string): Promise<void> {
    if (pending !== null) return;
    setPending(provider);
    setError(null);
    try {
      const result = await start(provider);
      const expected = `/api/auth/oauth/${provider}/continue?returnPath=%2Fapp`;
      if (result.authorizationPath !== expected) throw new Error("AUTH_CLIENT_PATH_INVALID");
      navigate(result.authorizationPath);
    } catch {
      setPending(null);
      setError(`${label} 로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.`);
    }
  }

  return (
    <div className="provider-section">
      <div className="auth-divider"><span>또는</span></div>
      <div className="provider-buttons" aria-label="간편 로그인">
        {PROVIDERS.map((provider) => {
          const isPending = pending === provider.value;
          return (
            <button
              className="provider-button"
              disabled={pending !== null}
              key={provider.value}
              onClick={() => void begin(provider.value, provider.label)}
              type="button"
            >
              <span className={`provider-mark provider-mark-${provider.value}`} aria-hidden="true">{provider.label.slice(0, 1)}</span>
              <span>{isPending ? `${provider.label}로 이동 중` : `${provider.label}로 계속`}</span>
              {isPending ? <span className="pending-indicator" aria-hidden="true">…</span> : null}
            </button>
          );
        })}
      </div>
      {pending === null ? null : <AuthStatus kind="pending">{PROVIDERS.find(({ value }) => value === pending)?.label} 인증 화면으로 이동하고 있어요.</AuthStatus>}
      {error === null ? null : <AuthStatus kind="error">{error}</AuthStatus>}
    </div>
  );
}
