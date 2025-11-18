/**
 * @file Planner 컨텍스트 수집 액션 생성 노드
 * @description
 * LLM을 사용하여 컨텍스트 수집을 위한 다음 액션을 생성합니다.
 * LLM은 도구를 호출하거나 'done'으로 응답하여 계획 생성으로 진행합니다.
 *
 * 주요 기능:
 * 1. 컨텍스트 수집용 도구 제공 (grep, shell, view, scratchpad 등)
 * 2. LLM이 다음 액션 결정 (도구 호출 또는 완료)
 * 3. 병렬 도구 호출 지원 (성능 최적화)
 * 4. 프롬프트 캐싱으로 성능 향상
 *
 * 처리 흐름:
 * 1. PLANNER 태스크용 LLM 모델 로드
 * 2. 컨텍스트 수집 도구 생성 (grep, shell, view, MCP 등)
 * 3. 도구에 프롬프트 캐싱 마커 추가
 * 4. 누락된 GitHub 메시지와 최신 계획 가져오기
 * 5. 시스템 프롬프트 포맷팅
 * 6. LLM 호출 → 도구 호출 또는 'done' 응답
 */

// === LLM 유틸리티 ===
import {
  getModelManager, // 모델 매니저
  loadModel, // LLM 모델 로드
  supportsParallelToolCallsParam, // 병렬 도구 호출 지원 여부
} from "../../../../utils/llms/index.js";
import { LLMTask } from "@openswe/shared/open-swe/llm-task"; // LLM 태스크 타입 (PLANNER 등)

// === 도구들 ===
import {
  createGetURLContentTool, // URL 컨텐츠 가져오기 도구
  createShellTool, // 쉘 명령어 실행 도구
  createSearchDocumentForTool, // 문서 검색 도구
} from "../../../../tools/index.js";
import { createGrepTool } from "../../../../tools/grep.js"; // 파일 내용 검색 도구
import { createScratchpadTool } from "../../../../tools/scratchpad.js"; // 노트 작성 도구
import { createViewTool } from "../../../../tools/builtin-tools/view.js"; // 파일 보기 도구

// === MCP 도구 ===
import { getMcpTools } from "../../../../utils/mcp-client.js"; // Model Context Protocol 도구

// === 타입 정의 ===
import {
  PlannerGraphState, // Planner 그래프 상태 타입
  PlannerGraphUpdate, // Planner 그래프 업데이트 타입
} from "@openswe/shared/open-swe/planner/types";
import { GraphConfig } from "@openswe/shared/open-swe/types"; // LangGraph 설정 객체

// === 로깅 ===
import { createLogger, LogLevel } from "../../../../utils/logger.js"; // 구조화된 로거

// === 메시지 유틸리티 ===
import { getMessageContentString } from "@openswe/shared/messages"; // 메시지 컨텐츠를 문자열로 변환
import { filterMessagesWithoutContent } from "../../../../utils/message/content.js"; // 빈 메시지 필터링

// === 프롬프트 포맷팅 ===
import {
  formatFollowupMessagePrompt, // 후속 요청 프롬프트 포맷팅
  isFollowupRequest, // 후속 요청 여부 확인
} from "../../utils/followup.js";
import {
  SYSTEM_PROMPT, // 컨텍스트 수집 메인 프롬프트
  EXTERNAL_FRAMEWORK_DOCUMENTATION_PROMPT, // LangGraph 문서 접근 가이드
  EXTERNAL_FRAMEWORK_PLAN_PROMPT, // LangGraph 특화 계획 가이드
} from "./prompt.js";
import { formatCustomRulesPrompt } from "../../../../utils/custom-rules.js"; // 커스텀 룰 포맷팅
import { formatUserRequestPrompt } from "../../../../utils/user-request.js"; // 사용자 요청 포맷팅
import { getScratchpad } from "../../utils/scratchpad-notes.js"; // Scratchpad 노트 추출

// === Git ===
import { getRepoAbsolutePath } from "@openswe/shared/git"; // 리포지토리 절대 경로

// === 로컬 모드 ===
import {
  isLocalMode, // 로컬 모드 여부 확인
  getLocalWorkingDirectory, // 로컬 작업 디렉토리 경로
} from "@openswe/shared/open-swe/local-mode";

// === GitHub 유틸리티 ===
import { getMissingMessages } from "../../../../utils/github/issue-messages.js"; // 아직 추가되지 않은 메시지 가져오기
import { getPlansFromIssue } from "../../../../utils/github/issue-task.js"; // GitHub 이슈에서 계획 가져오기

// === 캐싱 ===
import {
  convertMessagesToCacheControlledMessages, // 메시지를 캐시 제어 메시지로 변환
  trackCachePerformance, // 프롬프트 캐싱 성능 추적
} from "../../../../utils/caching.js";

// === 기타 유틸리티 ===
import { shouldCreateIssue } from "../../../../utils/should-create-issue.js"; // 이슈 생성이 필요한지 확인
import { shouldUseCustomFramework } from "../../../../utils/should-use-custom-framework.js"; // 커스텀 프레임워크 사용 여부

