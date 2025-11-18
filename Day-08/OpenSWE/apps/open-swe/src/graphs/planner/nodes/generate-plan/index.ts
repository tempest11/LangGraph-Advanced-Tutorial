/**
 * @file Planner 실행 계획 생성 노드
 * @description
 * LLM을 사용하여 사용자 요청에 대한 실행 계획을 생성합니다.
 * 생성된 계획은 Programmer가 실행할 단계별 지침입니다.
 *
 * 주요 기능:
 * 1. 컨텍스트 수집 완료 후 실행 계획 생성
 * 2. 자기 완결적이고 구체적인 계획 생성 (파일 경로, 함수 이름 포함)
 * 3. 최소 단계로 최적화
 * 4. 후속 요청 처리 (기존 계획 업데이트)
 *
 * 처리 흐름:
 * 1. PLANNER 태스크용 LLM 모델 로드
 * 2. session_plan 도구 강제 호출 설정
 * 3. 시스템 프롬프트 포맷팅 (후속 요청 여부, 커스텀 룰 등)
 * 4. LLM 호출 → 계획 생성
 * 5. 빈 계획 항목 필터링
 * 6. 샌드박스 중지 (다음은 사용자 승인 대기)
 * 7. 생성된 계획을 proposedPlan 상태에 저장
 */

// === UUID ===
import { v4 as uuidv4 } from "uuid"; // 고유 메시지 ID 생성

// === LangChain 메시지 ===
import { isAIMessage, ToolMessage } from "@langchain/core/messages"; // 메시지 타입 가드 및 도구 메시지

// === 도구 정의 ===
import { createSessionPlanToolFields } from "../../../../tools/index.js"; // session_plan 도구 생성

// === 타입 정의 ===
import { GraphConfig } from "@openswe/shared/open-swe/types"; // LangGraph 설정 객체
import {
  PlannerGraphState, // Planner 그래프 상태 타입
  PlannerGraphUpdate, // Planner 그래프 업데이트 타입
} from "@openswe/shared/open-swe/planner/types";

// === LLM 유틸리티 ===
import {
  loadModel, // LLM 모델 로드
  supportsParallelToolCallsParam, // 병렬 도구 호출 지원 여부
} from "../../../../utils/llms/index.js";
import { LLMTask } from "@openswe/shared/open-swe/llm-task"; // LLM 태스크 타입 (PLANNER 등)
import { getModelManager } from "../../../../utils/llms/model-manager.js"; // 모델 매니저

// === 프롬프트 포맷팅 ===
import { formatUserRequestPrompt } from "../../../../utils/user-request.js"; // 사용자 요청 포맷팅
import {
  formatFollowupMessagePrompt, // 후속 요청 프롬프트 포맷팅
  isFollowupRequest, // 후속 요청 여부 확인
} from "../../utils/followup.js";
import { formatCustomRulesPrompt } from "../../../../utils/custom-rules.js"; // 커스텀 룰 포맷팅
import { getScratchpad } from "../../utils/scratchpad-notes.js"; // Scratchpad 노트 추출

// === 프롬프트 템플릿 ===
import {
  SCRATCHPAD_PROMPT, // Scratchpad 노트 프롬프트
  SYSTEM_PROMPT, // 계획 생성 메인 프롬프트
  CUSTOM_FRAMEWORK_PROMPT, // LangGraph 특화 프롬프트
} from "./prompt.js";

// === 샌드박스 ===
import { stopSandbox } from "../../../../utils/sandbox.js"; // 샌드박스 중지

// === Zod 스키마 ===
import { z } from "zod"; // TypeScript 타입 검증 라이브러리

// === 기타 유틸리티 ===
import { shouldUseCustomFramework } from "../../../../utils/should-use-custom-framework.js"; // 커스텀 프레임워크 사용 여부
import { DO_NOT_RENDER_ID_PREFIX } from "@openswe/shared/constants"; // 렌더링 제외 메시지 ID 접두사
import { filterMessagesWithoutContent } from "../../../../utils/message/content.js"; // 빈 메시지 필터링
import { trackCachePerformance } from "../../../../utils/caching.js"; // 프롬프트 캐싱 성능 추적
import { isLocalMode } from "@openswe/shared/open-swe/local-mode"; // 로컬 모드 여부 확인

