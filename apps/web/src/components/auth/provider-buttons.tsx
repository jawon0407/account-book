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

function navigateDocument(path: string): void {
  window.location.assign(path);
}

/** Starts OAuth through the same-origin BFF and never receives a provider URL. */
export function ProviderButtons({ start, navigate = navigateDocument }: ProviderButtonsProps) {
  const [pending, setPending] = useState<AuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

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
              {isPending ? <span className="spinner" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      {pending === null ? null : <AuthStatus kind="pending">{PROVIDERS.find(({ value }) => value === pending)?.label} 인증 화면으로 이동하고 있어요.</AuthStatus>}
      {error === null ? null : <AuthStatus kind="error">{error}</AuthStatus>}
    </div>
  );
}
