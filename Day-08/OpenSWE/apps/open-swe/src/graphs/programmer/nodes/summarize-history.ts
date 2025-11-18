/**
 * @file Programmer의 대화 히스토리 요약 노드
 * @description
 * 토큰 한계에 도달했을 때 대화 기록을 LLM으로 요약하여 공간을 확보하는 노드입니다.
 * 마지막 요약 이후의 메시지들을 압축하여 중요한 컨텍스트만 유지합니다.
 *
 * 주요 기능:
 * - 마지막 요약 이후 메시지 추출 (마지막 20개 제외)
 * - LLM을 사용한 컨텍스트 압축
 * - 중요한 정보만 보존 (파일 경로, 인사이트, 학습 내용)
 * - RemoveMessage로 원본 메시지 제거 및 요약으로 대체
 * - 프롬프트 캐싱 성능 추적
 *
 * 요약 기준:
 * - 관련 파일의 전체 경로 포함
 * - 파일 요약/스니펫 포함 (전체 파일 제외)
 * - 코드베이스 인사이트 및 학습 내용
 * - 중복 제거 및 단일 항목으로 병합
 */

// 외부 라이브러리
import { v4 as uuidv4 } from "uuid"; // UUID 생성

// Open SWE 공유 타입
import {
  GraphConfig, // LangGraph 설정 타입
  GraphState, // 그래프 전역 상태 타입
  GraphUpdate, // 상태 업데이트 타입
  PlanItem, // 개별 계획 항목 타입
} from "@openswe/shared/open-swe/types";

// 유틸리티 함수
import { loadModel } from "../../../utils/llms/index.js"; // LLM 모델 로더
import { LLMTask } from "@openswe/shared/open-swe/llm-task"; // LLM 작업 타입 (SUMMARIZER)
import {
  AIMessage, // AI 메시지 타입
  BaseMessage, // 메시지 기본 타입
  RemoveMessage, // 메시지 제거 명령
  ToolMessage, // 도구 메시지 타입
} from "@langchain/core/messages";
import { formatPlanPrompt } from "../../../utils/plan-prompt.js"; // 계획 프롬프트 포맷팅
import { createLogger, LogLevel } from "../../../utils/logger.js"; // 로거 생성
import { getMessageContentString } from "@openswe/shared/messages"; // 메시지 내용 추출
import { getMessageString } from "../../../utils/message/content.js"; // 메시지 문자열 변환
import { getActivePlanItems } from "@openswe/shared/open-swe/tasks"; // 활성 계획 항목 목록
import { createConversationHistorySummaryToolFields } from "@openswe/shared/open-swe/tools"; // 요약 도구 필드
import { formatUserRequestPrompt } from "../../../utils/user-request.js"; // 사용자 요청 프롬프트 포맷팅
import { getMessagesSinceLastSummary } from "../../../utils/tokens.js"; // 마지막 요약 이후 메시지 추출
import { trackCachePerformance } from "../../../utils/caching.js"; // 캐싱 성능 추적
import { getModelManager } from "../../../utils/llms/model-manager.js"; // 모델 관리자

/**
 * 단일 사용자 요청 프롬프트 템플릿
 *
 * @description
 * 최초 요청만 있는 경우 사용되는 템플릿입니다.
 *
 * @constant {string}
 */
const SINGLE_USER_REQUEST_PROMPT = `Here is the user's request:
<user_request>
{USER_REQUEST}
</user_request>`;

/**
 * Followup 요청 프롬프트 템플릿
 *
 * @description
 * 사용자가 후속 요청을 보낸 경우 최초 요청과 함께 표시됩니다.
 *
 * @constant {string}
 */
const USER_SENDING_FOLLOWUP_PROMPT = `Here is the user's initial request:
<user_initial_request>
{USER_REQUEST}
</user_initial_request>

And here is the user's followup request you're now processing:
<user_followup_request>
{USER_FOLLOWUP_REQUEST}
</user_followup_request>`;

/**
 * 대화 히스토리 요약을 위한 시스템 프롬프트
 *
 * @description
 * LLM에게 컨텍스트 추출 역할을 부여하고, 중요한 정보만 압축하도록 안내합니다.
 *
 * 요약 기준:
 * - 관련 파일의 전체 경로 포함
 * - 파일 요약/스니펫 (전체 파일 제외)
 * - 코드베이스 인사이트 및 학습 내용
 * - 중복 제거 및 병합
 *
 * @constant {string}
 */
