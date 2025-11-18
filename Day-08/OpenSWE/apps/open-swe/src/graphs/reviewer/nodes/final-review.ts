/**
 * @file Reviewer 그래프의 최종 리뷰 노드 (final-review.ts)
 * @description
 * Reviewer가 수집한 모든 정보를 바탕으로 최종 리뷰를 제공하고
 * 작업 완료 여부를 결정하는 Reviewer의 가장 핵심적인 노드입니다.
 *
 * 주요 기능:
 * 1. **최종 판단**: 작업 완료 vs 추가 작업 필요 결정
 * 2. **구조화된 출력**: 2개 도구 중 하나 반드시 호출 (tool_choice: "any")
 * 3. **스크래치패드 통합**: Reviewer가 작성한 노트 수집 및 분석
 * 4. **계획 업데이트**: 추가 작업 필요 시 새 계획 항목 추가
 * 5. **GitHub 이슈 동기화**: 업데이트된 계획을 GitHub 이슈에 기록
 *
 * 2가지 결과:
 * 1. **작업 완료**: mark_code_review_task_completed 도구 호출
 *    - Programmer에게 돌아가지 않음
 *    - Reviewer 그래프 종료
 *    - 최종 리뷰만 제공
 *
 * 2. **추가 작업 필요**: mark_code_review_task_not_complete 도구 호출
 *    - additional_actions 목록 제공 (새 계획 항목으로 추가)
 *    - Programmer 그래프로 다시 라우팅
 *    - reviewsCount 증가 (리뷰 사이클 추적)
 *
 * 워크플로우:
 * 1. 시스템 프롬프트 생성 (리뷰 액션, 계획, 스크래치패드 노트 포함)
 * 2. LLM 호출 (2개 도구 중 하나 반드시 선택)
 * 3. 도구 호출 검증
 * 4. 작업 완료 시: 완료 메시지 반환
 * 5. 추가 작업 필요 시:
 *    - 새 계획 항목 추가
 *    - GitHub 이슈 업데이트
 *    - reviewsCount 증가
 *    - 상태 업데이트 반환
 *
 * 스크래치패드 노트:
 * - Reviewer가 generate-review-actions, take-review-action 단계에서 작성한 노트
 * - 발견한 이슈, 실행할 스크립트, 파일 위치 등 기록
 * - 최종 리뷰 시 모든 노트를 종합하여 판단에 활용
 */

// === 외부 라이브러리 ===
import { v4 as uuidv4 } from "uuid"; // 고유 ID 생성

// === Reviewer 타입 ===
import {
  ReviewerGraphState,  // Reviewer 그래프 상태
  ReviewerGraphUpdate, // Reviewer 상태 업데이트
} from "@openswe/shared/open-swe/reviewer/types";

// === 프롬프트 유틸리티 ===
import { formatUserRequestPrompt } from "../../../utils/user-request.js"; // 사용자 요청 프롬프트
import { formatPlanPromptWithSummaries } from "../../../utils/plan-prompt.js"; // 계획 프롬프트 (요약 포함)

// === 작업 계획 유틸리티 ===
import {
  getActivePlanItems,   // 활성 계획 항목 가져오기
  getActiveTask,        // 현재 활성 작업 가져오기
  updateTaskPlanItems,  // 작업 계획 항목 업데이트
} from "@openswe/shared/open-swe/tasks";

// === 도구 정의 ===
import {
  createCodeReviewMarkTaskCompletedFields,    // 작업 완료 표시 도구
  createCodeReviewMarkTaskNotCompleteFields,  // 작업 미완료 표시 도구
} from "@openswe/shared/open-swe/tools";

// === 로컬 모드 ===
import { isLocalMode } from "@openswe/shared/open-swe/local-mode"; // 로컬 모드 여부 확인

// === 로깅 유틸리티 ===
import { createLogger, LogLevel } from "../../../utils/logger.js"; // 구조화된 로거

// === LLM 모델 관리 ===
import {
  loadModel,                       // LLM 모델 로드
  supportsParallelToolCallsParam,  // 병렬 도구 호출 지원 여부
} from "../../../utils/llms/index.js";
import { LLMTask } from "@openswe/shared/open-swe/llm-task"; // LLM 작업 타입

