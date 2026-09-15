import "server-only";

import { AuthProviderError } from "../auth-provider-port.js";

export const AUTH_PROVIDER_DEADLINE_MS = 5_000;

export type ProviderDeadline = Readonly<{
  /** 실제 제공자 전송에만 주입하는 내부 취소 신호입니다. */
  signal: AbortSignal;
  /** @returns 활성 상태이면 값 없이 종료합니다. @throws 만료·실패·종료 뒤에는 고정 AuthProviderError. */
  assertActive(): void;
  /** @returns 값 없이 종료하며 내부 신호와 모든 대기자를 한 번만 취소합니다. */
  fail(): void;
  /**
   * @param work 현재 작업 예산 안에서 시작할 비동기 작업.
   * @returns 작업 결과 또는 시간 제한 실패.
   */
  wait<T>(work: () => Promise<T>): Promise<T>;
  /** @returns 값 없이 종료하며 소유한 타이머와 내부 신호만 정리합니다. */
  close(): void;
}>;

/**
 * 제공자 작업에 적용할 독립적인 단조 시계 기반 시간 제한을 만듭니다.
 * @returns 대기 작업, 전송 취소 신호, 종료 정리를 함께 소유하는 작업 경계.
 * @throws 대기 중 만료되거나 실패 처리되면 고정된 AuthProviderError를 던집니다.
 * 취소 책임: 만료와 실패는 내부 신호를 중단하고, close는 소유한 타이머와 내부 신호만 정리합니다.
 */
export function createProviderDeadline(): ProviderDeadline {
  const controller = new AbortController();
  const expiresAt = performance.now() + AUTH_PROVIDER_DEADLINE_MS;
  let active = true;
  let rejectStopped!: (error: AuthProviderError) => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStopped = reject;
  });
  void stopped.catch(() => undefined);

  /**
   * 활성 작업을 한 번만 실패 상태로 바꾸고 모든 대기자를 깨웁니다.
   * @returns 값 없이 종료하며 내부 타이머와 신호를 정리합니다.
   */
  const fail = (): void => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    controller.abort();
    rejectStopped(new AuthProviderError());
  };
  const timer = setTimeout(fail, AUTH_PROVIDER_DEADLINE_MS);

  /**
   * 지연된 타이머 콜백을 보완하도록 단조 시각을 다시 확인합니다.
   * @returns 활성 상태이면 값 없이 종료합니다.
   * @throws 만료되었거나 이미 종료된 작업이면 고정 AuthProviderError.
   */
  const assertActive = (): void => {
    if (active && performance.now() >= expiresAt) fail();
    if (!active) throw new AuthProviderError();
  };

  return {
    signal: controller.signal,
    assertActive,
    fail,
    wait: <T>(work: () => Promise<T>): Promise<T> => Promise.race([
      Promise.resolve().then(() => {
        assertActive();
        return work();
      }),
      stopped,
    ]),
    close: (): void => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    },
  };
}
