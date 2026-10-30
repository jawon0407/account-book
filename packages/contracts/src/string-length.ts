import { z } from "zod";

/**
 * 기존 JS/HTML 입력 길이 계약을 유지하는 문자열 검사기를 만든다.
 * Zod의 Unicode 코드 포인트 기준 대신 string.length(UTF-16 단위)를 사용한다.
 * @param minimum 허용할 최소 길이(포함). trim이 필요한 필드는 check 전에 적용한다.
 * @param maximum 허용할 최대 길이(포함). 비밀번호는 trim/정규화하지 않는다.
 * @returns Zod string의 check에 전달할 검사. 값은 변경하지 않고 표준 길이 오류만 추가한다.
 */
export function utf16Length(minimum: number, maximum: number) {
  return z.superRefine<string>((value, context) => {
    if (value.length < minimum) {
      context.addIssue({ code: "too_small", origin: "string", minimum, inclusive: true });
    }
    if (value.length > maximum) {
      context.addIssue({ code: "too_big", origin: "string", maximum, inclusive: true });
    }
  });
}