// === 타입 정의 ===
import { GraphConfig, PlanItem } from "@openswe/shared/open-swe/types"; // 그래프 설정, 계획 항목

// === Zod ===
import { z } from "zod"; // TypeScript 타입 검증 라이브러리

// === GitHub 이슈 유틸리티 ===
import { addTaskPlanToIssue } from "../../../utils/github/issue-task.js"; // GitHub 이슈에 계획 추가

// === 메시지 유틸리티 ===
import { getMessageString } from "../../../utils/message/content.js"; // 메시지를 문자열로 변환

// === LangChain 메시지 타입 ===
import {
  AIMessage,     // AI 메시지
  BaseMessage,   // 메시지 기본 타입
  isAIMessage,   // AIMessage 타입 가드
  ToolMessage,   // 도구 실행 결과 메시지
} from "@langchain/core/messages";

// === 프롬프트 캐싱 ===
import { trackCachePerformance } from "../../../utils/caching.js"; // 프롬프트 캐싱 성능 추적

// === 모델 매니저 ===
import { getModelManager } from "../../../utils/llms/model-manager.js"; // 모델 매니저

// === 스크래치패드 도구 ===
import { createScratchpadTool } from "../../../tools/scratchpad.js"; // 노트 작성 도구

// === 이슈 생성 유틸리티 ===
import { shouldCreateIssue } from "../../../utils/should-create-issue.js"; // 이슈 생성 필요 여부 확인

/**
 * 로거 인스턴스 생성
 * @constant {Logger}
 */
const logger = createLogger(LogLevel.INFO, "FinalReview");

/**
 * 최종 리뷰 시스템 프롬프트
 * @constant {string}
 * @description
 * Reviewer가 최종 판단을 내릴 때 사용하는 프롬프트입니다.
 *
 * **주요 목표 (primary_objective):**
 * Reviewer는 다음 2가지 중 하나를 결정해야 합니다:
 * 1. **작업 완료**: 모든 필요한 액션이 수행되었고 사용자 요청이 완전히 충족됨
 *    - {COMPLETE_TOOL_NAME} 도구 호출
 *    - 최종 리뷰 제공
 *
 * 2. **작업 미완료**: 액션이 불충분하며 사용자 요청을 완전히 충족하지 못함
 *    - {NOT_COMPLETE_TOOL_NAME} 도구 호출
 *    - 리뷰 및 추가 액션 목록 제공
 *
 * **컨텍스트 (context):**
 * - {REVIEW_ACTIONS}: Reviewer가 수행한 모든 액션 (grep, shell, view 등)
 * - {USER_REQUEST_PROMPT}: 원래 사용자 요청
 * - {PLANNED_TASKS}: Programmer가 완료한 계획 작업들
 * - {SCRATCHPAD_NOTES}: Reviewer가 작성한 스크래치패드 노트
 *
 * **리뷰 가이드라인 (review-guidelines):**
 * - 포맷팅/린팅 스크립트는 항상 마지막에 실행
 * - 이후 변경사항이 포맷/린트를 깨뜨릴 수 있으므로
 * - 모든 컨텍스트를 신중히 검토 후 판단
 *
 * **플레이스홀더:**
 * - {COMPLETE_TOOL_NAME}: mark_code_review_task_completed
 * - {NOT_COMPLETE_TOOL_NAME}: mark_code_review_task_not_complete
 * - {REVIEW_ACTIONS}: Reviewer 메시지 문자열
 * - {USER_REQUEST_PROMPT}: 사용자 요청 프롬프트
 * - {PLANNED_TASKS}: 완료된 작업 계획 (요약 포함)
 * - {SCRATCHPAD_NOTES}: 스크래치패드 노트
 *
 * @example
 * // formatSystemPrompt에서 플레이스홀더 치환
 * const systemPrompt = SYSTEM_PROMPT
 *   .replaceAll("{REVIEW_ACTIONS}", messagesString)
 *   .replaceAll("{COMPLETE_TOOL_NAME}", "mark_code_review_task_completed");
 */
