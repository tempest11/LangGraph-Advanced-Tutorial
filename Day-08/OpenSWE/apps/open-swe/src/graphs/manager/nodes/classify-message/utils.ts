/**
 * @file 메시지 분류 유틸리티 함수
 * @description
 * 메시지 분류를 위한 동적 프롬프트 및 스키마 생성 로직을 제공합니다.
 *
 * 주요 기능:
 * 1. 메시지를 LLM이 이해할 수 있는 형식으로 변환
 * 2. 현재 시스템 상태(Planner/Programmer 실행 여부)에 따라 가능한 라우트 결정
 * 3. 동적 프롬프트 생성 (상태, 대화 이력, 작업 계획 포함)
 * 4. 가능한 라우트에 맞는 Zod 스키마 생성
 *
 * 핵심 함수:
 * - formatMessageForClassification: 메시지를 LLM용 문자열로 변환
 * - createClassificationPromptAndToolSchema: 상황별 프롬프트/스키마 생성
 */

// 작업 계획 타입
import { TaskPlan } from "@openswe/shared/open-swe/types";

// LangChain 메시지 타입 및 타입 가드 함수
import {
  AIMessage,        // AI 응답 메시지
  BaseMessage,      // 모든 메시지의 기본 타입
  isAIMessage,      // AIMessage 타입 확인
  isHumanMessage,   // HumanMessage 타입 확인
  isToolMessage,    // ToolMessage 타입 확인
  ToolMessage,      // 도구 실행 결과 메시지
} from "@langchain/core/messages";

// Zod 스키마 타입
import { z } from "zod";

// 메시지 배열에서 마지막 HumanMessage 제거 함수
import { removeLastHumanMessage } from "../../../../utils/message/modify-array.js";

// 작업 계획을 포맷팅하는 함수
import { formatPlanPrompt } from "../../../../utils/plan-prompt.js";

// 작업 계획에서 활성 항목만 추출하는 함수
import { getActivePlanItems } from "@openswe/shared/open-swe/tasks";

// 메시지 타입별 문자열 변환 함수
import {
  getHumanMessageString,    // HumanMessage → 문자열
  getToolMessageString,      // ToolMessage → 문자열
  getUnknownMessageString,   // 기타 메시지 → 문자열
} from "../../../../utils/message/content.js";

// 메시지 콘텐츠를 문자열로 추출
import { getMessageContentString } from "@openswe/shared/messages";

// LangGraph 스레드 상태 타입
import { ThreadStatus } from "@langchain/langgraph-sdk";

// 프롬프트 템플릿 및 라우팅 옵션 설명 상수
import {
  CLASSIFICATION_SYSTEM_PROMPT,                  // 메인 시스템 프롬프트
  CONVERSATION_HISTORY_PROMPT,                   // 대화 이력 섹션 프롬프트
  CREATE_NEW_ISSUE_ROUTING_OPTION,               // 새 이슈 생성 옵션 설명
  UPDATE_PLANNER_ROUTING_OPTION,                 // Planner 업데이트 옵션 설명
  UPDATE_PROGRAMMER_ROUTING_OPTION,              // Programmer 업데이트 옵션 설명
  PROPOSED_PLAN_PROMPT,                          // 제안된 계획 섹션 프롬프트
  RESUME_AND_UPDATE_PLANNER_ROUTING_OPTION,      // Planner 재개 옵션 설명
  START_PLANNER_ROUTING_OPTION,                  // Planner 시작 옵션 설명
  TASK_PLAN_PROMPT,                              // 작업 계획 섹션 프롬프트
  START_PLANNER_FOR_FOLLOWUP_ROUTING_OPTION,     // 후속 Planner 시작 옵션 설명
} from "./prompts.js";

// 분류 스키마 생성 함수
import { createClassificationSchema } from "./schemas.js";

// 요청 소스 타입 (웹훅, CLI 등)
import { RequestSource } from "../../../../constants.js";

