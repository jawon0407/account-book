"use client";
import { useRef, useState } from "react";
import { ApiClientError } from "../../../lib/http/api-client.js";
import { errorMessage } from "../feedback.js";

/** @param onSaved 성공 응답 후 화면 갱신. @param onPending 부모 dialog 닫힘 제어. 수정·삭제의 중복 실행과 불확실 결과 재전송을 막는다. */
export function useTransactionChange(onSaved: () => void, onPending?: (value: boolean) => void) {
  const busy = useRef(false), blockedRef = useRef(false);
  const [pending, setPending] = useState(false), [blocked, setBlocked] = useState(false), [message, setMessage] = useState("");
  /** @param operation 버전이 고정된 한 변경. 알 수 없는 실패에서는 성공/실패를 단정하지 않고 재조회를 요구한다. */
  async function run(operation: () => Promise<unknown>) {
    if (busy.current || blockedRef.current) return;
    busy.current = true; setPending(true); onPending?.(true); setMessage("");
    try { await operation(); onSaved(); }
    catch (error) {
      const recoverable = error instanceof ApiClientError && ["LEDGER_VALIDATION_FAILED", "AUTH_CSRF_REJECTED", "AUTH_RATE_LIMITED"].includes(error.code);
      blockedRef.current = !recoverable; setBlocked(!recoverable);
      const known = error instanceof ApiClientError && !["LEDGER_SERVICE_UNAVAILABLE", "AUTH_PROVIDER_UNAVAILABLE"].includes(error.code);
      setMessage(known ? errorMessage(error) : "변경 결과를 확인하지 못했어요. 다시 전송하지 않고 닫은 뒤 최신 목록을 확인해 주세요.");
    } finally { busy.current = false; setPending(false); onPending?.(false); }
  }
  return { run, pending, blocked, message };
}
