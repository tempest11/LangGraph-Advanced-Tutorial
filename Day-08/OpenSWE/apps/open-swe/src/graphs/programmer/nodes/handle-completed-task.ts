/**
 * @file Programmer의 완료된 작업 처리 노드
 * @description
 * LLM이 "mark_task_completed" 도구를 호출하여 작업을 완료로 표시했을 때 실행되는 노드입니다.
 * 작업 상태를 업데이트하고, GitHub 이슈를 갱신하며, 다음 단계를 결정합니다.
 *
 * 주요 기능:
 * - 작업 완료 도구 호출 검증
 * - TaskPlan에서 해당 항목을 완료 상태로 업데이트
 * - GitHub 이슈에 진행 상황 반영 (클라우드 모드)
 * - 토큰 사용량 확인 및 히스토리 요약 필요 여부 판단
 * - 다음 노드로 라우팅 (남은 작업 여부, 토큰 한계에 따라)
 *
 * 라우팅 로직:
 * 1. 남은 작업 없음 → "route-to-review-or-conclusion"
 * 2. 토큰 한계 도달 → "summarize-history"
 * 3. 정상 진행 → "generate-action" (다음 작업)
 */

// 외부 라이브러리
import { v4 as uuidv4 } from "uuid"; // UUID 생성 (ToolMessage ID용)

// 유틸리티 함수
import { createLogger, LogLevel } from "../../../utils/logger.js"; // 로거 생성
import {
  GraphConfig, // LangGraph 설정 타입
  GraphState, // 그래프 전역 상태 타입
  GraphUpdate, // 상태 업데이트 타입
} from "@openswe/shared/open-swe/types";
import { Command } from "@langchain/langgraph"; // LangGraph 라우팅 명령
import { isLocalMode } from "@openswe/shared/open-swe/local-mode"; // 로컬 모드 확인
import {
  completePlanItem, // 계획 항목 완료 처리
  getActivePlanItems, // 활성 계획 항목 목록
  getActiveTask, // 현재 활성 작업
} from "@openswe/shared/open-swe/tasks";
import {
  getCurrentPlanItem, // 현재 진행 중인 계획 항목
  getRemainingPlanItems, // 남은 계획 항목 목록
} from "../../../utils/current-task.js";
import { isAIMessage, ToolMessage } from "@langchain/core/messages"; // LangChain 메시지 타입
import { addTaskPlanToIssue } from "../../../utils/github/issue-task.js"; // GitHub 이슈 업데이트
import { createMarkTaskCompletedToolFields } from "@openswe/shared/open-swe/tools"; // 작업 완료 도구 정의
import {
  calculateConversationHistoryTokenCount, // 토큰 수 계산
  getMessagesSinceLastSummary, // 마지막 요약 이후 메시지 추출
  MAX_INTERNAL_TOKENS, // 내부 메시지 최대 토큰 수 제한
} from "../../../utils/tokens.js";
import { z } from "zod"; // Zod 스키마 타입 추론
import { shouldCreateIssue } from "../../../utils/should-create-issue.js"; // GitHub 이슈 생성 여부 판단

// 로거 인스턴스 생성
const logger = createLogger(LogLevel.INFO, "HandleCompletedTask");

/**
 * 완료된 작업을 처리하고 다음 단계를 결정하는 노드 함수입니다
 *
 * @description
 * LLM이 작업 완료를 표시하면 호출됩니다.
 * 이 노드는 완료 상태를 검증하고, TaskPlan을 업데이트하며,
 * 토큰 사용량을 확인하여 적절한 다음 노드로 라우팅합니다.
 *
 * 처리 흐름:
 * 1. 마지막 메시지에서 "mark_task_completed" 도구 호출 검증
 * 2. ToolMessage 생성하여 작업 완료 확인
 * 3. 토큰 사용량 계산 (요약 필요 여부 판단용)
 * 4. TaskPlan에서 해당 항목을 완료 상태로 변경
 * 5. GitHub 이슈 업데이트 (클라우드 모드만)
 * 6. 남은 작업 확인 후 라우팅:
 *    - 남은 작업 없음 → 리뷰 or 결론 생성
 *    - 토큰 한계 도달 → 히스토리 요약
 *    - 정상 → 다음 작업 생성
 *
 * @param {GraphState} state - 현재 그래프 상태 (TaskPlan, 메시지, GitHub 정보 포함)
 * @param {GraphConfig} config - 그래프 설정 (모드, 모델 설정 등)
 * @returns {Promise<Command>} 상태 업데이트 및 다음 노드 라우팅 명령
 * @throws {Error} 도구 호출을 찾을 수 없거나 유효하지 않을 때
 *
 * @example
 * // 마지막 작업 완료 시
 * const command = await handleCompletedTask(state, config);
 * // => Command { update: {...}, goto: "route-to-review-or-conclusion" }
 *
 * @example
 * // 토큰 한계 도달 시
 * const command = await handleCompletedTask(state, config);
 * // => Command { update: {...}, goto: "summarize-history" }
 */