// === 로거 인스턴스 ===
const logger = createLogger(LogLevel.INFO, "GeneratePlanningMessageNode");

/**
 * 시스템 프롬프트 포맷팅 함수
 *
 * @description
 * SYSTEM_PROMPT 템플릿에 실제 상태 값을 채워 넣습니다.
 *
 * 처리 과정:
 * 1. 후속 요청 여부 확인
 * 2. Scratchpad 노트 추출 및 포맷팅
 * 3. 템플릿 변수 치환:
 *    - FOLLOWUP_MESSAGE_PROMPT: 후속 요청 안내
 *    - CURRENT_WORKING_DIRECTORY: 현재 작업 디렉토리
 *    - LOCAL_MODE_NOTE: 로컬 모드 안내
 *    - CODEBASE_TREE: 코드베이스 디렉토리 트리
 *    - CUSTOM_RULES: 커스텀 룰
 *    - USER_REQUEST_PROMPT: 사용자 요청 내용
 *    - EXTERNAL_FRAMEWORK_DOCUMENTATION_PROMPT: LangGraph 문서 가이드
 *    - EXTERNAL_FRAMEWORK_PLAN_PROMPT: LangGraph 계획 가이드
 *    - DEV_SERVER_PROMPT: 개발 서버 도구 가이드 (현재 비어있음)
 *
 * @param {PlannerGraphState} state - Planner 그래프 상태
 * @param {GraphConfig} config - LangGraph 설정
 * @returns {string} 포맷팅된 시스템 프롬프트
 */
function formatSystemPrompt(
  state: PlannerGraphState,
  config: GraphConfig,
): string {
  // 후속 요청인지 확인
  const isFollowup = isFollowupRequest(state.taskPlan, state.proposedPlan);

  // Scratchpad 노트를 리스트 형식으로 변환
  const scratchpad = getScratchpad(state.messages)
    .map((n) => `- ${n}`)
    .join("\n");

  return SYSTEM_PROMPT.replace(
    "{FOLLOWUP_MESSAGE_PROMPT}",
    isFollowup
      ? formatFollowupMessagePrompt(
          state.taskPlan,
          state.proposedPlan,
          scratchpad,
        )
      : "",
  )
    .replaceAll(
      "{CURRENT_WORKING_DIRECTORY}",
      isLocalMode(config)
        ? getLocalWorkingDirectory()
        : getRepoAbsolutePath(state.targetRepository),
    )
    .replaceAll(
      "{LOCAL_MODE_NOTE}",
      isLocalMode(config)
        ? "<local_mode_note>IMPORTANT: You are running in local mode. When specifying file paths, use relative paths from the current working directory or absolute paths that start with the current working directory. Do NOT use sandbox paths like '/home/daytona/project/'.</local_mode_note>"
        : "",
    )
    .replaceAll(
      "{CODEBASE_TREE}",
      state.codebaseTree || "No codebase tree generated yet.",
    )
    .replaceAll("{CUSTOM_RULES}", formatCustomRulesPrompt(state.customRules))
    .replace("{USER_REQUEST_PROMPT}", formatUserRequestPrompt(state.messages))
    .replace(
      "{EXTERNAL_FRAMEWORK_DOCUMENTATION_PROMPT}",
      shouldUseCustomFramework(config)
        ? EXTERNAL_FRAMEWORK_DOCUMENTATION_PROMPT
        : "",
    )
    .replace(
      "{EXTERNAL_FRAMEWORK_PLAN_PROMPT}",
      shouldUseCustomFramework(config) ? EXTERNAL_FRAMEWORK_PLAN_PROMPT : "",
    )
    .replace("{DEV_SERVER_PROMPT}", ""); // 아직 dev server 도구 추가 전까지 비어있음
}

/**
 * Planner 컨텍스트 수집 액션 생성 노드
 *
 * @description
 * LLM을 사용하여 컨텍스트 수집을 위한 다음 액션을 생성합니다.
 * LLM은 도구를 호출하여 컨텍스트를 수집하거나, 'done'으로 응답하여 계획 생성으로 진행합니다.
 *
 * 처리 흐름:
 * 1. PLANNER 태스크용 LLM 모델 로드
 * 2. 컨텍스트 수집용 도구 생성:
 *    - grep: 파일 내용 검색
 *    - shell: 쉘 명령어 실행
 *    - view: 파일/디렉토리 보기
 *    - scratchpad: 노트 작성
 *    - get_url_content: URL 컨텐츠 가져오기
 *    - search_document_for: 문서 검색
 *    - MCP 도구들: 확장 가능한 외부 도구
 * 3. 도구에 프롬프트 캐싱 마커 추가 (마지막 도구에)
 * 4. 도구 자동 선택 모드로 모델 바인딩 (병렬 도구 호출 활성화)
 * 5. 누락된 GitHub 메시지와 최신 계획 가져오기
 * 6. 빈 메시지 필터링 및 캐시 제어 메시지 변환
 * 7. 시스템 프롬프트 포맷팅 및 LLM 호출
 * 8. LLM 응답 로깅 (도구 호출 또는 'done')
 *
 * @param {PlannerGraphState} state - Planner 그래프 상태
 * @param {GraphConfig} config - LangGraph 설정
 * @returns {Promise<PlannerGraphUpdate>} 업데이트된 상태
 *   - messages: 누락된 메시지 + LLM 응답 (도구 호출 포함)
 *   - taskPlan: 최신 계획 (있을 경우)
 *   - tokenData: 프롬프트 캐싱 성능 데이터
 * @throws {Error} 처리할 메시지가 없을 때
 *
 * @example
 * // LLM이 grep 도구 호출 요청:
 * // tool_calls: [{ name: "grep", args: { pattern: "authentication", glob: "*.ts" } }]
 * // → take-action 노드에서 실행
 *
 * // LLM이 'done' 응답:
 * // content: "done"
 * // → determine-done 노드로 이동 → generate-plan
 */
