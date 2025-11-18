/**
 * @file Scratchpad 도구
 * @description
 * LLM이 임시 메모나 노트를 작성하는 데 사용하는 도구입니다.
 *
 * 주요 사용 사례:
 * - Planner: 컨텍스트 수집 중 중요 정보 기록
 * - Reviewer: 리뷰 중 발견한 이슈 기록
 * - Programmer: 작업 중 메모 기록
 *
 * 특징:
 * - 상태 변경 없음: 단순히 메시지로 기록되며 그래프 상태를 변경하지 않음
 * - 나중에 참조: 기록된 노트는 나중에 최종 결정에 활용됨
 * - LangGraph 메시지 히스토리에 기록됨
 */

// === LangChain Core ===
import { tool } from "@langchain/core/tools"; // 도구 생성 헬퍼

// === 도구 필드 정의 ===
import { createScratchpadFields } from "@openswe/shared/open-swe/tools"; // Scratchpad 도구 스키마

/**
 * Scratchpad 도구를 생성합니다.
 *
 * @description
 * LLM이 작업 중 중요한 정보를 기록하기 위한 도구를 생성합니다.
 * 이 도구는 실제로 상태를 변경하지 않고, 메시지 히스토리에만 기록됩니다.
 *
 * 사용 예시:
 * - Planner: "코드베이스는 TypeScript를 사용하며 Jest로 테스트합니다"
 * - Reviewer: "테스트 파일이 누락되었습니다. yarn test 실행 필요"
 * - Programmer: "인증 모듈은 src/auth/index.ts에 위치합니다"
 *
 * 기록된 노트 활용:
 * - Planner: 최종 계획 생성 시 참조
 * - Reviewer: 최종 리뷰 판단 시 참조
 * - Programmer: 다음 액션 결정 시 참조
 *
 * TODO:
 * - LangGraph에 상태 저장 기능이 추가되면 그래프 상태에 직접 기록 가능
 *
 * @param {string} whenMessage - 스크래치패드에 작성할 시점에 대한 설명 메시지
 *   - Planner: "컨텍스트 수집 중"
 *   - Reviewer: "리뷰 중"
 *   - Programmer: "작업 중"
 *
 * @returns {Tool} 생성된 scratchpad 도구
 *   - 항상 성공 응답 반환
 *   - 상태 변경 없음
 *
 * @example
 * // Planner에서 사용
 * const tool = createScratchpadTool("컨텍스트 수집 중");
 * await tool.invoke({ scratchpad: "코드베이스는 React + TypeScript를 사용합니다" });
 *
 * @example
 * // Reviewer에서 사용
 * const tool = createScratchpadTool("리뷰 중");
 * await tool.invoke({ scratchpad: "테스트 파일이 누락되었습니다" });
 */
export function createScratchpadTool(whenMessage: string) {
  const scratchpadTool = tool(
    async (
      _input,
    ): Promise<{ result: string; status: "success" | "error" }> => {
      // TODO: LangGraph에 상태 저장 기능이 출시되면 저장된 상태에 기록해야 합니다.
      return {
        result: "스크래치패드에 성공적으로 작성했습니다. 감사합니다!",
        status: "success",
      };
    },
    createScratchpadFields(whenMessage),
  );

  return scratchpadTool;
}
