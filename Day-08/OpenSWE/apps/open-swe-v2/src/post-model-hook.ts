/**
 * @file post-model-hook.ts
 * @description 이 파일은 에이전트의 'Human-in-the-Loop' (사용자 참여) 메커니즘을 구현하는
 * 핵심 로직인 post-model 훅을 정의합니다. 이 훅은 모델(LLM)이 도구 사용을 포함한 응답을
 * 생성한 직후, 그리고 해당 도구가 실제로 실행되기 전에 트리거됩니다. 훅은 제안된 도구 호출을
 * 가로채고, `constants.ts`에 정의된 민감한 명령어 목록과 대조하여 사용자 승인이 필요한지
 * 확인합니다. 승인이 필요하면 LangGraph의 `interrupt` 기능을 사용해 실행을 일시 중단하고
 * 사용자에게 확인을 요청합니다. 또한, 승인된 작업을 캐싱하여 동일한 작업에 대한 반복적인
 * 승인 요청을 방지합니다.
 */

import {
  AIMessage,
  isAIMessage,
  isAIMessageChunk,
} from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import { WRITE_COMMANDS } from "./constants.js";
import { AgentStateHelpers, type CodingAgentStateType } from "./state.js";
import { ToolCall } from "@langchain/core/messages/tool";
import { ApprovedOperations } from "./types.js";

/**
 * 에이전트의 post-model 훅으로 사용될 비동기 함수를 생성하는 팩토리 함수입니다.
 * 이 훅은 민감한 도구(명령어) 실행에 대한 사용자 승인 워크플로우를 중앙에서 관리합니다.
 * @returns {Function} 에이전트의 상태를 입력받아, 도구 호출을 검사하고 잠재적으로
 *   실행을 중단하거나 상태를 수정하는 비동기 `postModelHook` 함수를 반환합니다.
 */
export function createAgentPostModelHook() {
  /**
   * 모델이 응답을 생성한 후 에이전트의 실행 흐름을 가로채는 훅 함수입니다.
   * 이 함수는 모델이 제안한 도구 호출 목록을 순회하며, 각 호출이 사용자 승인을
   * 필요로 하는지 확인합니다. `state.approved_operations`에 저장된 캐시를 사용하여
   * 동일한 명령어와 디렉토리 조합에 대한 중복 승인 요청을 방지합니다.
   *
   * @param state 현재 `CodingAgent`의 상태 객체. 메시지 목록과 승인 캐시를 포함합니다.
   * @returns {Promise<CodingAgentStateType>} 잠재적으로 수정된 상태 객체. 사용자가 거부한
   *   도구 호출은 필터링되고, 승인된 호출만 남게 됩니다.
   */
  async function postModelHook(
    state: CodingAgentStateType,
  ): Promise<CodingAgentStateType> {
    // 상태에서 마지막 메시지를 가져옵니다. 이 훅은 AI의 최신 응답에 대해서만 작동합니다.
    const messages = state.messages || [];
    if (messages.length === 0) {
      return state;
    }

    const lastMessage = messages[messages.length - 1];

    // 마지막 메시지가 도구 호출을 포함하는 AI 메시지가 아니면, 이 훅은 아무 작업도 수행하지 않습니다.
    if (
      !(isAIMessage(lastMessage) || isAIMessageChunk(lastMessage)) ||
      !lastMessage.tool_calls
    ) {
      return state;
    }

    // 상태에 승인 캐시(`approved_operations`)가 없으면 새로 초기화합니다.
    if (!state.approved_operations) {
      const approved_operations: ApprovedOperations = {
        cached_approvals: new Set<string>(),
      };
      state.approved_operations = approved_operations;
    }

    const approvedToolCalls: ToolCall[] = [];

    // 모델이 제안한 모든 도구 호출을 하나씩 검사합니다.
    for (const toolCall of lastMessage.tool_calls) {
      const toolName = toolCall.name || "";
      const toolArgs = toolCall.args || {};

      if (!toolCall.name) {
        throw new Error("오류: 도구 호출에 이름이 지정되지 않았습니다.");
      }

      // `constants.ts`의 `WRITE_COMMANDS` 세트에 해당 도구 이름이 있는지 확인합니다.
      if (WRITE_COMMANDS.has(toolName)) {
        // 이전에 동일한 작업(명령어+인자)이 승인되었는지 캐시에서 확인합니다.
        if (AgentStateHelpers.isOperationApproved(state, toolName, toolArgs)) {
          approvedToolCalls.push(toolCall);
        } else {
          // 캐시에 없는 새로운 민감한 작업인 경우, 승인을 위해 고유 키를 생성합니다.
          const approvalKey = AgentStateHelpers.getApprovalKey(
            toolName,
            toolArgs,
          );

          // LangGraph의 `interrupt` 함수를 호출하여 그래프 실행을 일시 중단하고,
          // 사용자 인터페이스에 승인 요청을 보냅니다.
          const isApproved = interrupt({
            command: toolName,
            args: toolArgs,
            approval_key: approvalKey,
          });

          // 사용자가 승인하면(isApproved가 true), 이 승인 사실을 캐시에 추가하고
          // 해당 도구 호출을 실행 허용 목록에 추가합니다.
          if (isApproved) {
            AgentStateHelpers.addApprovedOperation(state, toolName, toolArgs);
            approvedToolCalls.push(toolCall);
          } else {
            // 사용자가 거부하면, 이 도구 호출은 무시하고 다음 호출로 넘어갑니다.
            continue;
          }
        }
      } else {
        // 승인이 필요 없는 명령어는 자동으로 실행 허용 목록에 추가합니다.
        approvedToolCalls.push(toolCall);
      }
    }

    // 만약 일부 도구 호출이 사용자에 의해 거부되어 필터링되었다면,
    // 마지막 AI 메시지를 승인된 도구 호출만 포함하도록 업데이트해야 합니다.
    if (approvedToolCalls.length !== lastMessage.tool_calls.length) {
      const originalToolCalls = lastMessage.tool_calls.filter((toolCall) =>
        approvedToolCalls.some((approved) => approved.name === toolCall.name),
      );

      // 승인된 도구 호출만 포함하는 새로운 AIMessage 객체를 생성합니다.
      const newMessage = new AIMessage({
        ...lastMessage,
        tool_calls: originalToolCalls,
      });

      // 상태의 메시지 목록에서 마지막 메시지를 이 새로운 메시지로 교체합니다.
      const newMessages = [...messages.slice(0, -1), newMessage];
      state.messages = newMessages;
    }

    return state;
  }

  return postModelHook;
}