const taskSummarySysPrompt = `You are operating as a terminal-based agentic coding assistant built by LangChain. It wraps LLM models to enable natural language interaction with a local codebase. You are expected to be precise, safe, and helpful.

<role>
Context Extraction Assistant
</role>

<primary_objective>
Your sole objective in this task is to extract the highest quality/most relevant context from the conversation history below.
</primary_objective>

<objective_information>
You're nearing the total number of input tokens you can accept, so you must extract the highest quality/most relevant pieces of information from your conversation history.
This context will then overwrite the conversation history presented below. Because of this, ensure the context you extract is only the most important information to your overall goal.
To aid with this, you'll be provided with the user's request, as well as all of the tasks in the plan you generated to fulfil the user's request. Additionally, if a task has already been completed you'll be provided with the summary of the steps taken to complete it.
</objective_information>

{USER_REQUEST_PROMPT}

Here is the full list of tasks in the plan you're in the middle of, as well as the summary of the completed tasks:
<tasks_and_summaries>
{PLAN_PROMPT}
</tasks_and_summaries>

<instructions>
The conversation history below will be replaced with the context you extract in this step. Because of this, you must do your very best to extract and record all of the most important context from the conversation history.
You want to ensure that you don't repeat any actions you've already completed (e.g. file search operations, checking codebase information, etc.), so the context you extract from the conversation history should be focused on the most important information to your overall goal.

You MUST adhere to the following criteria when extracting the most important context from the conversation history:
  - Include full file paths for all relevant files to the users request & tasks.
  - Include file summaries/snippets from the relevant files. Avoid including entire files as you're trying to condense the conversation history.
  - Include insights, and learnings you've discovered about the codebase or specific files while completing the task.
  - Only record information once, and avoid duplications. Duplicate information or actions in the conversation history should be merged into a single entry.
</instructions>

Here is the full conversation history you'll be extracting context from, to then replace. Carefully read over it all, and think deeply about what information is most important to your overall goal that should be saved:
<conversation_history>
{CONVERSATION_HISTORY}
</conversation_history>

With all of this in mind, please carefully read over the entire conversation history, and extract the most important and relevant context to replace it so that you can free up space in the conversation history.
Respond ONLY with the extracted context. Do not include any additional information, or text before or after the extracted context.
`;

// 로거 인스턴스 생성
const logger = createLogger(LogLevel.INFO, "SummarizeConversationHistory");

/**
 * 요약 프롬프트를 포맷팅합니다
 *
 * @description
 * 사용자 요청, 계획 항목, 대화 기록을 시스템 프롬프트에 삽입합니다.
 *
 * @param {Object} inputs - 프롬프트 입력 데이터
 * @param {BaseMessage[]} inputs.messages - 사용자 메시지 (요청 추출용)
 * @param {PlanItem[]} inputs.plan - 활성 계획 항목 배열
 * @param {BaseMessage[]} inputs.conversationHistoryToSummarize - 요약할 대화 기록
 * @returns {string} 포맷팅된 시스템 프롬프트
 */
const formatPrompt = (inputs: {
  messages: BaseMessage[];
  plan: PlanItem[];
  conversationHistoryToSummarize: BaseMessage[];
}): string => {
  return taskSummarySysPrompt
    .replace(
      "{PLAN_PROMPT}",
      formatPlanPrompt(inputs.plan, {
        useLastCompletedTask: true, // 마지막 완료 작업 포함
        includeSummaries: true, // 작업 요약 포함
      }),
    )
    .replace(
      "{USER_REQUEST_PROMPT}",
      formatUserRequestPrompt(
        inputs.messages,
        SINGLE_USER_REQUEST_PROMPT,
        USER_SENDING_FOLLOWUP_PROMPT,
      ),
    )
    .replace(
      "{CONVERSATION_HISTORY}",
      inputs.conversationHistoryToSummarize.map(getMessageString).join("\n"),
    );
};

/**
 * 요약 메시지 쌍(AI + Tool)을 생성합니다
 *
 * @description
 * 요약 과정을 나타내는 더미 AI 메시지와
 * 실제 요약 내용을 담은 ToolMessage를 생성합니다.
 *
 * 두 메시지 모두 summary_message: true 플래그를 포함하여
 * 다음 요약 시 이 지점부터 시작하도록 마킹합니다.
 *
 * @param {string} summary - LLM이 생성한 요약 텍스트
 * @returns {BaseMessage[]} [AIMessage, ToolMessage] 쌍
 */
