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
  intent?: "sign_in" | "sign_up";
  enabledProviders?: readonly AuthProvider[];
  availability?: "loading" | "ready" | "unavailable";
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
 * @param props - start(provider)는 시작 요청, navigate(path)는 이동 함수다. enabledProviders는 서버 허용 목록이며 availability가 ready일 때만 클릭할 수 있다.
 * @returns 공급자 버튼 UI. 클릭 시 시작 요청과 페이지 이동이 발생하며 실패는 고정 문구로 표시한다.
 */
export function ProviderButtons({ start, navigate = navigateDocument, enabledProviders = [], availability = "ready", intent }: ProviderButtonsProps) {
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
    if (pending !== null || availability !== "ready" || !enabledProviders.includes(provider)) return;
    setPending(provider);
    setError(null);
    try {
      const result = await start(provider);
      const expected = `/api/auth/oauth/${provider}/continue?returnPath=%2Fapp${intent === undefined ? "" : `&intent=${intent}`}`;
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
          const enabled = availability === "ready" && enabledProviders.includes(provider.value);
          return (
            <button
              className="provider-button"
              disabled={pending !== null || !enabled}
              key={provider.value}
              onClick={() => void begin(provider.value, provider.label)}
              type="button"
            >
              <span className={`provider-mark provider-mark-${provider.value}`} aria-hidden="true">{provider.label.slice(0, 1)}</span>
              <span>{isPending ? `${provider.label}로 이동 중` : enabled ? `${provider.label}로 계속` : `${provider.label} 준비 중`}</span>
              {isPending ? <span className="pending-indicator" aria-hidden="true">…</span> : null}
            </button>
          );
        })}
      </div>
      {availability === "loading" ? <AuthStatus kind="pending">소셜 로그인 사용 가능 여부를 확인하고 있어요.</AuthStatus> : null}
      {availability === "unavailable" ? <AuthStatus kind="error">소셜 로그인 상태를 확인하지 못했어요. 이메일 로그인을 이용하거나 새로고침해 주세요.</AuthStatus> : null}
      {availability === "ready" && enabledProviders.length < PROVIDERS.length ? <p className="field-help">준비 중인 소셜 로그인은 아직 사용할 수 없어요. 이메일로 시작할 수 있어요.</p> : null}
      {pending === null ? null : <AuthStatus kind="pending">{PROVIDERS.find(({ value }) => value === pending)?.label} 인증 화면으로 이동하고 있어요.</AuthStatus>}
      {error === null ? null : <AuthStatus kind="error">{error}</AuthStatus>}
    </div>
  );
}
