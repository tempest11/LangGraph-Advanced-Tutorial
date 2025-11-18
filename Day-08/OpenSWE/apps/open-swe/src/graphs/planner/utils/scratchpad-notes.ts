/**
 * @file Planner의 스크래치패드 노트 추출 유틸리티
 * @description
 * AI 에이전트가 생성한 메시지들에서 스크래치패드 도구 호출을 찾아
 * 기록된 노트들을 추출하는 유틸리티 함수를 제공합니다.
 *
 * 주요 기능:
 * - AI 메시지 필터링 (HumanMessage, SystemMessage 제외)
 * - 스크래치패드 도구 호출 탐지
 * - 노트 내용 추출 및 배열로 반환
 *
 * 사용 목적:
 * Planner 그래프에서 AI가 작성한 기술 노트들을 수집하여
 * 컨텍스트 압축 및 히스토리 관리에 활용합니다.
 */

// LangChain 메시지 타입
import { BaseMessage, isAIMessage } from "@langchain/core/messages"; // 메시지 기본 타입 및 AI 메시지 타입 가드
import { createScratchpadFields } from "@openswe/shared/open-swe/tools"; // 스크래치패드 도구 필드 생성 함수
import z from "zod"; // 타입 추론용 Zod 라이브러리

/**
 * 메시지 목록에서 스크래치패드 노트를 추출합니다
 *
 * @description
 * AI 메시지들을 순회하면서 스크래치패드 도구 호출을 찾고,
 * 각 호출의 `scratchpad` 필드에 기록된 노트들을 수집합니다.
 *
 * 처리 흐름:
 * 1. AI 메시지만 필터링 (isAIMessage 타입 가드 사용)
 * 2. 각 메시지의 tool_calls에서 스크래치패드 도구 찾기
 * 3. 스크래치패드 인자에서 노트 내용 추출
 * 4. 모든 노트를 평탄화하여 배열로 반환
 *
 * @param {BaseMessage[]} messages - LangChain 메시지 배열 (AI, Human, System 등 혼재)
 * @returns {string[]} 추출된 스크래치패드 노트 배열 (순서 유지)
 *
 * @example
 * const messages = [
 *   new HumanMessage("작업을 시작해주세요"),
 *   new AIMessage({
 *     content: "...",
 *     tool_calls: [{
 *       name: "scratchpad",
 *       args: { scratchpad: "파일 구조를 분석했습니다" }
 *     }]
 *   }),
 * ];
 * const notes = getScratchpad(messages);
 * // => ["파일 구조를 분석했습니다"]
 */
export function getScratchpad(messages: BaseMessage[]): string[] {
  // === 1단계: 스크래치패드 도구 스키마 생성 ===
  // 빈 문자열로 초기화하여 도구 정의만 가져옴
  const scratchpadFields = createScratchpadFields("");

  // === 2단계: 메시지 순회 및 스크래치패드 추출 ===
  const scratchpad = messages.flatMap((m) => {
    // AI 메시지가 아니면 스킵 (HumanMessage, SystemMessage 등 제외)
    if (!isAIMessage(m)) {
      return [];
    }

    // 스크래치패드 도구 호출만 필터링
    const scratchpadToolCalls = m.tool_calls?.filter(
      (tc) => tc.name === scratchpadFields.name,
    );

    // 스크래치패드 도구 호출이 없으면 스킵
    if (!scratchpadToolCalls?.length) {
      return [];
    }

    // 각 도구 호출의 scratchpad 필드 추출
    return scratchpadToolCalls.map(
      (tc) => (tc.args as z.infer<typeof scratchpadFields.schema>).scratchpad,
    );
  });

  // === 3단계: 중첩 배열 평탄화 ===
  // flatMap으로 생성된 배열들을 하나의 1차원 배열로 병합
  return scratchpad.flat();
}
