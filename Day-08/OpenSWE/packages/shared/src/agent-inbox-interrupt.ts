/**
 * @file agent-inbox-interrupt.ts
 * @description LangGraph의 HumanInterrupt 타입을 확인하는 타입 가드(type guard) 함수를 제공합니다.
 * 이 함수는 객체가 에이전트의 실행을 중단하고 사용자 입력을 기다려야 하는 특정 구조를
 * 가지고 있는지 안전하게 검사하는 데 사용됩니다.
 */

import { HumanInterrupt } from "@langchain/langgraph/prebuilt";

/**
 * 주어진 값이 HumanInterrupt 객체(또는 객체의 배열)인지 확인하는 타입 가드 함수입니다.
 * HumanInterrupt는 LangGraph 실행을 일시 중지하고 사용자 입력을 기다리는 데 사용됩니다.
 * @param value 검사할 알 수 없는 타입의 값입니다.
 * @returns {boolean} 값이 HumanInterrupt 스키마와 일치하면 true를 반환합니다.
 */
export function isAgentInboxInterruptSchema(
  value: unknown,
): value is HumanInterrupt | HumanInterrupt[] {
  // 값이 배열이면 첫 번째 요소를, 아니면 값 자체를 검사 대상으로 합니다.
  const valueAsObject = Array.isArray(value) ? value[0] : value;
  // 객체이고, 내부에 특정 키('action_request', 'config' 등)가 존재하는지 검사하여 타입을 확인합니다.
  return (
    valueAsObject &&
    typeof valueAsObject === "object" &&
    "action_request" in valueAsObject &&
    typeof valueAsObject.action_request === "object" &&
    "config" in valueAsObject &&
    typeof valueAsObject.config === "object" &&
    "allow_respond" in valueAsObject.config &&
    "allow_accept" in valueAsObject.config &&
    "allow_edit" in valueAsObject.config &&
    "allow_ignore" in valueAsObject.config
  );
}