/**
 * 스레드 상태를 사람이 읽기 쉬운 한글 문자열로 매핑하는 맵
 *
 * @description
 * LangGraph 스레드의 상태 코드를 LLM이 이해할 수 있는 자연어로 변환합니다.
 * 이 문자열은 분류 프롬프트에 포함되어 LLM이 현재 상태를 파악하는 데 사용됩니다.
 *
 * @constant
 */
const THREAD_STATUS_READABLE_STRING_MAP = {
  not_started: "시작되지 않음",                      // 아직 실행되지 않음
  busy: "현재 실행 중",                              // 활발히 실행 중
  idle: "실행 중이 아님",                            // 완료되었거나 대기 중
  interrupted: "중단됨 -- 사용자 응답 대기 중",      // Human-in-the-loop 대기
  error: "오류",                                     // 오류 발생
};

/**
 * 메시지를 LLM 분류에 적합한 형식의 문자열로 변환하는 함수
 *
 * @description
 * 다양한 타입의 메시지(Human, AI, Tool)를 LLM이 이해하기 쉬운
 * 일관된 형식의 문자열로 변환합니다. 이 문자열은 분류 프롬프트의
 * 대화 이력 부분에 포함됩니다.
 *
 * 처리하는 메시지 타입:
 * 1. **HumanMessage**: 사용자 입력
 * 2. **AIMessage**: AI 응답 (도구 호출 포함)
 * 3. **ToolMessage**: 도구 실행 결과
 * 4. **기타**: 알 수 없는 메시지 타입
 *
 * @param {BaseMessage} message - 변환할 LangChain 메시지 객체
 *
 * @returns {string} LLM용으로 형식화된 메시지 문자열
 *
 * @example
 * // HumanMessage 예시
 * formatMessageForClassification(humanMsg)
 * // 출력: "<user message-id=123>\n안녕하세요\n</user>"
 *
 * // AIMessage with tool call 예시
 * formatMessageForClassification(aiMsg)
 * // 출력: "<assistant message-id=456>\n내용: 작업을 시작합니다\n도구 호출: start_planner\n...</assistant>"
 */
function formatMessageForClassification(message: BaseMessage): string {
  // HumanMessage 처리 - 사용자 입력
  if (isHumanMessage(message)) {
    // 표준 형식으로 변환 (예: <user>...</user>)
    return getHumanMessageString(message);
  }

  // AIMessage 처리 - AI 응답 (동적 상태 표시 제외)
  // 분류 시에는 정적인 내용만 필요하므로 상태 정보는 생략
  if (isAIMessage(message)) {
    const aiMessage = message as AIMessage;

    // 도구 호출 정보 추출 (있을 경우)
    const toolCallName = aiMessage.tool_calls?.[0]?.name;           // 호출한 도구 이름
    const toolCallResponseStr = aiMessage.tool_calls?.[0]?.args?.response;  // 도구 응답

    // 도구 호출이 있으면 형식화된 문자열 생성
    const toolCallStr =
      toolCallName && toolCallResponseStr
        ? `도구 호출: ${toolCallName}\n인수: ${JSON.stringify({ response: toolCallResponseStr }, null)}\n`
        : "";  // 도구 호출이 없으면 빈 문자열

    // 메시지 본문 내용 추출
    const content = getMessageContentString(aiMessage.content);

    // AI 메시지를 <assistant> 태그로 감싸서 반환
    return `<assistant message-id=${aiMessage.id ?? "ID 없음"}>\n내용: ${content}\n${toolCallStr}</assistant>`;
  }

  // ToolMessage 처리 - 도구 실행 결과
  if (isToolMessage(message)) {
    const toolMessage = message as ToolMessage;
    // 표준 형식으로 변환 (예: <tool>...</tool>)
    return getToolMessageString(toolMessage);
  }

  // 기타 알 수 없는 메시지 타입 처리
  // (예: SystemMessage, FunctionMessage 등)
  return getUnknownMessageString(message);
}