const SYSTEM_PROMPT = `You are a code reviewer for a software engineer working on a large codebase.

<primary_objective>
You've just finished reviewing the actions taken by the Programmer Assistant, and are ready to provide a final review. In this final review, you are to either:
1. Determine all of the necessary actions have been taken which completed the user's request, and all of the individual tasks outlined in the plan.
or
2. Determine that the actions taken are insufficient, and do not fully complete the user's request, and all of the individual tasks outlined in the plan.

If you determine that the task is completed, you may call the \`{COMPLETE_TOOL_NAME}\` tool, providing your final review.
If you determine that the task has not been fully completed, you may call the \`{NOT_COMPLETE_TOOL_NAME}\` tool, providing your review, and a list of additional actions to take which will successfully satisfy your review, and complete the task.
</primary_objective>

<context>
Here is the full list of actions you took during your review:
{REVIEW_ACTIONS}

{USER_REQUEST_PROMPT}

And here are the tasks which were outlined in the plan, and completed by the Programmer Assistant:
{PLANNED_TASKS}

Here are all of the notes you wrote to your scratchpad during the review:
{SCRATCHPAD_NOTES}
</context>

<review-guidelines>
If you determine that the task is not completed, keep the following in mind when generating your review:
- Formatting/linting scripts should always be executed last, since any changes made after them could cause the codebase to no longer be properly formatted/linted.

Carefully read over all of the provided context above, and if you determine that the task has NOT been completed, call the \`{NOT_COMPLETE_TOOL_NAME}\` tool.
Otherwise, if you determine that the task has been successfully completed, call the \`{COMPLETE_TOOL_NAME}\` tool.
</review-guidelines>`;

/**
 * 메시지 배열에서 스크래치패드 노트를 추출합니다.
 *
 * @description
 * Reviewer가 generate-review-actions 및 take-review-action 단계에서
 * scratchpad 도구를 사용하여 작성한 노트를 모두 추출합니다.
 *
 * 스크래치패드 노트 내용:
 * - 발견한 이슈 (누락된 테스트, 잘못된 파일 위치 등)
 * - 실행할 스크립트 (lint, test, format, build)
 * - 파일 수정/삭제/이동 필요 사항
 * - 기타 리뷰 중 발견한 중요 사항
 *
 * 처리:
 * 1. AI 메시지 중 scratchpad 도구 호출이 있는 메시지 필터링
 * 2. 각 scratchpad 도구 호출에서 노트 추출
 * 3. <scratchpad_entry> 태그로 감싸서 반환
 * 4. 모든 노트를 줄바꿈으로 결합
 *
 * @param {BaseMessage[]} messages - Reviewer 메시지 배열
 * @returns {string} 추출된 스크래치패드 노트 문자열
 *
 * @example
 * const notes = getScratchpadNotesString(state.reviewerMessages);
 * // "<scratchpad_entry>\n- 테스트가 누락됨\n- lint 스크립트 실행 필요\n</scratchpad_entry>\n..."
 */
const getScratchpadNotesString = (messages: BaseMessage[]) => {
  return messages
    .filter(
      (m) =>
        isAIMessage(m) &&
        m.tool_calls?.length &&
        m.tool_calls?.some((tc) => tc.name === createScratchpadTool("").name),
    )
    .map((m) => {
      const scratchpadTool = (m as AIMessage).tool_calls?.find(
        (tc) => tc.name === createScratchpadTool("").name,
      );
      if (!scratchpadTool) {
        return "";
      }
      return `<scratchpad_entry>\n${scratchpadTool.args.scratchpad}\n</scratchpad_entry>`;
    })
    .join("\n");
};

