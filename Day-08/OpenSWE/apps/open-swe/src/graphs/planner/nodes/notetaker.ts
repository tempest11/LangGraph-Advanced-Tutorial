/**
 * @file Planner 기술 노트 추출 노드
 * @description
 * 컨텍스트 수집 후 대화 히스토리에서 중요한 기술 정보를 추출하여 노트로 저장합니다.
 * 이 노트는 Programmer 실행 시 참고 자료로 사용됩니다.
 *
 * 주요 기능:
 * 1. 대화 히스토리와 제안된 계획 분석
 * 2. LLM이 중요한 기술 정보 추출
 * 3. 코드베이스 패턴, 의존성, 설정 등 기록
 * 4. 전체 코드 스니펫 제외 (핵심만 요약)
 *
 * 처리 흐름:
 * 1. SUMMARIZER 태스크용 LLM 모델 로드
 * 2. write_technical_notes 도구 강제 호출 설정
 * 3. 대화 히스토리, 제안된 계획, 커스텀 룰 제공
 * 4. LLM이 중요한 정보 추출
 * 5. contextGatheringNotes 상태에 저장
 */

// === UUID ===
import { v4 as uuidv4 } from "uuid"; // 고유 메시지 ID 생성

// === Zod 스키마 ===
import { z } from "zod"; // TypeScript 타입 검증 라이브러리

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
} from "../../../utils/llms/index.js";
import { LLMTask } from "@openswe/shared/open-swe/llm-task"; // LLM 태스크 타입 (SUMMARIZER 등)
import { getModelManager } from "../../../utils/llms/model-manager.js"; // 모델 매니저

// === 메시지 유틸리티 ===
import { getMessageString } from "../../../utils/message/content.js"; // 메시지를 문자열로 변환

// === 프롬프트 포맷팅 ===
import { formatUserRequestPrompt } from "../../../utils/user-request.js"; // 사용자 요청 포맷팅
import { formatCustomRulesPrompt } from "../../../utils/custom-rules.js"; // 커스텀 룰 포맷팅
import { getScratchpad } from "../utils/scratchpad-notes.js"; // Scratchpad 노트 추출

// === LangChain 메시지 ===
import { ToolMessage } from "@langchain/core/messages"; // 도구 실행 결과 메시지

// === 상수 ===
import { DO_NOT_RENDER_ID_PREFIX } from "@openswe/shared/constants"; // 렌더링 제외 메시지 ID 접두사

// === 도구 정의 ===
import { createWriteTechnicalNotesToolFields } from "@openswe/shared/open-swe/tools"; // 기술 노트 작성 도구

// === 캐싱 ===
import { trackCachePerformance } from "../../../utils/caching.js"; // 프롬프트 캐싱 성능 추적

/**
 * Scratchpad 노트 프롬프트
 *
 * @description
 * 컨텍스트 수집 중 작성한 Scratchpad 노트를 LLM에게 제공합니다.
 * 이 노트들도 최종 기술 노트에 통합해야 합니다.
 */
const SCRATCHPAD_PROMPT = `You've also wrote technical notes to a scratchpad throughout the context gathering process. Ensure you include/incorporate these notes, or the highest quality parts of these notes in your conclusion notes.

<scratchpad>
{SCRATCHPAD}
</scratchpad>`;

/**
 * 커스텀 룰 중복 방지 안내
 *
 * @description
 * 커스텀 룰 (CLAUDE.md 등)은 항상 접근 가능하므로,
 * 노트에 중복 포함하지 않도록 안내합니다.
 */
const CUSTOM_RULES_EXTRA_CONTEXT =
  "- Carefully read over the user's custom rules to ensure you don't duplicate or repeat information found in that section, as you will always have access to it (even after the planning step!).";

