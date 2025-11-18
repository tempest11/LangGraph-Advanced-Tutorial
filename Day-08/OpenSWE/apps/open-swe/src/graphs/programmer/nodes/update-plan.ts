/**
 * @file Programmer의 계획 업데이트 노드
 * @description
 * LLM이 작업 중 계획을 수정해야 한다고 판단했을 때 실행되는 노드입니다.
 * 두 단계의 LLM 호출로 안전하게 계획을 업데이트합니다.
 *
 * 주요 기능:
 * - 2단계 업데이트 프로세스 (추론 → 실행)
 * - 완료된 항목 보존 (수정 불가)
 * - 남은 항목만 추가/수정/삭제
 * - GitHub 이슈 자동 업데이트
 * - 최소 변경 원칙 (필요한 것만 수정)
 *
 * 업데이트 프로세스:
 * 1. LLM이 update_plan_reasoning 도구 호출 (왜 변경하는지 추론)
 * 2. 그 추론을 바탕으로 새로운 LLM 호출 (실제 계획 생성)
 * 3. 완료된 항목 + 새 항목 병합
 * 4. TaskPlan 업데이트 및 GitHub 반영
 */

// 외부 라이브러리
import { v4 as uuidv4 } from "uuid"; // UUID 생성

// Open SWE 공유 타입
import {
  GraphState, // 그래프 전역 상태 타입
  GraphConfig, // LangGraph 설정 타입
  PlanItem, // 개별 계획 항목 타입
  GraphUpdate, // 상태 업데이트 타입
  CustomRules, // 커스텀 규칙 타입
} from "@openswe/shared/open-swe/types";

// 유틸리티 함수
import {
  loadModel, // LLM 모델 로더
  supportsParallelToolCallsParam, // 병렬 도구 호출 지원 여부
} from "../../../utils/llms/index.js";
import { LLMTask } from "@openswe/shared/open-swe/llm-task"; // LLM 작업 타입 (PROGRAMMER)
import { z } from "zod"; // Zod 스키마 타입 추론
import {
  getActiveTask, // 현재 활성 작업
  updateTaskPlanItems, // TaskPlan 항목 업데이트
} from "@openswe/shared/open-swe/tasks";
import {
  AIMessage, // AI 메시지 타입
  BaseMessage, // 메시지 기본 타입
  isAIMessage, // AI 메시지 타입 가드
  ToolMessage, // 도구 메시지 타입
} from "@langchain/core/messages";
import { getMessageString } from "../../../utils/message/content.js"; // 메시지 문자열 변환
import { formatPlanPrompt } from "../../../utils/plan-prompt.js"; // 계획 프롬프트 포맷팅
import { createLogger, LogLevel } from "../../../utils/logger.js"; // 로거 생성
import { createUpdatePlanToolFields } from "@openswe/shared/open-swe/tools"; // 계획 업데이트 도구 필드
import { formatCustomRulesPrompt } from "../../../utils/custom-rules.js"; // 커스텀 규칙 프롬프트 포맷팅
import { trackCachePerformance } from "../../../utils/caching.js"; // 캐싱 성능 추적
import { getModelManager } from "../../../utils/llms/model-manager.js"; // 모델 관리자
import { addTaskPlanToIssue } from "../../../utils/github/issue-task.js"; // GitHub 이슈 업데이트
import { shouldCreateIssue } from "../../../utils/should-create-issue.js"; // GitHub 이슈 생성 여부 판단
import { isLocalMode } from "@openswe/shared/open-swe/local-mode"; // 로컬 모드 확인

// 로거 인스턴스 생성
const logger = createLogger(LogLevel.INFO, "UpdatePlanNode");

/**
 * 계획 업데이트를 위한 시스템 프롬프트
 *
 * @description
 * LLM에게 계획 업데이트 규칙을 설명하고, 최소 변경 원칙을 강조합니다.
 *
 * 업데이트 규칙:
 * - 최소한의 변경만 수행
 * - 완료된 항목은 수정 불가
 * - 남은 항목만 추가/수정/삭제
 * - 모든 항목을 update_plan 도구에 전달 (미수정 항목 포함)
 *
 * @constant {string}
 */
