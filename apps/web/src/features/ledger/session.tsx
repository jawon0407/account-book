"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { currentUserQueryOptions, signOutMutationOptions } from "../../queries/auth.js";
import { isSessionError, purgePrivateClient } from "./session-cache.js";
import { usePrivateClient } from "./private-client.js";
import { createLedgerApi, type LedgerApi } from "./api.js";
import { Loading } from "./feedback.js";
import { LedgerShell } from "./shell.js";
import styles from "./ledger.module.css";

const UserContext = createContext<{ userId: string; api: LedgerApi } | null>(null);

/** 현재 인증 경계 안에서만 사용자 ID를 제공한다. 권한 검증은 서버에서 다시 수행한다. */
export function useLedgerUser(): string {
  const session = useContext(UserContext);
  if (!session) throw new Error("LEDGER_SESSION_REQUIRED");
  return session.userId;
}

/** 현재 화면의 사용자에게 묶인 요청만 만든다. 이 ID 자체는 서버 인증 수단이 아니다. */
export function useLedgerApi(): LedgerApi {
  const session = useContext(UserContext);
  if (!session) throw new Error("LEDGER_SESSION_REQUIRED");
  return session.api;
}

/** @param children 로그인 후 화면. 인증 확인 전/실패 후에는 금융 UI를 렌더링하지 않는다. */
export function LedgerSession({ children }: Readonly<{ children: ReactNode }>) {
  const user = useQuery({ ...currentUserQueryOptions(), gcTime: 0, refetchOnMount: "always", refetchOnWindowFocus: "always" });
  useEffect(() => {
    const recheck = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", recheck);
    return () => window.removeEventListener("pageshow", recheck);
  }, []);
  if (user.isPending || user.isFetching) return <div className={styles.gate}><Loading label="로그인 상태를 확인하는 중…" /></div>;
  if (user.isError || !user.data) return <SessionGate message={isSessionError(user.error) ? "로그인이 필요해요" : "로그인 상태를 확인하지 못했어요"} retry={() => { void user.refetch(); }} />;
  return <PrivateWorkspace key={user.data.id} userId={user.data.id}>{children}</PrivateWorkspace>;
}

/** @param userId 현재 사용자. 계정이 바뀌면 key로 새 QueryClient를 만들고 이전 캐시를 제거한다. */
function PrivateWorkspace({ userId, children }: Readonly<{ userId: string; children: ReactNode }>) {
  const [session] = useState(() => ({ userId, api: createLedgerApi(undefined, userId) }));
  const [blocked, setBlocked] = useState<"expired" | "pending" | "done" | "failed" | null>(null);
  const client = usePrivateClient(() => setBlocked("expired"));
  const signOut = useMutation(signOutMutationOptions());
  useEffect(() => { if (blocked) void purgePrivateClient(client); }, [blocked, client]);

  /** 먼저 화면을 잠그고 캐시를 지운다. 서버 로그아웃 실패를 성공으로 표시하지 않는다. */
  async function logout() {
    setBlocked("pending");
    await purgePrivateClient(client);
    try { await signOut.mutateAsync(); setBlocked("done"); }
    catch { setBlocked("failed"); }
  }
  if (blocked) return <SessionGate pending={blocked === "pending"} message={blocked === "done" ? "로그아웃했어요" : blocked === "pending" ? "로그아웃 중…" : blocked === "failed" ? "이 화면은 잠겼지만 서버 로그아웃을 확인하지 못했어요" : "세션을 다시 확인해 주세요"} retry={blocked === "failed" ? () => { void logout(); } : undefined} />;
  return <UserContext.Provider value={session}><QueryClientProvider client={client}><LedgerShell onLogout={() => { void logout(); }}>{children}</LedgerShell></QueryClientProvider></UserContext.Provider>;
}

/** @param message 공개 상태 안내. @param retry 재시도. @param pending 로그아웃 응답 전에 이동을 제안하지 않는다. */
function SessionGate({ message, retry, pending = false }: Readonly<{ message: string; retry?: (() => void) | undefined; pending?: boolean }>) {
  return <main className={styles.gate}><section><h1>{message}</h1><p>{pending ? "서버에서 세션을 종료하고 있어요. 잠시 기다려 주세요." : "안전한 장부 이용을 위해 로그인 상태를 확인해 주세요."}</p>{!pending && <div className={styles.actions}>{retry && <button className={styles.button} onClick={retry}>다시 시도</button>}<a className={styles.primary} href="/login">로그인하기</a></div>}</section></main>;
}