export async function generateAction(
  state: PlannerGraphState,
  config: GraphConfig,
): Promise<PlannerGraphUpdate> {
  // === 1단계: PLANNER 태스크용 LLM 모델 로드 ===
  const model = await loadModel(config, LLMTask.PLANNER);
  const modelManager = getModelManager();
  const modelName = modelManager.getModelNameForTask(config, LLMTask.PLANNER);
  const modelSupportsParallelToolCallsParam = supportsParallelToolCallsParam(
    config,
    LLMTask.PLANNER,
  );

  // === 2단계: 컨텍스트 수집용 도구 생성 ===
  const mcpTools = await getMcpTools(config); // MCP 도구들

  const tools = [
    createGrepTool(state, config), // 파일 내용 검색
    createShellTool(state, config), // 쉘 명령어 실행
    createViewTool(state, config), // 파일/디렉토리 보기
    createScratchpadTool(
      "when generating a final plan, after all context gathering is complete",
    ), // 노트 작성
    createGetURLContentTool(state), // URL 컨텐츠 가져오기
    createSearchDocumentForTool(state, config), // 문서 검색
    ...mcpTools, // MCP 도구들
  ];

  logger.info(
    `MCP tools added to Planner: ${mcpTools.map((t) => t.name).join(", ")}`,
  );

  // === 3단계: 프롬프트 캐싱 마커 추가 ===
  // Cache Breakpoint 1: 마지막 도구에 cache_control 마커 추가하여 도구 정의 캐싱
  tools[tools.length - 1] = {
    ...tools[tools.length - 1],
    cache_control: { type: "ephemeral" },
  } as any;

  // === 4단계: LLM에 도구 바인딩 ===
  const modelWithTools = model.bindTools(tools, {
    tool_choice: "auto", // 도구 자동 선택 (LLM이 결정)
    ...(modelSupportsParallelToolCallsParam
      ? {
          parallel_tool_calls: true, // 병렬 도구 호출 활성화
        }
      : {}),
  });

  // === 5단계: 누락된 메시지와 최신 계획 가져오기 ===
  const [missingMessages, { taskPlan: latestTaskPlan }] = shouldCreateIssue(
    config,
  )
    ? await Promise.all([
        getMissingMessages(state, config),
        getPlansFromIssue(state, config),
      ])
    : [[], { taskPlan: null }];

  // === 6단계: 빈 메시지 필터링 ===
  const inputMessages = filterMessagesWithoutContent([
    ...state.messages,
    ...missingMessages,
  ]);
  if (!inputMessages.length) {
    throw new Error("No messages to process.");
  }

  // === 7단계: 캐시 제어 메시지 변환 ===
  // Cache Breakpoint 2: 메시지에 cache_control 마커 추가
  const inputMessagesWithCache =
    convertMessagesToCacheControlledMessages(inputMessages);

  // === 8단계: LLM 호출 ===
  // nostream 태그: 스트리밍 비활성화 (전체 응답 대기)
  const response = await modelWithTools
    .withConfig({ tags: ["nostream"] })
    .invoke([
      {
        role: "system",
        content: formatSystemPrompt(
          {
            ...state,
            taskPlan: latestTaskPlan ?? state.taskPlan,
          },
          config,
        ),
      },
      ...inputMessagesWithCache,
    ]);

  // === 9단계: LLM 응답 로깅 ===
  logger.info("Generated planning message", {
    ...(getMessageContentString(response.content) && {
      content: getMessageContentString(response.content),
    }),
    ...response.tool_calls?.map((tc) => ({
      name: tc.name,
      args: tc.args,
    })),
  });

  // === 10단계: 업데이트된 상태 반환 ===
  return {
    messages: [...missingMessages, response], // 누락된 메시지 + LLM 응답
    ...(latestTaskPlan && { taskPlan: latestTaskPlan }), // 최신 계획 (있을 경우)
    tokenData: trackCachePerformance(response, modelName), // 프롬프트 캐싱 성능 추적
  };
}