const systemPrompt = `You are operating as an agentic coding assistant built by LangChain. You've decided that the current plan you're working through needs to be updated.
To aid in this process, you've generated some reasoning and additional context into which plan steps you should update, remove, or whether to add new step(s).

Here is the user's initial request which you used to generate the initial plan:
{USER_REQUEST}

Here is the full plan you generated, which should have changes made to it:
{PLAN}

Here is the reasoning and context you generated for which plan steps to update, remove, or add:
{REASONING}

Given this context, update, remove or add plan steps as needed.

You MUST adhere to the following criteria when generating the plan:
- Make as few changes as possible to the tasks, while still following the users request.
- You are only allowed to update plan items which are remaining, including the current task. Plan items which have already been completed are not allowed to be modified.
- The user will provide the full conversation history which led up to your deciding you need to update the plan. Use this conversation as context when making changes.
- The plan items listed above will include:
  - The index of the plan item. This is the order in which the plan items should be executed in.
  - The actual plan of the individual task.
  - If it's been completed, it will include a summary of the completed task.
- To update the plan, you MUST pass every updated/added/untouched plan item to the \`update_plan\` tool.
  - These will replace all of the existing plan items.
  - This means you still need to include all of the unmodified plan items in the \`update_plan\` tool call.
- You should call the \`update_plan\` tool, passing in each plan item in the order they should be executed in.
- To remove an item from the plan, you should not include it in the \`update_plan\` tool call.

{CUSTOM_RULES}

With all of this in mind, please call the \`update_plan\` tool with the updated plan.
`;

/**
 * 업데이트된 계획을 받는 도구 스키마
 *
 * @description
 * LLM이 반환할 새로운 계획 항목들의 Zod 스키마입니다.
 *
 * @constant {z.ZodObject}
 */
const updatePlanToolSchema = z.object({
  plan: z
    .array(z.string())
    .describe(
      "The updated, or new plan, including any changes to the plan items, as well as any new plan items you've added.",
    ),
});

/**
 * update_plan 도구 정의
 *
 * @description
 * 2단계 LLM 호출에서 실제 계획을 받는 도구입니다.
 * tool_choice로 강제 호출되어 반드시 계획을 생성합니다.
 *
 * @constant
 */
const updatePlanTool = {
  name: "update_plan",
  description:
    "The updated plan, including any changes to the plan items, as well as any new plan items you've added, and the unchanged plan items. This should NOT include any of the completed plan items.",
  schema: updatePlanToolSchema,
};

/**
 * update_plan_reasoning 도구 정의
 *
 * @description
 * 1단계 LLM 호출에서 사용되는 추론 도구입니다.
 * LLM이 왜 계획을 변경하는지 설명합니다.
 *
 * @constant
 */
const updatePlanReasoningTool = createUpdatePlanToolFields();

/**
 * 시스템 프롬프트를 포맷팅합니다
 *
 * @description
 * 사용자 요청, 현재 계획, 추론, 커스텀 규칙을 프롬프트에 삽입합니다.
 *
 * @param {string} userRequest - 사용자의 최초 요청
 * @param {string} reasoning - 1단계에서 생성된 업데이트 추론
 * @param {PlanItem[]} planItems - 현재 활성 계획 항목 배열
 * @param {CustomRules} [customRules] - 커스텀 규칙 (선택사항)
 * @returns {string} 포맷팅된 시스템 프롬프트
 */
const formatSystemPrompt = (
  userRequest: string,
  reasoning: string,
  planItems: PlanItem[],
  customRules?: CustomRules,
) => {
  return systemPrompt
    .replace("{USER_REQUEST}", userRequest)
    .replace("{PLAN}", formatPlanPrompt(planItems, { includeSummaries: true }))
    .replace("{REASONING}", reasoning)
    .replaceAll("{CUSTOM_RULES}", formatCustomRulesPrompt(customRules));
};