/**
 * 시스템 프롬프트 포맷팅 함수
 *
 * @description
 * SYSTEM_PROMPT 템플릿에 실제 상태 값을 채워 넣습니다.
 *
 * 처리 과정:
 * 1. 후속 요청 여부 확인 (taskPlan, proposedPlan 비교)
 * 2. Scratchpad 노트 추출 및 포맷팅
 * 3. 템플릿 변수 치환:
 *    - FOLLOWUP_MESSAGE_PROMPT: 후속 요청 안내 (있을 경우)
 *    - USER_REQUEST_PROMPT: 사용자 요청 내용
 *    - CUSTOM_RULES: 커스텀 룰 (CLAUDE.md 등)
 *    - SCRATCHPAD: Scratchpad 노트
 *    - ADDITIONAL_INSTRUCTIONS: LangGraph 특화 가이드 (필요 시)
 *
 * @param {PlannerGraphState} state - Planner 그래프 상태
 * @param {GraphConfig} config - LangGraph 설정
 * @returns {string} 포맷팅된 시스템 프롬프트
 */
function formatSystemPrompt(
  state: PlannerGraphState,
  config: GraphConfig,
): string {
  // 후속 요청인지 확인 (기존 계획 업데이트)
  const isFollowup = isFollowupRequest(state.taskPlan, state.proposedPlan);

  // Scratchpad 노트를 리스트 형식으로 변환
  const scratchpad = getScratchpad(state.messages)
    .map((n) => `- ${n}`)
    .join("\n");

  return SYSTEM_PROMPT.replace(
    "{FOLLOWUP_MESSAGE_PROMPT}",
    isFollowup
      ? "\n" +
          formatFollowupMessagePrompt(state.taskPlan, state.proposedPlan) +
          "\n\n"
      : "",
  )
    .replace("{USER_REQUEST_PROMPT}", formatUserRequestPrompt(state.messages))
    .replaceAll("{CUSTOM_RULES}", formatCustomRulesPrompt(state.customRules))
    .replaceAll(
      "{SCRATCHPAD}",
      scratchpad.length
        ? SCRATCHPAD_PROMPT.replace("{SCRATCHPAD}", scratchpad)
        : "",
    )
    .replace(
      "{ADDITIONAL_INSTRUCTIONS}",
      shouldUseCustomFramework(config) ? CUSTOM_FRAMEWORK_PROMPT : "",
    );
}

/**
 * Planner 실행 계획 생성 노드
 *
 * @description
 * LLM을 사용하여 사용자 요청에 대한 실행 계획을 생성합니다.
 * 생성된 계획은 Programmer가 실행할 구체적이고 자기 완결적인 단계들입니다.
 *
 * 처리 흐름:
 * 1. PLANNER 태스크용 LLM 모델 로드
 * 2. session_plan 도구 바인딩 및 강제 호출 설정
 * 3. 최대 액션 수 도달 시 도구 호출 미실행 메시지 추가
 * 4. 빈 메시지 필터링
 * 5. 시스템 프롬프트 포맷팅 및 LLM 호출
 * 6. 빈 계획 항목 필터링
 * 7. 샌드박스 중지 (다음 단계는 사용자 승인 대기)
 * 8. 생성된 계획을 proposedPlan 상태에 저장
 *
 * @param {PlannerGraphState} state - Planner 그래프 상태
 * @param {GraphConfig} config - LangGraph 설정
 * @returns {Promise<PlannerGraphUpdate>} 업데이트된 상태
 *   - messages: LLM 응답 및 도구 결과 메시지
 *   - proposedPlanTitle: 계획 제목
 *   - proposedPlan: 생성된 계획 (문자열 배열)
 *   - sandboxSessionId: 중지된 샌드박스 ID (있을 경우)
 *   - tokenData: 프롬프트 캐싱 성능 데이터
 * @throws {Error} 처리할 메시지가 없을 때
 * @throws {Error} LLM이 도구 호출을 하지 않았을 때
 *
 * @example
 * // 생성된 계획 예시:
 * // proposedPlan: [
 * //   "Implement authentication middleware in /src/auth/middleware.ts using JWT",
 * //   "Update API routes in /src/routes/api.ts to use the middleware",
 * //   "Add unit tests for authentication in /src/auth/__tests__/middleware.test.ts"
 * // ]
 */
