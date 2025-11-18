/**
 * @file filter-hidden.ts
 * @description
 * LangChain 메시지 배열에서 숨김 처리된 메시지를 필터링하는 유틸리티 함수를 제공합니다.
 * 내부 시스템 메시지나 디버깅용 메시지를 사용자에게 노출하지 않기 위해 사용됩니다.
 */

import { BaseMessage } from "@langchain/core/messages";

/**
 * 숨김 처리된 메시지를 필터링합니다.
 *
 * @description
 * 메시지 배열에서 `additional_kwargs.hidden` 속성이 true인 메시지를 제거합니다.
 * 주로 사용자 UI에 표시할 메시지 목록을 정제할 때 사용됩니다.
 *
 * 숨김 메시지의 예:
 * - 내부 시스템 프롬프트
 * - 디버깅용 중간 메시지
 * - 백엔드 전용 컨텍스트
 *
 * @param messages - 필터링할 메시지 배열
 * @returns 숨김 처리되지 않은 메시지 배열
 *
 * @example
 * const visibleMessages = filterHiddenMessages(allMessages);
 * // UI에 표시할 메시지만 남김
 */
export function filterHiddenMessages(messages: BaseMessage[]): BaseMessage[] {
  return messages.filter((message) => !message.additional_kwargs?.hidden);
}