/**
 * 현재 시스템 상태에 따라 동적으로 분류 프롬프트와 Zod 스키마를 생성하는 핵심 함수
 *
 * @description
 * 이 함수는 Planner/Programmer의 실행 상태, 대화 이력, 작업 계획 등을
 * 분석하여 현재 상황에 맞는 분류 프롬프트와 Zod 스키마를 동적으로 생성합니다.
 *
 * 주요 처리 단계:
 * 1. **컨텍스트 준비**: 대화 이력, 작업 계획, 제안된 계획 포맷팅
 * 2. **상태 분석**: Planner/Programmer의 실행 상태 확인
 * 3. **라우팅 옵션 결정**: 현재 상태에서 가능한 라우트 목록 생성
 * 4. **프롬프트 조립**: 템플릿에 동적 값 삽입
 * 5. **스키마 생성**: 가능한 라우트 옵션으로 Zod 스키마 생성
 *
 * 가능한 라우팅 옵션:
 * - **update_programmer**: Programmer가 실행 중일 때
 * - **start_planner**: Planner가 시작되지 않았을 때
 * - **start_planner_for_followup**: Planner와 Programmer가 모두 idle일 때
 * - **update_planner**: Planner가 실행 중일 때
 * - **resume_and_update_planner**: Planner가 중단되었을 때
 * - **create_new_issue**: 에이전트가 이미 실행 중일 때 (병렬 작업)
 * - **no_op**: 항상 포함 (응답만 하고 종료)
 *
 * @param {Object} inputs - 프롬프트 및 스키마 생성에 필요한 입력 데이터
 * @param {ThreadStatus | "not_started"} inputs.programmerStatus - Programmer 스레드 상태
 * @param {ThreadStatus | "not_started"} inputs.plannerStatus - Planner 스레드 상태
 * @param {BaseMessage[]} inputs.messages - 전체 대화 메시지 이력
 * @param {TaskPlan} inputs.taskPlan - 현재 작업 계획
 * @param {string[]} [inputs.proposedPlan] - 제안된 계획 (Planner가 생성, 아직 승인 안됨)
 * @param {RequestSource} [inputs.requestSource] - 요청 소스 (웹훅, CLI 등)
 *
 * @returns {Object} 생성된 프롬프트와 스키마
 * @returns {string} prompt - LLM에게 전달할 시스템 프롬프트
 * @returns {z.ZodTypeAny} schema - LLM 응답 검증용 Zod 스키마
 *
 * @example
 * // Planner가 실행 중이고 작업 계획이 있는 경우
 * const result = createClassificationPromptAndToolSchema({
 *   programmerStatus: "not_started",
 *   plannerStatus: "busy",
 *   messages: [...],
 *   taskPlan: { tasks: [...] }
 * });
 * // result.prompt에는 Planner 상태와 작업 계획이 포함된 프롬프트
 * // result.schema에는 ["update_planner", "no_op"] 라우트 옵션
 */