function createSummaryMessages(summary: string): BaseMessage[] {
  const dummySummarizeHistoryToolName =
    createConversationHistorySummaryToolFields().name;
  const dummySummarizeHistoryToolCallId = uuidv4();

  return [
    // AI 메시지: 요약 작업 시작 표시
    new AIMessage({
      id: uuidv4(),
      content:
        "Looks like I'm running out of tokens. I'm going to summarize the conversation history to free up space.",
      tool_calls: [
        {
          id: dummySummarizeHistoryToolCallId,
          name: dummySummarizeHistoryToolName,
          args: {
            reasoning:
              "I'm running out of tokens. I'm going to summarize all of the messages since my last summary message to free up space.",
          },
        },
      ],
      additional_kwargs: {
        summary_message: true, // 요약 메시지 마커
      },
    }),
    // Tool 메시지: 실제 요약 내용
    new ToolMessage({
      id: uuidv4(),
      tool_call_id: dummySummarizeHistoryToolCallId,
      content: summary,
      additional_kwargs: {
        summary_message: true, // 요약 메시지 마커
      },
    }),
  ];
}

/**
 * 대화 히스토리를 요약하여 토큰을 절약하는 노드 함수입니다
 *
 * @description
 * 토큰 한계에 도달했을 때 호출됩니다.
 * 마지막 요약 이후의 메시지들을 LLM으로 압축하고,
 * RemoveMessage로 원본을 제거한 뒤 요약으로 대체합니다.
 *
 * 처리 흐름:
 * 1. SUMMARIZER 타입의 LLM 모델 로드
 * 2. 마지막 요약 이후 메시지 추출 (마지막 20개 제외)
 * 3. 프롬프트 구성 (사용자 요청, 계획, 대화 기록)
 * 4. LLM 호출하여 컨텍스트 압축
 * 5. 요약 메시지 쌍 생성 (AI + Tool)
 * 6. RemoveMessage로 원본 메시지 제거
 * 7. 요약 메시지로 대체
 *
 * @param {GraphState} state - 현재 그래프 상태 (메시지, TaskPlan 포함)
 * @param {GraphConfig} config - 그래프 설정 (모델 설정 등)
 * @returns {Promise<GraphUpdate>} 요약 메시지 및 제거 명령을 포함한 상태 업데이트
 *
 * @example
 * // 100개 메시지를 요약하여 2개 메시지로 압축
 * const update = await summarizeHistory(state, config);
 * // => {
 * //   messages: [AIMessage, ToolMessage],
 * //   internalMessages: [RemoveMessage×100, AIMessage, ToolMessage]
 * // }
 */
export async function summarizeHistory(
  state: GraphState,
  config: GraphConfig,
): Promise<GraphUpdate> {
  // === 1단계: LLM 모델 로드 ===
  const model = await loadModel(config, LLMTask.SUMMARIZER);
  const modelManager = getModelManager();
  const modelName = modelManager.getModelNameForTask(
    config,
    LLMTask.SUMMARIZER,
  );

  // === 2단계: 요약 대상 메시지 추출 ===
  const plan = getActivePlanItems(state.taskPlan);

  // 마지막 요약 이후 메시지들 가져오기 (마지막 20개는 항상 유지)
  const conversationHistoryToSummarize = await getMessagesSinceLastSummary(
    state.internalMessages,
    {
      excludeHiddenMessages: true, // 숨김 메시지 제외
      excludeCountFromEnd: 20, // 마지막 20개 메시지는 요약 안 함
    },
  );

  logger.info(
    `Summarizing ${conversationHistoryToSummarize.length} messages in the conversation history...`,
  );

  // === 3단계: LLM 호출하여 요약 생성 ===
  const response = await model.invoke([
    {
      role: "user",
      content: formatPrompt({
        messages: state.messages,
        plan,
        conversationHistoryToSummarize,
      }),
    },
  ]);

  // === 4단계: 요약 메시지 생성 ===
  const summaryString = getMessageContentString(response.content);
  const summaryMessages = createSummaryMessages(summaryString);

  // === 5단계: 원본 메시지 제거 및 요약으로 대체 ===
  const newInternalMessages = [
    // 요약된 메시지들을 RemoveMessage로 제거
    ...conversationHistoryToSummarize.map(
      (m) => new RemoveMessage({ id: m.id ?? "" }),
    ),
    // 요약 메시지 쌍 추가
    ...summaryMessages,
  ];

  logger.info(
    `Summarized ${conversationHistoryToSummarize.length} messages in the conversation history. Removing and replacing with a summary message.`,
  );

  // === 6단계: 상태 업데이트 반환 ===
  return {
    messages: summaryMessages, // 사용자에게 보여줄 메시지
    internalMessages: newInternalMessages, // 제거 명령 + 요약 메시지
    tokenData: trackCachePerformance(response, modelName), // 캐싱 성능 데이터
  };
}
