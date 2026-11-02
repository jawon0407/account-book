/** 필드별 안내를 위한 고정 오류. 입력한 금융 내용이나 라이브러리 원시 예외를 담지 않는다. */
export class ManualInputError extends Error {
  /** @param field 사용자가 정정할 입력. @param code 화면에서 한국어 안내로 바꿀 고정 코드. */
  public constructor(
    public readonly field: string,
    public readonly code: string,
  ) {
    super(code);
  }
}