/**
 * 기술 노트 추출 시스템 프롬프트
 *
 * @description
 * LLM이 대화 히스토리에서 중요한 기술 정보를 추출하도록 지시합니다.
 *
 * 템플릿 변수:
 * - {USER_REQUEST_PROMPT}: 사용자 요청 내용
 * - {CONVERSATION_HISTORY}: 전체 대화 히스토리
 * - {PROPOSED_PLAN}: 제안된 계획
 * - {CUSTOM_RULES}: 커스텀 룰
 * - {SCRATCHPAD}: Scratchpad 노트
 * - {EXTRA_RULES}: 커스텀 룰 중복 방지 안내
 *
 * 노트 작성 기준:
 * - 전체 코드 스니펫 제외
 * - 전체 파일 내용 제외
 * - 제공된 컨텍스트만 기록 (추론 금지)
 * - 코드 언급 시 파일 경로 포함
 * - 제안된 계획 실행에 유용한 정보 중심
 */
const systemPrompt = `You are operating as a terminal-based agentic coding assistant built by LangChain. It wraps LLM models to enable natural language interaction with a local codebase. You are expected to be precise, safe, and helpful.

You've just finished gathering context to aid in generating a development plan to address the user's request. The context you've gathered is provided in the conversation history below.
After this, the conversation history will be deleted, and you'll start executing on the plan.
Your task is to carefully read over the conversation history, and take notes on the most important and useful actions you performed which will be helpful to you when you go and execute on the plan.
The notes you extract should be thoughtful, and should include technical details about the codebase, files, patterns, dependencies and setup instructions you discovered during the context gathering step, which you believe will be helpful when you go to execute on the plan.
These notes should not be overly verbose, as you'll be able to gather additional context when executing.
Your goal is to generate notes on all of the low-hanging fruit from the conversation history, to speed up the execution so that you don't need to duplicate work to gather context.

{CUSTOM_RULES}

{SCRATCHPAD}

You MUST adhere to the following criteria when generating your notes:
- Do not retain any full code snippets.
- Do not retain any full file contents.
- Only take notes on the context provided below, and do not make up, or attempt to infer any information/context which is not explicitly provided.
- If mentioning specific code from the repo, ensure you also provide the path to the file the code is in.
- Carefully inspect the proposed plan. Your notes should be focused on context which will be most useful to you when you execute the plan. You may reference specific proposed plan items in your notes.
{EXTRA_RULES}

{USER_REQUEST_PROMPT}

Here is the conversation history:
## Conversation history:
{CONVERSATION_HISTORY}

And here is the plan you just generated:
## Proposed plan:
{PROPOSED_PLAN}

With all of this in mind, please carefully inspect the conversation history, and the plan you generated. Then, determine which actions and context from the conversation history will be most useful to you when you execute the plan. After you're done analyzing, call the \`write_technical_notes\` tool.
`;

/**
 * 프롬프트 포맷팅 함수
 *
 * @description
 * systemPrompt 템플릿에 실제 상태 값을 채워 넣습니다.
 *
 * 처리 과정:
 * 1. Scratchpad 노트 추출 및 포맷팅
 * 2. 사용자 요청 포맷팅
 * 3. 대화 히스토리 문자열 변환
 * 4. 제안된 계획 리스트 변환
 * 5. 커스텀 룰 포맷팅
 * 6. 템플릿 변수 치환
 *
 * @param {PlannerGraphState} state - Planner 그래프 상태
 * @returns {string} 포맷팅된 시스템 프롬프트
 */
const formatPrompt = (state: PlannerGraphState): string => {
  // Scratchpad 노트를 리스트 형식으로 변환
  const scratchpad = getScratchpad(state.messages)
    .map((n) => `  - ${n}`)
    .join("\n");

  return systemPrompt
    .replace("{USER_REQUEST_PROMPT}", formatUserRequestPrompt(state.messages))
    .replace(
      "{CONVERSATION_HISTORY}",
      state.messages.map(getMessageString).join("\n"),
    )
    .replace(
      "{PROPOSED_PLAN}",
      state.proposedPlan.map((p) => `  - ${p}`).join("\n"),
    )
    .replaceAll(
      "{CUSTOM_RULES}",
      formatCustomRulesPrompt(
        state.customRules,
        "Keep in mind these user provided rules will always be available to you, so any context present here should NOT be included in your notes as to not duplicate information.",
      ),
    )
    .replaceAll(
      "{SCRATCHPAD}",
      scratchpad.length
        ? SCRATCHPAD_PROMPT.replace("{SCRATCHPAD}", scratchpad)
        : "",
    )
    .replaceAll(
      "{EXTRA_RULES}",
      state.customRules ? CUSTOM_RULES_EXTRA_CONTEXT : "",
    );
};

