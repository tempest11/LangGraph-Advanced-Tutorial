/**
 * @file 추가 컨텍스트 필요 여부 판단 노드
 * @description
 * Planner 그래프의 핵심 라우팅 노드로, 사용자 후속 요청이 계획 업데이트에
 * 추가 컨텍스트 수집이 필요한지 LLM에게 판단시킵니다.
 *
 * 주요 기능:
 * 1. LLM에게 대화 히스토리, 컨텍스트 노트, 제안된 계획, 사용자 요청 제공
 * 2. LLM이 "have_context" 또는 "need_context" 결정
 * 3. need_context → generate-plan-context-action (컨텍스트 수집)
 * 4. have_context → generate-plan (바로 계획 업데이트)
 *
 * 사용 시점:
 * - 사용자가 제안된 계획에 대해 후속 요청을 했을 때
 * - 예: "Step 2를 더 자세히 설명해줘", "새로운 기능 추가해줘"
 */

// === LangGraph ===
import { Command } from "@langchain/langgraph"; // 다음 노드로 이동하는 Command 객체

// === Planner 타입 ===
import {
  PlannerGraphState, // Planner 그래프 상태 타입
  PlannerGraphUpdate, // Planner 그래프 업데이트 타입
} from "@openswe/shared/open-swe/planner/types";

// === 타입 정의 ===
import { GraphConfig } from "@openswe/shared/open-swe/types"; // LangGraph 설정 객체

// === Zod 스키마 ===
import { z } from "zod"; // TypeScript 타입 검증 라이브러리

// === LLM 유틸리티 ===
import {
  loadModel, // LLM 모델 로드
  supportsParallelToolCallsParam, // 병렬 도구 호출 지원 여부
} from "../../../utils/llms/index.js";
import { LLMTask } from "@openswe/shared/open-swe/llm-task"; // LLM 태스크 타입 (ROUTER, PLANNER 등)
import { getModelManager } from "../../../utils/llms/model-manager.js"; // 모델 매니저

// === GitHub 메시지 ===
import { getMissingMessages } from "../../../utils/github/issue-messages.js"; // 아직 추가되지 않은 메시지 가져오기

// === 메시지 유틸리티 ===
import { getMessageString } from "../../../utils/message/content.js"; // 메시지를 문자열로 변환
import { isHumanMessage } from "@langchain/core/messages"; // HumanMessage 타입 가드
import { getMessageContentString } from "@openswe/shared/messages"; // 메시지 컨텐츠를 문자열로 변환
import { filterHiddenMessages } from "../../../utils/message/filter-hidden.js"; // hidden=true 메시지 제외

// === 로깅 및 캐싱 ===
import { createLogger, LogLevel } from "../../../utils/logger.js"; // 구조화된 로거
import { trackCachePerformance } from "../../../utils/caching.js"; // 프롬프트 캐싱 성능 추적

// === 이슈 생성 여부 ===
import { shouldCreateIssue } from "../../../utils/should-create-issue.js"; // 이슈 생성이 필요한지 확인

// === 로거 인스턴스 ===
const logger = createLogger(LogLevel.INFO, "DetermineNeedsContext");

/**
 * LLM에게 제공할 시스템 프롬프트
 *
 * @description
 * 사용자 후속 요청이 추가 컨텍스트 수집을 필요로 하는지 판단하도록 LLM을 지시합니다.
 *
 * 제공 정보:
 * - CONVERSATION_HISTORY: 전체 대화 히스토리
 * - CONTEXT_GATHERING_NOTES: 컨텍스트 수집 중 작성한 노트
 * - PROPOSED_PLAN: 제안된 계획
 * - USER_FOLLOWUP_REQUEST: 사용자 후속 요청
 *
 * LLM 판단 기준:
 * - 이미 충분한 컨텍스트가 있으면 → "have_context"
 * - 추가 컨텍스트 수집이 필요하면 → "need_context"
 */