/**
 * 최종 리뷰를 위한 시스템 프롬프트를 생성합니다.
 *
 * @description
 * Reviewer가 최종 판단을 내리는 데 필요한 모든 컨텍스트를 포함한
 * 시스템 프롬프트를 생성합니다.
 *
 * 포함 정보:
 * 1. **리뷰 액션**: Reviewer가 수행한 모든 도구 호출 (grep, shell, view 등)
 * 2. **사용자 요청**: 원래 사용자가 요청한 내용
 * 3. **완료된 작업**: Programmer가 완료한 계획 작업들 (요약 포함)
 * 4. **스크래치패드 노트**: Reviewer가 작성한 모든 노트
 * 5. **도구 이름**: 작업 완료/미완료 도구 이름
 *
 * 플레이스홀더 치환:
 * - {REVIEW_ACTIONS} → Reviewer 메시지 문자열
 * - {USER_REQUEST_PROMPT} → 사용자 요청 프롬프트
 * - {PLANNED_TASKS} → 완료된 작업 계획 (요약 포함)
 * - {COMPLETE_TOOL_NAME} → "mark_code_review_task_completed"
 * - {NOT_COMPLETE_TOOL_NAME} → "mark_code_review_task_not_complete"
 * - {SCRATCHPAD_NOTES} → 스크래치패드 노트
 *
 * @param {ReviewerGraphState} state - 현재 ReviewerGraphState
 *   - reviewerMessages: Reviewer가 수행한 모든 액션
 *   - messages: 사용자 메시지
 *   - taskPlan: 작업 계획
 *
 * @returns {string} 생성된 시스템 프롬프트 문자열
 *
 * @example
 * const systemPrompt = formatSystemPrompt(state);
 * // "You are a code reviewer...\n<context>\nHere is the full list of actions...\n..."
 */
const formatSystemPrompt = (state: ReviewerGraphState) => {
  const markCompletedToolName = createCodeReviewMarkTaskCompletedFields().name;
  const markNotCompleteToolName =
    createCodeReviewMarkTaskNotCompleteFields().name;
  const activePlan = getActivePlanItems(state.taskPlan);
  const tasksString = formatPlanPromptWithSummaries(activePlan);
  const messagesString = state.reviewerMessages
    .map(getMessageString)
    .join("\n");
  const scratchpadNotesString = getScratchpadNotesString(
    state.reviewerMessages,
  );

  return SYSTEM_PROMPT.replaceAll("{REVIEW_ACTIONS}", messagesString)
    .replaceAll(
      "{USER_REQUEST_PROMPT}",
      formatUserRequestPrompt(state.messages),
    )
    .replaceAll("{PLANNED_TASKS}", tasksString)
    .replaceAll("{COMPLETE_TOOL_NAME}", markCompletedToolName)
    .replaceAll("{NOT_COMPLETE_TOOL_NAME}", markNotCompleteToolName)
    .replaceAll("{SCRATCHPAD_NOTES}", scratchpadNotesString);
};

