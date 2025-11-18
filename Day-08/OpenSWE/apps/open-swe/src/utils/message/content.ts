/**
 * @file content.ts
 * @description
 * LangChain 메시지를 문자열로 변환하는 유틸리티 함수들을 제공합니다.
 * 각 메시지 타입(AI, Human, Tool, System)을 XML 형식의 문자열로 포맷팅하여
 * 로깅, 디버깅, UI 표시 등에 사용할 수 있도록 합니다.
 *
 * 주요 기능:
 * - 메시지 타입별 문자열 변환 (AI, Human, Tool, System)
 * - Tool Call 정보 포맷팅
 * - 빈 콘텐츠 메시지 필터링
 * - 숨김 메시지 필터링
 */

import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  isAIMessage,
  isHumanMessage,
  isSystemMessage,
  isToolMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { ToolCall } from "@langchain/core/messages/tool";
import { getMessageContentString } from "@openswe/shared/messages";

/**
 * Tool Call 배열을 JSON 문자열로 변환합니다.
 *
 * @description
 * AI 메시지에 포함된 도구 호출 정보를 보기 좋게 포맷팅합니다.
 * 각 Tool Call을 들여쓰기된 JSON 형식으로 변환하여 줄바꿈으로 연결합니다.
 *
 * @param toolCalls - 변환할 Tool Call 배열
 * @returns 포맷팅된 JSON 문자열 (Tool Call이 없으면 빈 문자열)
 *
 * @example
 * const calls = [{ name: "search", args: { query: "test" }, id: "call_1" }];
 * const str = getToolCallsString(calls);
 * // "{
 *   "name": "search",
 *   "args": { "query": "test" },
 *   "id": "call_1"
 * }"
 */
export function getToolCallsString(toolCalls: ToolCall[] | undefined): string {
  if (!toolCalls?.length) return "";
  return toolCalls.map((c) => JSON.stringify(c, null, 2)).join("\n");
}

/**
 * AI 메시지를 XML 형식 문자열로 변환합니다.
 *
 * @description
 * AI의 응답 메시지를 `<assistant>` 태그로 감싸고,
 * 메시지 내용과 Tool Call 정보를 포함합니다.
 *
 * @param message - 변환할 AI 메시지
 * @returns XML 형식의 문자열
 *
 * @example
 * const msg = new AIMessage({ content: "답변입니다", id: "msg_1" });
 * const str = getAIMessageString(msg);
 * // "<assistant message-id=msg_1>
 * // Content: 답변입니다
 * // Tool calls:
 * // </assistant>"
 */
export function getAIMessageString(message: AIMessage): string {
  const content = getMessageContentString(message.content);
  const toolCalls = getToolCallsString(message.tool_calls);
  return `<assistant message-id=${message.id ?? "No ID"}>\nContent: ${content}\nTool calls: ${toolCalls}\n</assistant>`;
}

/**
 * Human 메시지를 XML 형식 문자열로 변환합니다.
 *
 * @description
 * 사용자의 메시지를 `<human>` 태그로 감싸서 표현합니다.
 *
 * @param message - 변환할 Human 메시지
 * @returns XML 형식의 문자열
 *
 * @example
 * const msg = new HumanMessage({ content: "질문입니다", id: "msg_2" });
 * const str = getHumanMessageString(msg);
 * // "<human message-id=msg_2>
 * // Content: 질문입니다
 * // </human>"
 */
export function getHumanMessageString(message: HumanMessage): string {
  const content = getMessageContentString(message.content);
  return `<human message-id=${message.id ?? "No ID"}>\nContent: ${content}\n</human>`;
}

/**
 * Tool 메시지를 XML 형식 문자열로 변환합니다.
 *
 * @description
 * 도구 실행 결과 메시지를 `<tool>` 태그로 감싸고,
 * Tool Call ID, 이름, 실행 상태, 결과 내용을 포함합니다.
 *
 * @param message - 변환할 Tool 메시지
 * @returns XML 형식의 문자열
 *
 * @example
 * const msg = new ToolMessage({
 *   content: "검색 결과",
 *   tool_call_id: "call_1",
 *   name: "search",
 *   status: "success"
 * });
 * // "<tool message-id=... status=\"success\">
 * // Tool Call ID: call_1
 * // Tool Call Name: search
 * // Content: 검색 결과
 * // </tool>"
 */