/**
 * 사용자 메시지를 포맷팅합니다
 *
 * @description
 * 전체 대화 기록을 컨텍스트로 제공합니다.
 *
 * @param {BaseMessage[]} messages - 내부 메시지 배열 (대화 기록)
 * @returns {string} 포맷팅된 사용자 메시지
 */
const formatUserMessage = (messages: BaseMessage[]): string => {
  return `Here is the full conversation history you should use as context when making changes to the plan:

${messages.map(getMessageString).join("\n")}`;
};

/**
 * 호출되지 않은 도구 호출을 제거합니다
 *
 * @description
 * 1단계에서는 여러 도구 호출이 있을 수 있지만,
 * update_plan_reasoning만 실제로 사용되므로 나머지를 제거합니다.
 *
 * @param {AIMessage} lastMessage - 마지막 AI 메시지
 * @returns {AIMessage} update_plan_reasoning 도구 호출만 포함한 메시지
 * @throws {Error} update_plan_reasoning 도구 호출을 찾을 수 없을 때
 */
function removeUncalledTools(lastMessage: AIMessage): AIMessage {
  if (!lastMessage.tool_calls?.length || lastMessage.tool_calls?.length === 1) {
    // 도구 호출이 없거나 1개만 있으면 그대로 반환
    return lastMessage;
  }

  const updatePlanReasoningToolCall = lastMessage.tool_calls?.find(
    (tc) => tc.name === updatePlanReasoningTool.name,
  );

  if (!updatePlanReasoningToolCall) {
    throw new Error("Update plan reasoning tool call not found.");
  }

  // update_plan_reasoning 도구 호출만 남기고 반환
  return new AIMessage({
    ...lastMessage,
    tool_calls: [updatePlanReasoningToolCall],
  });
}

/**
 * 실행 계획을 업데이트하는 노드 함수입니다
 *
 * @description
 * 두 단계의 LLM 호출을 사용하여 안전하게 계획을 업데이트합니다.
 * 1단계는 이미 완료되어 update_plan_reasoning 도구가 호출된 상태입니다.
 *
 * 처리 흐름:
 * 1. 마지막 메시지에서 update_plan_reasoning 도구 호출 검증
 * 2. PROGRAMMER 타입의 LLM 모델 로드
 * 3. update_plan 도구를 강제 호출하도록 모델 바인딩
 * 4. 시스템/사용자 프롬프트 구성 (추론 포함)
 * 5. LLM 호출하여 새 계획 생성
 * 6. 완료된 항목 + 새 항목 병합
 * 7. TaskPlan 업데이트
 * 8. GitHub 이슈 업데이트 (클라우드 모드)
 * 9. ToolMessage 생성 및 반환
 *
 * @param {GraphState} state - 현재 그래프 상태 (메시지, TaskPlan 포함)
 * @param {GraphConfig} config - 그래프 설정 (모델 설정 등)
 * @returns {Promise<GraphUpdate>} 업데이트된 계획 및 메시지를 포함한 상태 업데이트
 * @throws {Error} AI 메시지나 도구 호출을 찾을 수 없을 때
 *
 * @example
 * // 3개 항목 중 2개 수정하는 경우
 * const update = await updatePlan(state, config);
 * // => {
 * //   messages: [AIMessage, ToolMessage],
 * //   taskPlan: { plans: [완료1, 수정2, 수정3, 새항목4] }
 * // }
 */
