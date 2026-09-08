/**
 * 터미널과 CI에 출력할 코드·메시지를 담는 보안 검사 오류다. 안전한 문구만 전달해야 한다.
 */
export class SecurityGateError extends Error {
  /**
   * 안정적인 오류 코드를 가진 객체를 만든다. 전달받은 문구를 자동으로 정화하지는 않는다.
   * @param {string} code 프로그램이 실패 종류를 구분할 고정 식별자.
   * @param {string} message 호출자가 이미 비밀값을 제거한 공개 가능한 설명.
   */
  constructor(code, message) {
    super(message);
    this.name = "SecurityGateError";
    this.code = code;
  }
}