const SYSTEM_PROMPT = `You are a terminal-based agentic coding assistant built by LangChain that enables natural language interaction with local codebases. You excel at being precise, safe, and helpful in your analysis.

<role>
Context Gathering Assistant - Read-Only Phase
</role>

<primary_objective>
Your sole objective in this step is to determine whether or not the user's followup request requires additional context to be gathered in order to update the plan/add additional steps to the plan.
</primary_objective>

<instructions>
You're provided with these main pieces of information:
- **Conversation history**: This is the full conversation history between you, the user, and including any actions you took while gathering context.
- **Context gathering notes**: This is the notes you took while gathering context. Includes the most relevant context you discovered while gathering context for the plan.
- **Proposed plan**: This is the plan you generated for the user's request, which the user is likely trying to follow up on (e.g. modify it in some way, or add new step(s)).
- **User followup request**: This is the specific followup request made by the user (the conversation history will also include this). This is the message you should look at when determining whether or not you need to gather more context before you can update the proposed plan.

Given this information, carefully read over it all and determine whether or not you need to gather more context before you can update the proposed plan.
You may already have enough context from the conversation history and the actions you executed, or the notes you took while gathering context, to update the proposed plan.

The state of the repository has NOT changed since you last gathered context & proposed the plan.

To make your decision, you must first provide reasoning for why you need to gather more context, or why you already have enough context. Then, make your decision.
Both of these steps should be executed by calling the \`determine_context\` tool.
</instructions>

<conversation_history>
{CONVERSATION_HISTORY}
</conversation_history>

<context_gathering_notes>
{CONTEXT_GATHERING_NOTES}
</context_gathering_notes>

<proposed_plan>
{PROPOSED_PLAN}
</proposed_plan>

<user_followup_request>
{USER_FOLLOWUP_REQUEST}
</user_followup_request>

<determine_context>
Once again, with all of the above information, determine whether or not you need to gather more context before you can accurately update the proposed plan.
</determine_context>
`;

/**
 * 시스템 프롬프트 포맷팅 함수
 *
 * @description
 * SYSTEM_PROMPT 템플릿에 실제 상태 값을 채워 넣습니다.
 *
 * 처리 과정:
 * 1. 메시지들을 문자열로 변환 (CONVERSATION_HISTORY)
 * 2. 제안된 계획을 번호 매긴 리스트로 변환 (PROPOSED_PLAN)
 * 3. 마지막 HumanMessage 추출 (USER_FOLLOWUP_REQUEST)
 * 4. 템플릿 변수 치환
 *
 * @param {PlannerGraphState} state - Planner 그래프 상태
 * @returns {string} 포맷팅된 시스템 프롬프트
 * @throws {Error} 사용자 후속 요청을 찾을 수 없을 때
 */
function formatSystemPrompt(state: PlannerGraphState): string {
  // 메시지 히스토리를 문자열로 변환
  const formattedConversationHistoryPrompt = state.messages
    .map(getMessageString)
    .join("\n");

  // 제안된 계획을 번호 매긴 리스트로 변환
  const formattedProposedPlan = state.proposedPlan
    .map((p, index) => `  ${index + 1}. ${p}`)
    .join("\n");

  // 마지막 사용자 메시지 추출 (후속 요청)
  const userFollowupRequestMsg = state.messages.findLast(isHumanMessage);
  if (!userFollowupRequestMsg) {
    throw new Error("User followup request not found.");
  }
  const userFollowupRequestStr = getMessageContentString(
    userFollowupRequestMsg.content,
  );

  // 템플릿 변수 치환
  return SYSTEM_PROMPT.replace(
    "{CONVERSATION_HISTORY}",
    formattedConversationHistoryPrompt,
  )
    .replace("{CONTEXT_GATHERING_NOTES}", state.contextGatheringNotes)
    .replace("{PROPOSED_PLAN}", formattedProposedPlan)
    .replace("{USER_FOLLOWUP_REQUEST}", userFollowupRequestStr);
}

/**
 * LLM 응답 스키마 정의
 *
 * @description
 * LLM이 반환해야 하는 구조화된 출력 형식을 정의합니다.
 *
 * @property {string} reasoning - 판단 근거
 * @property {"have_context" | "need_context"} decision - 최종 결정
 */
const determineContextSchema = z.object({
  reasoning: z
    .string()
    .describe(
      "The reasoning for whether or not you have enough context to update the proposed plan, or why you need to gather more context before you can update the proposed plan.",
    ),
  decision: z
    .enum(["have_context", "need_context"])
    .describe(
      "Whether or not you have enough context to update the proposed plan, or if you need to gather more context before you can accurately update the proposed plan. " +
        "If you have enough context to update the plan, respond with 'have_context'. " +
        "If you need to gather more context, respond with 'need_context'.",
    ),
});

/**
 * LLM 도구 정의
 *
 * @description
 * LLM이 호출할 `determine_context` 도구를 정의합니다.
 * tool_choice로 이 도구만 강제 호출하게 설정됩니다.
 */
const determineContextTool = {
  name: "determine_context",
  description:
    "Determine whether or not you have enough context to update the proposed plan, or if you need to gather more context before you can accurately update the proposed plan.",
  schema: determineContextSchema,
};

