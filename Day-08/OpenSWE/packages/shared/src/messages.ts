/**
 * @file messages.ts
 * @description LangChain의 메시지 객체 처리를 위한 유틸리티 함수를 제공합니다.
 */

import { MessageContent } from "@langchain/core/messages";

/**
 * LangChain의 `MessageContent` 타입에서 텍스트 콘텐츠만 추출하여 단일 문자열로 결합합니다.
 * `MessageContent`는 문자열이거나, 텍스트, 이미지 등 다양한 타입의 객체 배열일 수 있습니다.
 * @param content - 처리할 `MessageContent` 객체입니다.
 * @returns {string} 추출된 텍스트를 공백으로 구분하여 합친 문자열.
 */
export function getMessageContentString(content: MessageContent): string {
  try {
    // 콘텐츠가 이미 문자열이면 그대로 반환합니다.
    if (typeof content === "string") return content;

    // 콘텐츠가 배열인 경우, 'text' 타입의 객체만 필터링하여
    // 각 객체의 'text' 속성을 추출한 후, 공백으로 연결합니다.
    return content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join(" ");
  } catch (error) {
    // 오류 발생 시 콘솔에 에러를 출력하고 빈 문자열을 반환합니다.
    // eslint-disable-next-line no-console
    console.error("메시지 콘텐츠 문자열을 가져오는 데 실패했습니다.", error);
    return "";
  }
}