/**
 * Reviewer의 최종 리뷰를 생성하고 작업 완료 여부를 결정하는 노드입니다.
 *
 * @description
 * Reviewer가 수집한 모든 정보 (리뷰 액션, 스크래치패드 노트, 계획, 사용자 요청)를
 * 종합하여 최종 판단을 내립니다.
 *
 * 처리 흐름:
 * 1. **도구 준비**: mark_completed, mark_not_complete 2개 도구 생성
 * 2. **모델 설정**: tool_choice="any"로 반드시 하나의 도구 호출 강제
 * 3. **시스템 프롬프트 생성**: 모든 컨텍스트 포함
 * 4. **LLM 호출**: 최종 판단 생성
 * 5. **도구 호출 검증**: 반드시 하나의 도구 호출이 있어야 함
 * 6. **작업 완료 처리**:
 *    - mark_completed 호출 시
 *    - 완료 메시지 생성
 *    - Reviewer 그래프 종료
 *
 * 7. **추가 작업 필요 처리**:
 *    - mark_not_complete 호출 시
 *    - additional_actions 추출
 *    - 새 계획 항목 추가 (완료된 항목 + 새 항목)
 *    - GitHub 이슈 업데이트
 *    - reviewsCount 증가
 *    - 상태 업데이트 반환 (Programmer로 다시 라우팅)
 *
 * 2가지 결과:
 * 1. **작업 완료** (mark_code_review_task_completed):
 *    - 리뷰 메시지만 반환
 *    - taskPlan 업데이트 없음
 *    - Reviewer 그래프 종료
 *
 * 2. **추가 작업 필요** (mark_code_review_task_not_complete):
 *    - additional_actions 목록 추출
 *    - 완료된 계획 항목 유지 + 새 항목 추가
 *    - GitHub 이슈에 업데이트된 계획 추가
 *    - reviewsCount 증가 (리뷰 사이클 추적)
 *    - Programmer 그래프로 다시 라우팅
 *
 * 계획 업데이트 (추가 작업 필요 시):
 * - 완료된 계획 항목은 유지 (중복 작업 방지)
 * - 새 액션을 새 계획 항목으로 추가
 * - index는 완료된 항목 수부터 시작
 * - completed: false, summary: undefined로 초기화
 *
 * GitHub 이슈 동기화:
 * - 클라우드 모드 && shouldCreateIssue === true인 경우에만
 * - 업데이트된 계획을 이슈 댓글로 추가
 * - Programmer와 Reviewer가 계획 공유
 *
 * 리뷰 사이클:
 * - reviewsCount: 리뷰 반복 횟수 추적
 * - Programmer 수정 → Reviewer 검토 → 추가 작업 → Programmer 수정 → ...
 * - 무한 루프 방지는 take-review-action의 maxReviewActions로 처리
 *
 * @param {ReviewerGraphState} state - 현재 ReviewerGraphState
 *   - reviewerMessages: Reviewer가 수행한 모든 액션
 *   - messages: 사용자 메시지
 *   - taskPlan: 작업 계획
 *   - githubIssueId: GitHub 이슈 ID
 *   - targetRepository: 타겟 저장소
 *   - reviewsCount: 현재 리뷰 횟수
 *
 * @param {GraphConfig} config - 그래프 설정
 *   - configurable.models.reviewer: Reviewer LLM 모델
 *   - configurable.localMode: 로컬 모드 여부
 *
 * @returns {Promise<ReviewerGraphUpdate>} 그래프 상태 업데이트
 *   - 작업 완료 시:
 *     - messages: [AIMessage, ToolMessage]
 *     - internalMessages: [AIMessage, ToolMessage]
 *     - reviewerMessages: [AIMessage, ToolMessage]
 *
 *   - 추가 작업 필요 시:
 *     - taskPlan: 업데이트된 작업 계획 (새 항목 추가)
 *     - messages: [AIMessage, ToolMessage]
 *     - internalMessages: [AIMessage, ToolMessage]
 *     - reviewsCount: 증가된 리뷰 횟수
 *     - tokenData: 캐시 성능 추적 데이터
 *
 * @throws {Error} 도구 호출이 생성되지 않은 경우
 * @throws {Error} 잘못된 도구 호출인 경우
 *
 * @example
 * // LangGraph에서 자동 호출
 * const update = await finalReview(state, config);
 *
 * // 작업 완료 시
 * // update.messages[0].tool_calls[0].name === "mark_code_review_task_completed"
 *
 * // 추가 작업 필요 시
 * // update.taskPlan.tasks[0].planItems.length > 원래 길이 (새 항목 추가됨)
 * // update.reviewsCount === (state.reviewsCount || 0) + 1
 */