export async function handleCompletedTask(
  state: GraphState,
  config: GraphConfig,
): Promise<Command> {
  // === 1단계: 작업 완료 도구 호출 검증 ===
  const markCompletedTool = createMarkTaskCompletedToolFields();
  const markCompletedMessage =
    state.internalMessages[state.internalMessages.length - 1];

  // 마지막 메시지가 AI 메시지이고 mark_task_completed 도구를 호출했는지 확인
  if (
    !isAIMessage(markCompletedMessage) ||
    !markCompletedMessage.tool_calls?.length ||
    !markCompletedMessage.tool_calls.some(
      (tc) => tc.name === markCompletedTool.name,
    )
  ) {
    throw new Error("Failed to find a tool call when checking task status.");
  }

  // 첫 번째 도구 호출 가져오기
  const toolCall = markCompletedMessage.tool_calls?.[0];
  if (!toolCall) {
    throw new Error(
      "Failed to generate a tool call when checking task status.",
    );
  }

  // === 2단계: 현재 작업 정보 및 ToolMessage 생성 ===
  const activePlanItems = getActivePlanItems(state.taskPlan);
  const currentTask = getCurrentPlanItem(activePlanItems);

  // 작업 완료 확인 ToolMessage 생성
  const toolMessage = new ToolMessage({
    id: uuidv4(),
    tool_call_id: toolCall.id ?? "",
    content: `Saved task status as completed for task ${currentTask?.plan || "unknown"}`,
    name: toolCall.name,
  });

  const newMessages = [toolMessage];

  // === 3단계: 토큰 사용량 계산 ===
  // 새 메시지를 추가한 후의 전체 메시지 목록
  const newMessageList = [...state.internalMessages, ...newMessages];

  // 마지막 요약 이후 메시지들 추출 (마지막 20개 메시지 제외)
  const wouldBeConversationHistoryToSummarize =
    await getMessagesSinceLastSummary(newMessageList, {
      excludeHiddenMessages: true,
      excludeCountFromEnd: 20,
    });

  // 토큰 수 계산
  const totalInternalTokenCount = calculateConversationHistoryTokenCount(
    wouldBeConversationHistoryToSummarize,
    {
      // 마지막 20개 메시지는 항상 유지
      excludeHiddenMessages: true,
      excludeCountFromEnd: 20,
    },
  );

  // === 4단계: 도구 호출에서 작업 요약 추출 ===
  const summary = (toolCall.args as z.infer<typeof markCompletedTool.schema>)
    .completed_task_summary;

  // === 5단계: TaskPlan 업데이트 ===
  // LLM이 완료로 표시했으므로 계획에 반영
  const updatedPlanTasks = completePlanItem(
    state.taskPlan,
    getActiveTask(state.taskPlan).id,
    currentTask.index,
    summary,
  );

  // === 6단계: GitHub 이슈 업데이트 (클라우드 모드만) ===
  if (!isLocalMode(config) && shouldCreateIssue(config)) {
    await addTaskPlanToIssue(
      {
        githubIssueId: state.githubIssueId,
        targetRepository: state.targetRepository,
      },
      config,
      updatedPlanTasks,
    );
  } else {
    logger.info("Skipping GitHub issue update in local mode");
  }

  // === 7단계: 상태 업데이트 객체 생성 ===
  const commandUpdate: GraphUpdate = {
    messages: newMessages,
    internalMessages: newMessages,
    // 남은 작업이 없어도 UI에 완료 상태를 반영하기 위해 업데이트
    taskPlan: updatedPlanTasks,
  };

  // === 8단계: 남은 작업 확인 및 라우팅 ===
  const remainingTask = getRemainingPlanItems(activePlanItems)?.[0];

  // 8-1. 남은 작업이 없으면 리뷰 or 결론 생성 단계로
  if (!remainingTask) {
    logger.info(
      "Found no remaining tasks in the plan during the check plan step. Continuing to the conclusion generation step.",
    );

    return new Command({
      goto: "route-to-review-or-conclusion",
      update: commandUpdate,
    });
  }

  // 8-2. 토큰 한계에 도달하면 히스토리 요약 단계로
  if (totalInternalTokenCount >= MAX_INTERNAL_TOKENS) {
    logger.info(
      "Internal messages list is at or above the max token limit. Routing to summarize history step.",
      {
        totalInternalTokenCount,
        maxInternalTokenCount: MAX_INTERNAL_TOKENS,
      },
    );

    return new Command({
      goto: "summarize-history",
      update: commandUpdate,
    });
  }

  // 8-3. 정상 진행: 다음 작업 생성 단계로
  return new Command({
    goto: "generate-action",
    update: commandUpdate,
  });
}