export async function updatePlan(
  state: GraphState,
  config: GraphConfig,
): Promise<GraphUpdate> {
  // === 1단계: update_plan_reasoning 도구 호출 검증 ===
  const lastMessage = state.internalMessages[state.internalMessages.length - 1];

  if (!lastMessage || !isAIMessage(lastMessage) || !lastMessage.id) {
    throw new Error("Last message was not an AI message");
  }

  const updatePlanToolCall = lastMessage.tool_calls?.find(
    (tc) => tc.name === updatePlanReasoningTool.name,
  );
  const updatePlanToolCallId = updatePlanToolCall?.id;
  const updatePlanToolCallArgs = updatePlanToolCall?.args as z.infer<
    typeof updatePlanReasoningTool.schema
  >;

  if (!updatePlanToolCall || !updatePlanToolCallId || !updatePlanToolCallArgs) {
    throw new Error("Update plan with reasoning tool call not found.");
  }

  logger.info("Updating plan", {
    ...updatePlanToolCall,
  });

  // === 2단계: LLM 모델 로드 및 도구 바인딩 ===
  const model = await loadModel(config, LLMTask.PROGRAMMER);
  const modelManager = getModelManager();
  const modelName = modelManager.getModelNameForTask(
    config,
    LLMTask.PROGRAMMER,
  );
  const modelSupportsParallelToolCallsParam = supportsParallelToolCallsParam(
    config,
    LLMTask.PROGRAMMER,
  );

  // update_plan 도구를 강제 호출하도록 설정
  const modelWithTools = model.bindTools([updatePlanTool], {
    tool_choice: updatePlanTool.name, // 반드시 이 도구 사용
    ...(modelSupportsParallelToolCallsParam
      ? {
          parallel_tool_calls: false, // 병렬 호출 비활성화
        }
      : {}),
  });

  // === 3단계: 현재 활성 계획 항목 가져오기 ===
  const activeTask = getActiveTask(state.taskPlan);
  const request = activeTask.request;
  const activePlanItems = activeTask.planRevisions.find(
    (pr) => pr.revisionIndex === activeTask.activeRevisionIndex,
  )?.plans;

  if (!activePlanItems?.length) {
    throw new Error("No active plan items found.");
  }

  // === 4단계: 프롬프트 구성 ===
  const systemPrompt = formatSystemPrompt(
    request,
    updatePlanToolCallArgs.update_plan_reasoning, // 1단계에서 생성된 추론
    activePlanItems,
  );
  const userMessage = formatUserMessage(state.internalMessages);

  // === 5단계: LLM 호출하여 새 계획 생성 ===
  const response = await modelWithTools.invoke([
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: userMessage,
    },
  ]);

  const toolCall = response.tool_calls?.[0];
  if (!toolCall) {
    throw new Error("No tool call found.");
  }

  // === 6단계: 완료된 항목 + 새 항목 병합 ===
  const { plan } = toolCall.args as z.infer<typeof updatePlanToolSchema>;

  // 완료된 항목은 보존 (수정 불가)
  const completedPlanItems = activePlanItems.filter((item) => item.completed);
  const totalCompletedPlanItems = completedPlanItems.length;

  // 새 계획 항목에 인덱스 부여 (완료된 항목 다음부터)
  const newPlanItems: PlanItem[] = [
    ...completedPlanItems,
    ...plan.map((p, index) => ({
      index: totalCompletedPlanItems + index,
      plan: p,
      completed: false,
      summary: undefined,
    })),
  ];

  // === 7단계: TaskPlan 업데이트 ===
  const newTaskPlan = updateTaskPlanItems(
    state.taskPlan,
    activeTask.id,
    newPlanItems,
    "agent", // 에이전트가 업데이트했음을 표시
  );

  // === 8단계: GitHub 이슈 업데이트 (클라우드 모드만) ===
  if (!isLocalMode(config) && shouldCreateIssue(config)) {
    await addTaskPlanToIssue(
      {
        githubIssueId: state.githubIssueId,
        targetRepository: state.targetRepository,
      },
      config,
      newTaskPlan,
    );
  }

  // === 9단계: ToolMessage 생성 ===
  const toolMessage = new ToolMessage({
    id: uuidv4(),
    tool_call_id: updatePlanToolCallId,
    content:
      "Successfully updated the plan. The complete updated plan items are as follow:\n\n" +
      newPlanItems
        .map(
          (p) =>
            `<plan-item completed="${p.completed}" index="${p.index}">${p.plan}</plan-item>`,
        )
        .join("\n"),
  });

  // === 10단계: 상태 업데이트 반환 ===
  return {
    messages: [removeUncalledTools(lastMessage), toolMessage],
    internalMessages: [removeUncalledTools(lastMessage), toolMessage],
    taskPlan: newTaskPlan,
    tokenData: trackCachePerformance(response, modelName),
  };
}