export function createClassificationPromptAndToolSchema(inputs: {
  programmerStatus: ThreadStatus | "not_started";
  plannerStatus: ThreadStatus | "not_started";
  messages: BaseMessage[];
  taskPlan: TaskPlan;
  proposedPlan?: string[];
  requestSource?: RequestSource;
}): {
  prompt: string;
  schema: z.ZodTypeAny;
} {
  // === 1단계: 컨텍스트 준비 - LLM에게 제공할 정보 포맷팅 ===

  // 대화 이력에서 마지막 HumanMessage 제거
  // (분류할 메시지는 이미 사용자 입력으로 전달되므로 중복 방지)
  const conversationHistoryWithoutLatest = removeLastHumanMessage(
    inputs.messages,
  );

  // 작업 계획(task plan) 프롬프트 생성
  // 작업 계획이 있으면 템플릿에 활성 작업 목록을 삽입
  const formattedTaskPlanPrompt = inputs.taskPlan
    ? TASK_PLAN_PROMPT.replaceAll(
        "{TASK_PLAN}",  // 플레이스홀더
        // 작업 계획에서 활성 항목만 추출하고 포맷팅
        formatPlanPrompt(getActivePlanItems(inputs.taskPlan)),
      )
    : null;  // 작업 계획이 없으면 null

  // 제안된 계획(proposed plan) 프롬프트 생성
  // Planner가 계획을 생성했지만 아직 사용자 승인을 받지 않은 경우
  const formattedProposedPlanPrompt = inputs.proposedPlan?.length
    ? PROPOSED_PLAN_PROMPT.replace(
        "{PROPOSED_PLAN}",  // 플레이스홀더
        // 제안된 계획 항목을 번호 매겨서 포맷팅
        // 예: "  1: 기능 구현\n  2: 테스트 작성"
        inputs.proposedPlan
          .map((p, index) => `  ${index + 1}: ${p}`)
          .join("\n"),
      )
    : null;  // 제안된 계획이 없으면 null

  // 대화 이력 프롬프트 생성
  // 과거 메시지들을 LLM이 이해할 수 있는 형식으로 변환
  const formattedConversationHistoryPrompt =
    conversationHistoryWithoutLatest?.length
      ? CONVERSATION_HISTORY_PROMPT.replaceAll(
          "{CONVERSATION_HISTORY}",  // 플레이스홀더
          // 각 메시지를 포맷팅하여 줄바꿈으로 연결
          conversationHistoryWithoutLatest
            .map(formatMessageForClassification)  // 메시지별 포맷팅
            .join("\n"),
        )
      : null;  // 대화 이력이 없으면 null

  // === 2단계: 상태 분석 - Planner와 Programmer의 실행 상태 확인 ===

  // Programmer가 현재 실행 중인지 확인
  const programmerRunning = inputs.programmerStatus === "busy";

  // Planner가 현재 실행 중인지 확인
  const plannerRunning = inputs.plannerStatus === "busy";

  // Planner가 중단되어 사용자 응답을 기다리는지 확인
  const plannerInterrupted = inputs.plannerStatus === "interrupted";

  // Planner가 아직 시작되지 않았는지 확인
  const plannerNotStarted = inputs.plannerStatus === "not_started";

  // Planner와 Programmer가 모두 idle 상태인지 확인
  // 둘 다 유휴 상태이면 새로운 후속 작업(followup)을 시작할 수 있음
  // (기존 작업이 완료되었으므로 새 작업 가능)
  const plannerAndProgrammerIdle =
    inputs.programmerStatus === "idle" && inputs.plannerStatus === "idle";

  // "새 이슈 생성" 옵션 표시 여부 결정
  // 에이전트가 이미 한 번이라도 시작되었으면 병렬 작업을 위한 새 이슈 생성 가능
  const showCreateIssueOption =
    inputs.programmerStatus !== "not_started" ||
    inputs.plannerStatus !== "not_started";

  // === 3단계: 라우팅 옵션 결정 - 현재 상태에서 가능한 라우트 목록 생성 ===

  // 조건부로 라우팅 옵션 배열 구성
  // 각 라우트는 특정 상태에서만 가능하므로 조건부로 포함
  const routingOptions = [
    // Programmer가 실행 중이면 "update_programmer" 추가
    ...(programmerRunning ? ["update_programmer"] : []),

    // Planner가 시작되지 않았으면 "start_planner" 추가 (최초 실행)
    ...(plannerNotStarted ? ["start_planner"] : []),

    // Planner와 Programmer가 모두 idle이면 "start_planner_for_followup" 추가
    // (이전 작업 완료 후 새 작업 시작)
    ...(plannerAndProgrammerIdle ? ["start_planner_for_followup"] : []),

    // Planner가 실행 중이면 "update_planner" 추가
    ...(plannerRunning ? ["update_planner"] : []),

    // Planner가 중단되었으면 "resume_and_update_planner" 추가
    ...(plannerInterrupted ? ["resume_and_update_planner"] : []),

    // 에이전트가 이미 실행 중이면 "create_new_issue" 추가 (병렬 작업)
    ...(showCreateIssueOption ? ["create_new_issue"] : []),

    // "no_op"는 항상 포함 (응답만 하고 종료하는 옵션)
    "no_op",
  ];

  // === 4단계: 프롬프트 조립 - 템플릿에 동적 값 삽입 ===

  // 기본 분류 시스템 프롬프트 템플릿에 실제 값 대입
  const prompt = CLASSIFICATION_SYSTEM_PROMPT
    // Programmer 상태를 읽기 쉬운 문자열로 교체
    .replaceAll(
      "{PROGRAMMER_STATUS}",
      THREAD_STATUS_READABLE_STRING_MAP[inputs.programmerStatus],
    )
    // Planner 상태를 읽기 쉬운 문자열로 교체
    .replaceAll(
      "{PLANNER_STATUS}",
      THREAD_STATUS_READABLE_STRING_MAP[inputs.plannerStatus],
    )
    // 가능한 라우팅 옵션 목록을 쉼표로 구분하여 삽입
    .replaceAll("{ROUTING_OPTIONS}", routingOptions.join(", "))

    // 각 라우팅 옵션에 대한 상세 설명 삽입 (조건부)
    // 해당 옵션이 가능할 때만 설명 포함, 불가능하면 빈 문자열

    // update_programmer 옵션 설명
    .replaceAll(
      "{UPDATE_PROGRAMMER_ROUTING_OPTION}",
      programmerRunning ? UPDATE_PROGRAMMER_ROUTING_OPTION : "",
    )
    // start_planner 옵션 설명
    .replaceAll(
      "{START_PLANNER_ROUTING_OPTION}",
      plannerNotStarted ? START_PLANNER_ROUTING_OPTION : "",
    )
    // start_planner_for_followup 옵션 설명
    .replaceAll(
      "{START_PLANNER_FOR_FOLLOWUP_ROUTING_OPTION}",
      plannerAndProgrammerIdle ? START_PLANNER_FOR_FOLLOWUP_ROUTING_OPTION : "",
    )
    // update_planner 옵션 설명
    .replaceAll(
      "{UPDATE_PLANNER_ROUTING_OPTION}",
      plannerRunning ? UPDATE_PLANNER_ROUTING_OPTION : "",
    )
    // resume_and_update_planner 옵션 설명
    .replaceAll(
      "{RESUME_AND_UPDATE_PLANNER_ROUTING_OPTION}",
      plannerInterrupted ? RESUME_AND_UPDATE_PLANNER_ROUTING_OPTION : "",
    )
    // create_new_issue 옵션 설명
    .replaceAll(
      "{CREATE_NEW_ISSUE_ROUTING_OPTION}",
      showCreateIssueOption ? CREATE_NEW_ISSUE_ROUTING_OPTION : "",
    )

    // 작업 계획 섹션 삽입 (작업 계획 또는 제안된 계획 중 하나)
    // 우선순위: taskPlan > proposedPlan > 빈 문자열
    .replaceAll(
      "{TASK_PLAN_PROMPT}",
      formattedTaskPlanPrompt ?? formattedProposedPlanPrompt ?? "",
    )
    // 대화 이력 섹션 삽입
    .replaceAll(
      "{CONVERSATION_HISTORY_PROMPT}",
      formattedConversationHistoryPrompt ?? "",
    )
    // 요청 소스 정보 삽입 (웹훅, CLI 등)
    .replaceAll(
      "{REQUEST_SOURCE}",
      inputs.requestSource ?? "제공된 소스 없음",
    );

  // === 5단계: 스키마 생성 - 가능한 라우트 옵션으로 Zod 스키마 생성 ===

  // routingOptions 배열을 사용하여 동적 스키마 생성
  // Zod enum은 최소 하나의 값이 필요하므로 [string, ...string[]] 타입으로 캐스팅
  const schema = createClassificationSchema(
    routingOptions as [string, ...string[]],
  );

  // === 6단계: 결과 반환 ===

  // LLM에게 전달할 프롬프트와 응답 검증용 스키마 반환
  return {
    prompt,   // 완성된 시스템 프롬프트 (모든 플레이스홀더가 실제 값으로 교체됨)
    schema,   // 가능한 라우트 옵션에 맞는 Zod 스키마
  };
}
