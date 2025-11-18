/**
 * @file 샌드박스 에러 필드 추출 유틸리티
 * @description
 * 샌드박스 명령 실행 에러를 안전하게 파싱하여 ExecuteResponse 타입으로 변환합니다.
 * 타입 가드를 통해 런타임 타입 안전성을 보장합니다.
 *
 * 주요 기능:
 * 1. unknown 타입 에러 객체 검증
 * 2. ExecuteResponse 구조 확인 (result, exitCode)
 * 3. 타입 안전한 변환 또는 undefined 반환
 *
 * 사용 위치:
 * - take-action.ts: 도구 실행 에러 처리
 * - shell-executor.ts: 셸 명령 실패 분석
 *
 * @example
 * const errorFields = getSandboxErrorFields(error);
 * if (errorFields) {
 *   console.log(errorFields.result, errorFields.exitCode);
 * }
 */

// === Daytona SDK 타입 ===
import { ExecuteResponse } from "@daytonaio/sdk/src/types/ExecuteResponse.js";

/**
 * 샌드박스 실행 에러에서 ExecuteResponse 필드를 안전하게 추출합니다.
 *
 * @description
 * unknown 타입의 에러 객체를 검증하여 ExecuteResponse 타입으로 변환합니다.
 * 런타임 타입 검사를 통해 필수 필드(result, exitCode)의 존재와 타입을 확인합니다.
 *
 * 검증 조건:
 * 1. error가 객체인지 확인
 * 2. "result" 속성 존재 및 string 타입 확인
 * 3. "exitCode" 속성 존재 및 number 타입 확인
 * 4. 모든 조건 통과 시 ExecuteResponse로 캐스팅
 *
 * 사용 시나리오:
 * - 샌드박스 명령 실행 실패 시 에러 정보 추출
 * - 실패 원인 분석 (종료 코드, 에러 메시지)
 * - 재시도 여부 결정 (특정 종료 코드 기반)
 *
 * @param {unknown} error - 검증할 에러 객체 (타입 불명)
 * @returns {ExecuteResponse | undefined} 검증된 ExecuteResponse 또는 undefined
 *
 * @example
 * try {
 *   await sandbox.execute("invalid-command");
 * } catch (error) {
 *   const execResponse = getSandboxErrorFields(error);
 *   if (execResponse) {
 *     console.log(`Exit code: ${execResponse.exitCode}`);
 *     console.log(`Error: ${execResponse.result}`);
 *   }
 * }
 */
export function getSandboxErrorFields(
  error: unknown,
): ExecuteResponse | undefined {
  if (
    !error ||
    typeof error !== "object" ||
    !("result" in error) ||
    !error.result ||
    typeof error.result !== "string" ||
    !("exitCode" in error) ||
    typeof error.exitCode !== "number"
  ) {
    return undefined;
  }

  return error as ExecuteResponse;
}