/**
 * write_technical_notes 도구 정의
 *
 * @description
 * LLM이 호출할 도구를 생성합니다.
 * 이 도구는 notes 필드를 받아서 기술 노트를 저장합니다.
 */
const condenseContextTool = createWriteTechnicalNotesToolFields();

/**
 * Planner 기술 노트 추출 노드
 *
 * @description
 * 컨텍스트 수집 완료 후 대화 히스토리에서 중요한 기술 정보를 추출합니다.
 * 추출된 노트는 Programmer 실행 시 참고 자료로 사용됩니다.
 *
 * 처리 흐름:
 * 1. SUMMARIZER 태스크용 LLM 모델 로드
 * 2. write_technical_notes 도구 바인딩 및 강제 호출 설정
 * 3. 포맷팅된 프롬프트로 LLM 호출
 * 4. LLM이 write_technical_notes 도구 호출
 * 5. 추출된 노트를 contextGatheringNotes에 저장
 *
 * @param {PlannerGraphState} state - Planner 그래프 상태
 * @param {GraphConfig} config - LangGraph 설정
 * @returns {Promise<PlannerGraphUpdate>} 업데이트된 상태
 *   - messages: LLM 응답 및 도구 결과 메시지
 *   - contextGatheringNotes: 추출된 기술 노트
 *   - tokenData: 프롬프트 캐싱 성능 데이터
 * @throws {Error} LLM이 도구 호출을 하지 않았을 때
 *
 * @example
 * // LLM이 추출한 노트 예시:
 * // "- Authentication uses JWT tokens stored in localStorage
 * //  - Database connection logic in /src/db/connection.ts
 * //  - API endpoints follow RESTful pattern with /api/v1 prefix"
 */
export async function notetaker(
  state: PlannerGraphState,
  config: GraphConfig,
): Promise<PlannerGraphUpdate> {
  // === 1단계: SUMMARIZER 태스크용 LLM 모델 로드 ===
  const model = await loadModel(config, LLMTask.SUMMARIZER);
  const modelManager = getModelManager();
  const modelName = modelManager.getModelNameForTask(
    config,
    LLMTask.SUMMARIZER,
  );

  // === 2단계: LLM에 도구 바인딩 ===
  const modelSupportsParallelToolCallsParam = supportsParallelToolCallsParam(
    config,
    LLMTask.SUMMARIZER,
  );
  const modelWithTools = model.bindTools([condenseContextTool], {
    tool_choice: condenseContextTool.name, // write_technical_notes 도구만 강제 호출
    ...(modelSupportsParallelToolCallsParam
      ? {
          parallel_tool_calls: false, // 병렬 도구 호출 비활성화
        }
      : {}),
  });

  // === 3단계: 대화 히스토리 문자열 준비 ===
  const conversationHistoryStr = `Here is the full conversation history:

${state.messages.map(getMessageString).join("\n")}`;

  // === 4단계: LLM 호출 ===
  const response = await modelWithTools.invoke([
    {
      role: "system",
      content: formatPrompt(state),
    },
    {
      role: "user",
      content: conversationHistoryStr,
    },
  ]);

  // === 5단계: 도구 호출 결과 검증 ===
  const toolCall = response.tool_calls?.[0];
  if (!toolCall) {
    throw new Error("Failed to generate plan");
  }

  // === 6단계: 도구 응답 메시지 생성 ===
  const toolResponse = new ToolMessage({
    id: `${DO_NOT_RENDER_ID_PREFIX}${uuidv4()}`,
    tool_call_id: toolCall.id ?? "",
    content: "Successfully saved notes.",
    name: condenseContextTool.name,
  });

  // === 7단계: 업데이트된 상태 반환 ===
  return {
    messages: [response, toolResponse],
    contextGatheringNotes: (
      toolCall.args as z.infer<typeof condenseContextTool.schema>
    ).notes, // 추출된 기술 노트
    tokenData: trackCachePerformance(response, modelName), // 프롬프트 캐싱 성능 추적
  };
}
