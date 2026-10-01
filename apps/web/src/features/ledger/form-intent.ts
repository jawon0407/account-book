/**
 * 하나의 열린 생성 폼에서 같은 정규화 입력의 재시도를 같은 UUID로 묶는다.
 * @returns keyFor(payload)는 입력이 달라질 때만 새 키를 만든다. 탭/기기에 영구 저장하지 않는다.
 */
export function createIntent() {
  let previous: string | undefined;
  let key: string;
  return {
    keyFor(payload: Readonly<Record<string, string | number>>): string {
      const fingerprint = JSON.stringify(payload);
      if (fingerprint !== previous) {
        key = crypto.randomUUID();
        previous = fingerprint;
      }
      return key;
    },
  };
}
