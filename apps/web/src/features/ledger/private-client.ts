import { useEffect, useRef, useState } from "react";
import { createPrivateClient, purgePrivateClient } from "./session-cache.js";

/** @param onExpired 인증 오류 콜백. 한 사용자 화면의 메모리 캐시 수명만 관리한다. */
export function usePrivateClient(onExpired: () => void) {
  const [client] = useState(() => createPrivateClient(onExpired));
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    // StrictMode의 같은 인스턴스 재마운트는 보존한다. 실제 이탈일 때만 늦은 응답을 취소/제거한다.
    return () => { queueMicrotask(() => { if (generation.current === current) void purgePrivateClient(client); }); };
  }, [client]);
  return client;
}