export async function generatePlan(
  state: PlannerGraphState,
  config: GraphConfig,
): Promise<PlannerGraphUpdate> {
  // === 1단계: PLANNER 태스크용 LLM 모델 로드 ===
  const model = await loadModel(config, LLMTask.PLANNER);
  const modelManager = getModelManager();
  const modelName = modelManager.getModelNameForTask(config, LLMTask.PLANNER);

  // === 2단계: LLM에 도구 바인딩 ===
  const modelSupportsParallelToolCallsParam = supportsParallelToolCallsParam(
    config,
    LLMTask.PLANNER,
  );
  const sessionPlanTool = createSessionPlanToolFields();
  const modelWithTools = model.bindTools([sessionPlanTool], {
    tool_choice: sessionPlanTool.name, // session_plan 도구만 강제 호출
    ...(modelSupportsParallelToolCallsParam
      ? {
          parallel_tool_calls: false, // 병렬 도구 호출 비활성화
        }
      : {}),
  });

  // === 3단계: 최대 액션 수 도달 시 처리 ===
  // take-action 노드에서 최대 액션 수에 도달하면 도구 호출이 실행되지 않았다는 메시지 추가
  let optionalToolMessage: ToolMessage | undefined;
  const lastMessage = state.messages[state.messages.length - 1];
  if (isAIMessage(lastMessage) && lastMessage.tool_calls?.[0]) {
    const lastMessageToolCall = lastMessage.tool_calls?.[0];
    optionalToolMessage = new ToolMessage({
      id: uuidv4(),
      tool_call_id: lastMessageToolCall.id ?? "",
      name: lastMessageToolCall.name,
      content: "도구 호출이 실행되지 않았습니다. 최대 액션 수에 도달했습니다.",
    });
  }

  // === 4단계: 빈 메시지 필터링 ===
  const inputMessages = filterMessagesWithoutContent([
    ...state.messages,
    ...(optionalToolMessage ? [optionalToolMessage] : []),
  ]);
  if (!inputMessages.length) {
    throw new Error("처리할 메시지가 없습니다.");
  }

  // === 5단계: LLM 호출 ===
  // nostream 태그: 스트리밍 비활성화 (전체 응답 대기)
  const response = await modelWithTools
    .withConfig({ tags: ["nostream"] })
    .invoke([
      {
        role: "system",
        content: formatSystemPrompt(state, config),
      },
      ...inputMessages,
    ]);

  // === 6단계: 빈 계획 항목 필터링 ===
  // LLM이 빈 문자열 계획 항목을 생성할 수 있으므로 제거
  response.tool_calls = response.tool_calls?.map((tc) => {
    if (tc.id === sessionPlanTool.name) {
      return {
        ...tc,
        args: {
          ...tc.args,
          plan: (tc.args as z.infer<typeof sessionPlanTool.schema>).plan.filter(
            (p) => p.length > 0,
          ),
        },
      };
    }
    return tc;
  });

  // === 7단계: 도구 호출 결과 검증 ===
  const toolCall = response.tool_calls?.[0];
  if (!toolCall) {
    throw new Error("계획 생성에 실패했습니다.");
  }

  // === 8단계: 샌드박스 중지 ===
  // 다음 단계는 사용자 승인 대기 (interrupt-proposed-plan)이므로 샌드박스 중지
  let newSessionId: string | undefined;
  if (state.sandboxSessionId && !isLocalMode(config)) {
    newSessionId = await stopSandbox(state.sandboxSessionId);
  }

  // === 9단계: 계획 추출 ===
  const proposedPlanArgs = toolCall.args as z.infer<
    typeof sessionPlanTool.schema
  >;

  // === 10단계: 도구 응답 메시지 생성 ===
  const toolResponse = new ToolMessage({
    id: `${DO_NOT_RENDER_ID_PREFIX}${uuidv4()}`,
    tool_call_id: toolCall.id ?? "",
    content: "계획을 성공적으로 저장했습니다.",
    name: sessionPlanTool.name,
  });

  // === 11단계: 업데이트된 상태 반환 ===
  return {
    messages: [response, toolResponse],
    proposedPlanTitle: proposedPlanArgs.title, // 계획 제목
    proposedPlan: proposedPlanArgs.plan, // 계획 단계들
    ...(newSessionId && { sandboxSessionId: newSessionId }), // 중지된 샌드박스 ID
    tokenData: trackCachePerformance(response, modelName), // 프롬프트 캐싱 성능 추적
  };
}
