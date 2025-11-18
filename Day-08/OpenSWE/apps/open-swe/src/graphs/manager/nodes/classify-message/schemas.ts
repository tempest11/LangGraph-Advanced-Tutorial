/**
 * @file 메시지 분류 Zod 스키마 정의
 * @description
 * LLM이 메시지를 분류할 때 반환해야 하는 구조화된 응답 형식을 정의합니다.
 *
 * 주요 개념:
 * - Zod 스키마는 LLM의 도구 호출 응답 구조를 정의합니다
 * - BASE_CLASSIFICATION_SCHEMA는 기본 필드(추론, 응답, 라우트)를 포함
 * - createClassificationSchema는 현재 상태에 맞는 동적 라우트 옵션을 생성
 *
 * LLM 응답 예시:
 * {
 *   internal_reasoning: "사용자가 새로운 기능을 요청했으므로 Planner를 시작해야 함",
 *   response: "새로운 기능 요청을 확인했습니다. 작업 계획을 수립하겠습니다.",
 *   route: "start_planner"
 * }
 */

// Zod 스키마 검증 라이브러리
// LLM 응답 구조를 타입 안전하게 정의하고 검증
import { z } from "zod";

/**
 * 메시지 분류를 위한 기본 Zod 스키마
 *
 * @description
 * LLM이 메시지 분류 시 반환해야 하는 기본 구조를 정의합니다.
 * 이 스키마는 세 가지 핵심 필드로 구성됩니다:
 *
 * 1. **internal_reasoning**: LLM의 내부 사고 과정 (디버깅/추적용)
 * 2. **response**: 사용자에게 표시할 응답 메시지
 * 3. **route**: 다음 단계로 라우팅할 경로
 *
 * @constant
 * @type {z.ZodObject}
 */
export const BASE_CLASSIFICATION_SCHEMA = z.object({
  /**
   * 내부 추론 필드
   *
   * LLM이 특정 라우트를 선택한 이유를 설명하는 내부 추론입니다.
   * 이 내용은 사용자에게 표시되지 않으며, 다음 용도로 사용됩니다:
   * - 디버깅: 왜 특정 라우트가 선택되었는지 추적
   * - 로깅: 결정 과정 기록
   * - 개선: LLM 프롬프트 튜닝 시 참고
   *
   * 예시:
   * - "사용자가 버그 수정을 요청했고, Planner가 이미 실행 중이므로 update_planner로 라우팅"
   * - "단순 인사 메시지이므로 no_op 처리"
   */
  internal_reasoning: z
    .string()
    .describe(
      "선택한 경로 결정의 근거가 되는 추론입니다. 이는 내부용이며 사용자에게 표시되지 않으므로 기술적인 추론을 포함할 수 있습니다. 이 경로를 선택하게 된 모든 추론과 컨텍스트를 포함하십시오.",
    ),

  /**
   * 사용자 응답 필드
   *
   * 사용자에게 직접 표시할 메시지입니다.
   * 명확하고 친절한 언어로 작성되어야 하며, 다음을 포함해야 합니다:
   * - 메시지 수신 확인
   * - 다음에 수행할 작업 설명
   * - 필요 시 추가 정보 요청
   *
   * 예시:
   * - "버그 수정 요청을 확인했습니다. 실행 중인 계획에 추가하겠습니다."
   * - "새로운 기능 요청입니다. 작업 계획을 수립하고 있습니다."
   */
  response: z
    .string()
    .describe(
      "사용자에게 보낼 응답입니다. 명확하고 간결해야 하며, 사용자가 새 메시지를 처리하는 방법/이유에 대해 알아야 할 추가 컨텍스트를 포함해야 합니다.",
    ),

  /**
   * 라우팅 경로 필드
   *
   * 메시지 처리를 위해 선택할 다음 단계입니다.
   * 기본 스키마에서는 "no_op"만 정의되며,
   * createClassificationSchema 함수를 통해 동적으로 확장됩니다.
   *
   * 가능한 라우트 예시:
   * - no_op: 아무 작업도 하지 않음 (단순 응답만)
   * - start_planner: 새 Planner 시작
   * - update_planner: 실행 중인 Planner 업데이트
   * - create_new_issue: 새 세션 생성
   */
  route: z
    .enum(["no_op"])
    .describe("사용자의 새 메시지를 처리하기 위해 취할 경로입니다."),
});

/**
 * 동적 라우팅 옵션으로 분류 스키마를 생성하는 함수
 *
 * @description
 * 현재 시스템 상태(Planner/Programmer 실행 여부 등)에 따라
 * 가능한 라우트 옵션이 달라지므로, 동적으로 스키마를 생성합니다.
 *
 * 작동 방식:
 * 1. BASE_CLASSIFICATION_SCHEMA를 복사
 * 2. route 필드를 전달받은 enumOptions로 확장
 * 3. 새로운 스키마 반환
 *
 * 사용 예시:
 * ```typescript
 * // Planner가 실행 중일 때
 * const schema = createClassificationSchema([
 *   "no_op",
 *   "update_planner",
 *   "start_planner_for_followup"
 * ]);
 *
 * // Planner가 실행 중이지 않을 때
 * const schema = createClassificationSchema([
 *   "no_op",
 *   "start_planner",
 *   "create_new_issue"
 * ]);
 * ```
 *
 * @param {[string, ...string[]]} enumOptions - 라우팅 경로에 사용할 열거형 옵션 배열
 *   - 첫 번째 요소는 필수 (Zod enum 요구사항)
 *   - 나머지는 선택적 옵션들
 *   - 예: ["no_op", "start_planner", "update_planner"]
 *
 * @returns {z.ZodObject} 확장된 Zod 스키마 객체
 *   - BASE_CLASSIFICATION_SCHEMA의 모든 필드 포함
 *   - route 필드가 전달받은 옵션들로 확장됨
 *
 * @example
 * // 반환된 스키마는 LLM의 도구 호출 응답 검증에 사용됨
 * const response = await llm.invoke(messages);
 * const validated = schema.parse(response.tool_calls[0].args);
 */
export function createClassificationSchema(enumOptions: [string, ...string[]]) {
  // BASE_CLASSIFICATION_SCHEMA를 확장하여 새 스키마 생성
  const schema = BASE_CLASSIFICATION_SCHEMA.extend({
    // route 필드를 전달받은 열거형 옵션으로 교체
    route: z
      .enum(enumOptions)  // 가능한 라우트 옵션 정의
      .describe("사용자의 새 메시지를 처리하기 위해 취할 경로입니다."),
  });

  return schema;
}