export async function finalReview(
  state: ReviewerGraphState,
  config: GraphConfig,
): Promise<ReviewerGraphUpdate> {
  // === 1단계: 도구 생성 ===
  const completedTool = createCodeReviewMarkTaskCompletedFields();       // 작업 완료 도구
  const incompleteTool = createCodeReviewMarkTaskNotCompleteFields();    // 작업 미완료 도구
  const tools = [completedTool, incompleteTool];

  // === 2단계: LLM 모델 로드 및 설정 ===
  const model = await loadModel(config, LLMTask.REVIEWER);
  const modelManager = getModelManager();
  const modelName = modelManager.getModelNameForTask(config, LLMTask.REVIEWER);
  const modelSupportsParallelToolCallsParam = supportsParallelToolCallsParam(
    config,
    LLMTask.REVIEWER,
  );

  // === 3단계: 도구 바인딩 ===
  const modelWithTools = model.bindTools(tools, {
    tool_choice: "any", // 반드시 하나의 도구 호출 (completed 또는 incomplete)
    ...(modelSupportsParallelToolCallsParam
      ? {
          parallel_tool_calls: false, // 병렬 호출 금지 (하나만 선택)
        }
      : {}),
  });

  // === 4단계: LLM 호출 ===
  const response = await modelWithTools.invoke([
    {
      role: "user",
      content: formatSystemPrompt(state), // 모든 컨텍스트 포함
    },
  ]);

  // === 5단계: 도구 호출 검증 ===
  const toolCall = response.tool_calls?.[0];
  if (!toolCall) {
    throw new Error("리뷰를 위한 도구 호출이 생성되지 않았습니다.");
  }

  // === 6단계: 작업 완료 처리 ===
  if (toolCall.name === completedTool.name) {
    // 완료로 표시됨. 더 이상의 조치가 필요하지 않습니다.
    const toolMessage = new ToolMessage({
      id: uuidv4(),
      tool_call_id: toolCall.id ?? "",
      content: "작업을 완료로 표시했습니다.",
    });
    const messagesUpdate = [response, toolMessage];
    return {
      messages: messagesUpdate,           // 사용자 메시지
      internalMessages: messagesUpdate,   // Programmer 내부 메시지
      reviewerMessages: messagesUpdate,   // Reviewer 메시지
    };
  }

  // === 7단계: 도구 이름 검증 ===
  if (toolCall.name !== incompleteTool.name) {
    throw new Error("잘못된 도구 호출입니다.");
  }

  // === 8단계: 추가 작업 필요 처리 ===
  // 완료되지 않음. 새 계획 항목을 작업에 추가한 다음 반환합니다.
  const newActions = (toolCall.args as z.infer<typeof incompleteTool.schema>)
    .additional_actions;
  const activeTask = getActiveTask(state.taskPlan);
  const activePlanItems = getActivePlanItems(state.taskPlan);
  const completedPlanItems = activePlanItems.filter((p) => p.completed);

  // === 9단계: 새 계획 항목 목록 생성 ===
  // 완료된 계획 항목 유지 + 새 액션 추가
  const newPlanItemsList: PlanItem[] = [
    // 이전 작업 계획의 완료된 계획 항목만 업데이트에 포함합니다.
    ...completedPlanItems,
    // 새 액션을 새 계획 항목으로 추가
    ...newActions.map((a, index) => ({
      index: completedPlanItems.length + index,
      plan: a,
      completed: false,
      summary: undefined,
    })),
  ];

  // === 10단계: 작업 계획 업데이트 ===
  const updatedTaskPlan = updateTaskPlanItems(
    state.taskPlan,
    activeTask.id,
    newPlanItemsList,
    "agent", // 에이전트가 업데이트했음을 표시
  );

  // === 11단계: GitHub 이슈에 업데이트된 계획 추가 ===
  if (!isLocalMode(config) && shouldCreateIssue(config)) {
    await addTaskPlanToIssue(
      {
        githubIssueId: state.githubIssueId,
        targetRepository: state.targetRepository,
      },
      config,
      updatedTaskPlan,
    );
  } else {
    logger.info("로컬 모드에서는 GitHub 이슈 업데이트를 건너뜁니다.");
  }

  // === 12단계: 도구 메시지 생성 ===
  const toolMessage = new ToolMessage({
    id: uuidv4(),
    tool_call_id: toolCall.id ?? "",
    content: "작업을 미완료로 표시했습니다.",
  });

  const messagesUpdate = [response, toolMessage];

  // === 13단계: 상태 업데이트 반환 ===
  return {
    taskPlan: updatedTaskPlan,              // 업데이트된 작업 계획 (새 항목 추가)
    messages: messagesUpdate,               // 사용자 메시지
    internalMessages: messagesUpdate,       // Programmer 내부 메시지
    reviewsCount: (state.reviewsCount || 0) + 1, // 리뷰 횟수 증가
    tokenData: trackCachePerformance(response, modelName), // 캐시 성능 추적
  };
}