export function getToolMessageString(message: ToolMessage): string {
  const content = getMessageContentString(message.content);
  const toolCallId = message.tool_call_id;
  const toolCallName = message.name;
  const toolStatus = message.status || "success";

  return `<tool message-id=${message.id ?? "No ID"} status="${toolStatus}">\nTool Call ID: ${toolCallId}\nTool Call Name: ${toolCallName}\nContent: ${content}\n</tool>`;
}

/**
 * System 메시지를 XML 형식 문자열로 변환합니다.
 *
 * @description
 * 시스템 메시지를 `<system>` 태그로 감싸서 표현합니다.
 * 주로 시스템 프롬프트나 내부 지시사항을 나타냅니다.
 *
 * @param message - 변환할 System 메시지
 * @returns XML 형식의 문자열
 *
 * @example
 * const msg = new SystemMessage({ content: "시스템 프롬프트" });
 * const str = getSystemMessageString(msg);
 * // "<system message-id=...>
 * // Content: 시스템 프롬프트
 * // </system>"
 */
export function getSystemMessageString(message: SystemMessage): string {
  const content = getMessageContentString(message.content);
  return `<system message-id=${message.id ?? "No ID"}>\nContent: ${content}\n</system>`;
}

/**
 * 알 수 없는 타입의 메시지를 XML 형식 문자열로 변환합니다.
 *
 * @description
 * AI, Human, Tool, System이 아닌 메시지를 `<unknown>` 태그로 감싸고,
 * 전체 메시지 객체를 JSON으로 직렬화하여 표시합니다.
 *
 * @param message - 변환할 메시지
 * @returns XML 형식의 문자열 (메시지 전체가 JSON으로 포함됨)
 */
export function getUnknownMessageString(message: BaseMessage): string {
  return `<unknown message-id=${message.id ?? "No ID"}>\n${JSON.stringify(message, null, 2)}\n</unknown>`;
}

/**
 * 메시지를 타입에 맞는 XML 형식 문자열로 변환합니다.
 *
 * @description
 * 메시지 타입을 자동으로 감지하여 적절한 변환 함수를 호출합니다.
 * AI, Human, Tool, System 메시지를 각각의 형식으로 변환하며,
 * 알 수 없는 타입은 Unknown 형식으로 변환합니다.
 *
 * @param message - 변환할 메시지
 * @returns 타입에 맞게 포맷팅된 XML 문자열
 *
 * @example
 * const aiMsg = new AIMessage({ content: "답변" });
 * const str = getMessageString(aiMsg);
 * // "<assistant ...>...</assistant>"
 */
export function getMessageString(message: BaseMessage): string {
  if (isAIMessage(message)) {
    return getAIMessageString(message);
  } else if (isHumanMessage(message)) {
    return getHumanMessageString(message);
  } else if (isToolMessage(message)) {
    return getToolMessageString(message);
  } else if (isSystemMessage(message)) {
    return getSystemMessageString(message);
  }

  return getUnknownMessageString(message);
}

/**
 * 내용이 없는 메시지를 필터링합니다.
 *
 * @description
 * 메시지 배열에서 빈 내용을 가진 메시지를 제거합니다.
 * AI 메시지의 경우 Tool Call이 있으면 내용이 비어있어도 유지합니다.
 *
 * 필터링 규칙:
 * - Human/Tool/System: 내용이 있는 메시지만 유지
 * - AI: 내용이 있거나 Tool Call이 있는 메시지 유지
 * - 숨김 메시지: filterHidden이 true이면 제거
 *
 * @param messages - 필터링할 메시지 배열
 * @param filterHidden - 숨김 메시지도 함께 필터링할지 여부 (기본값: true)
 * @returns 내용이 있는 메시지들만 포함된 배열
 *
 * @example
 * const filtered = filterMessagesWithoutContent(messages, true);
 * // 빈 메시지와 숨김 메시지가 제거됨
 */
export function filterMessagesWithoutContent(
  messages: BaseMessage[],
  filterHidden = true,
): BaseMessage[] {
  return messages.filter((m) => {
    if (filterHidden && m.additional_kwargs?.hidden) {
      return false;
    }
    const messageContentStr = getMessageContentString(m.content);
    if (!isAIMessage(m)) {
      return !!messageContentStr;
    }
    const toolCallsCount = m.tool_calls?.length || 0;
    return !!messageContentStr || toolCallsCount > 0;
  });
}