/**
 * 추가 컨텍스트 필요 여부 판단 노드
 *
 * @description
 * 사용자 후속 요청이 계획 업데이트에 추가 컨텍스트 수집이 필요한지 LLM에게 판단시킵니다.
 * LLM의 결정에 따라 다음 노드를 동적으로 결정합니다.
 *
 * 처리 흐름:
 * 1. 누락된 GitHub 메시지 가져오기 (있을 경우)
 * 2. ROUTER 태스크용 LLM 모델 로드
 * 3. LLM에게 determine_context 도구 강제 호출 설정
 * 4. 포맷팅된 프롬프트로 LLM 호출
 * 5. LLM 응답에서 decision 추출
 * 6. need_context → generate-plan-context-action (컨텍스트 수집)
 *    have_context → generate-plan (바로 계획 업데이트)
 *
 * @param {PlannerGraphState} state - Planner 그래프 상태
 * @param {GraphConfig} config - LangGraph 설정
 * @returns {Promise<Command>} 다음 노드로 이동하는 Command
 *   - goto: "generate-plan-context-action" 또는 "generate-plan"
 *   - update: 누락된 메시지 및 토큰 데이터
 * @throws {Error} 누락된 메시지가 없을 때 (이 노드가 잘못 호출됨)
 * @throws {Error} LLM이 도구 호출을 하지 않았을 때
 *
 * @example
 * // 사용자가 계획 수정 요청:
 * // "Step 2를 더 자세히 설명해줘"
 * // → LLM이 현재 컨텍스트로 충분하다고 판단 → "have_context"
 * // → generate-plan으로 이동
 *
 * // 사용자가 새 기능 추가 요청:
 * // "새로운 인증 기능도 추가해줘"
 * // → LLM이 추가 컨텍스트가 필요하다고 판단 → "need_context"
 * // → generate-plan-context-action으로 이동
 */
export async function determineNeedsContext(
  state: PlannerGraphState,
  config: GraphConfig,
): Promise<Command> {
  // === 1단계: 누락된 메시지와 LLM 모델 병렬로 가져오기 ===
  const [missingMessages, model] = await Promise.all([
    shouldCreateIssue(config) ? getMissingMessages(state, config) : [],
    loadModel(config, LLMTask.ROUTER), // ROUTER 태스크용 모델 (라우팅 결정)
  ]);

  const modelManager = getModelManager();
  const modelName = modelManager.getModelNameForTask(config, LLMTask.ROUTER);

  // === 2단계: 누락된 메시지 검증 ===
  // 이 노드는 사용자 후속 요청이 있을 때만 호출되어야 함
  if (!missingMessages.length) {
    throw new Error(
      "Can not determine if more context is needed if there are no missing messages.",
    );
  }

  // === 3단계: LLM에 도구 바인딩 ===
  const modelSupportsParallelToolCallsParam = supportsParallelToolCallsParam(
    config,
    LLMTask.ROUTER,
  );

  const modelWithTools = model.bindTools([determineContextTool], {
    tool_choice: determineContextTool.name, // determine_context 도구만 강제 호출
    ...(modelSupportsParallelToolCallsParam
      ? {
          parallel_tool_calls: false, // 병렬 도구 호출 비활성화 (하나만 호출)
        }
      : {}),
  });

  // === 4단계: LLM 호출 ===
  const response = await modelWithTools.invoke([
    {
      role: "user",
      content: formatSystemPrompt({
        ...state,
        // hidden 메시지 제외 + 누락된 메시지 추가
        messages: [...filterHiddenMessages(state.messages), ...missingMessages],
      }),
    },
  ]);

  // === 5단계: 도구 호출 결과 검증 ===
  const toolCall = response.tool_calls?.[0];
  if (!toolCall) {
    throw new Error("No tool call found.");
  }

  // === 6단계: Command 업데이트 준비 ===
  const commandUpdate: PlannerGraphUpdate = {
    messages: missingMessages, // 누락된 메시지 추가
    tokenData: trackCachePerformance(response, modelName), // 프롬프트 캐싱 성능 추적
  };

  // === 7단계: LLM 결정에 따라 다음 노드 선택 ===
  const shouldGatherContext =
    (toolCall.args as z.infer<typeof determineContextSchema>).decision ===
    "need_context";

  logger.info(
    "Determined whether or not additional context is needed to update plan",
    {
      ...toolCall.args, // reasoning과 decision 로깅
    },
  );

  // === 8단계: 다음 노드로 이동 ===
  return new Command({
    goto: shouldGatherContext
      ? "generate-plan-context-action" // 컨텍스트 수집 필요
      : "generate-plan", // 바로 계획 업데이트
    update: commandUpdate,
  });
}
