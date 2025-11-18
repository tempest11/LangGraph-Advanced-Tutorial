/**
 * @file modify-array.ts
 * @description
 * LangChain 메시지 배열을 수정하는 유틸리티 함수들을 제공합니다.
 * 주로 메시지 히스토리에서 특정 사용자 메시지를 제거하는 데 사용됩니다.
 */

import { BaseMessage, isHumanMessage } from "@langchain/core/messages";

/**
 * 메시지 배열에서 첫 번째 Human 메시지를 제거합니다.
 *
 * @description
 * 메시지 배열을 순회하면서 처음 만나는 Human 메시지 하나만 제거합니다.
 * 초기 사용자 프롬프트를 제거하거나, 메시지 히스토리를 정리할 때 사용됩니다.
 *
 * @param messages - 원본 메시지 배열
 * @returns 첫 번째 Human 메시지가 제거된 새 배열
 *
 * @example
 * const messages = [
 *   HumanMessage({ content: "첫 질문" }),  // 이것이 제거됨
 *   AIMessage({ content: "답변" }),
 *   HumanMessage({ content: "두 번째 질문" })  // 유지됨
 * ];
 * const filtered = removeFirstHumanMessage(messages);
 */
export function removeFirstHumanMessage(
  messages: BaseMessage[],
): BaseMessage[] {
  let humanMsgFound = false;
  return messages.filter((m) => {
    if (isHumanMessage(m) && !humanMsgFound) {
      humanMsgFound = true;
      return false;
    }

    return true;
  });
}

/**
 * 메시지 배열에서 마지막 Human 메시지를 제거합니다.
 *
 * @description
 * 메시지 배열을 역순으로 탐색하여 마지막 Human 메시지를 찾아 제거합니다.
 * ID 기반으로 필터링하므로 동일한 메시지가 여러 번 나타나도 안전하게 제거됩니다.
 *
 * 사용 사례:
 * - 사용자의 마지막 입력을 취소할 때
 * - 대화 흐름을 되돌릴 때
 * - 잘못된 입력을 제거할 때
 *
 * @param messages - 원본 메시지 배열
 * @returns 마지막 Human 메시지가 제거된 새 배열 (Human 메시지가 없으면 원본 반환)
 *
 * @example
 * const messages = [
 *   HumanMessage({ content: "첫 질문" }),
 *   AIMessage({ content: "답변" }),
 *   HumanMessage({ content: "마지막 질문" })  // 이것이 제거됨
 * ];
 * const filtered = removeLastHumanMessage(messages);
 */
export function removeLastHumanMessage(messages: BaseMessage[]): BaseMessage[] {
  const lastHumanMessage = messages.findLast(isHumanMessage);
  if (!lastHumanMessage) {
    return messages;
  }
  return messages.filter((m) => m.id !== lastHumanMessage.id);
}
