import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { bankUnavailable } from "./bank-error.js";
import type { BankServiceOptions } from "./bank-provider.js";

/** @param value 서버 설정의 고정 URL. @returns HTTPS이며 인증정보·query·fragment 없는 URL. */
export function fixedUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    return url;
  } catch { throw bankUnavailable(); }
}
/** @param options 서버 전용 설정. @returns 8초 이하 교환 제한. live 환경은 거부한다. */
export function validateOptions(options: BankServiceOptions): number {
  const ms = options.timeoutMs ?? 8000;
  fixedUrl(options.authorizationEndpoint); fixedUrl(options.webResultUrl);
  if (!["fake", "test"].includes(options.provider.environment) || options.callbackHmacKey.length !== 32
    || !Number.isInteger(ms) || ms <= 0 || ms > 8000) throw bankUnavailable();
  return ms;
}
/** @param address socket 접속 IP(forward header 불가). @param key 전용 32바이트 키. @returns IP 원문을 저장하지 않는 HMAC. */
export function callbackAddressDigest(address: string, key: Uint8Array): Buffer {
  const version = isIP(address);
  if (!version) throw bankUnavailable();
  let normalized = version === 6 ? new URL(`http://[${address}]/`).hostname.slice(1, -1) : address;
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/u.exec(normalized);
  if (mapped) {
    const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16);
    normalized = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return createHmac("sha256", key).update(`bank-callback-ip:v1:${normalized}`).digest();
}
/** @param operation 취소 신호를 받는 외부 교환. @param timeoutMs 상한. @returns 기한 내 결과만. 늦은 성공은 저장하지 않는다. */
export async function boundedExchange(operation: (signal: AbortSignal) => Promise<unknown>, timeoutMs: number): Promise<unknown> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { abort.abort(); reject(bankUnavailable()); }, timeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(() => operation(abort.signal)), timeout]); }
  finally { if (timer) clearTimeout(timer); }
}
