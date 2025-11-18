/**
 * @file Programmer 그래프의 메시지 생성 노드 (generate-message/index.ts)
 * @description
 * LLM을 호출하여 다음에 수행할 액션(도구 호출)을 생성하는 Programmer의 핵심 노드입니다.
 *
 * 주요 기능:
 * 1. **다중 프로바이더 지원**: Anthropic, OpenAI, Google Gemini 등 여러 LLM 제공자 지원
 * 2. **프롬프트 캐싱**: 4단계 캐시 전략으로 비용 및 지연시간 최적화
 * 3. **도구 관리**: 10+ 도구 생성 및 제공자별 도구 세트 관리
 * 4. **코드 리뷰 통합**: Reviewer의 피드백을 컨텍스트에 포함
 * 5. **계획 동기화**: GitHub 이슈에서 최신 계획 가져오기
 * 6. **MCP 통합**: Model Context Protocol 외부 도구 지원
 *
 * 프롬프트 캐싱 전략 (Anthropic):
 * - Cache Breakpoint 1: 도구 정의 (마지막 도구에 cache_control)
 * - Cache Breakpoint 2: 정적 지침 (시스템 프롬프트, 커스텀 룰)
 * - Cache Breakpoint 3: 동적 컨텍스트 (계획, 코드베이스 트리, 의존성)
 * - Cache Breakpoint 4: 코드 리뷰 (Reviewer 피드백, 선택적)
 *
 * 프로바이더별 차이:
 * - **Anthropic**: text_editor_20250429 네이티브 도구, 프롬프트 캐싱 지원
 * - **OpenAI/Google**: apply-patch 도구 사용, 캐싱 미지원
 * - **병렬 도구 호출**: 프로바이더별로 지원 여부 확인
 *
 * 워크플로우:
 * 1. 모델 매니저에서 PROGRAMMER 모델 가져오기
 * 2. GitHub 이슈에서 누락된 메시지 및 최신 계획 가져오기 (선택적)
 * 3. 모든 도구 생성 (Built-in + MCP)
 * 4. 프로바이더별 프롬프트 및 도구 세트 생성
 * 5. 프롬프트 캐싱 적용 (Anthropic만)
 * 6. LLM 호출하여 다음 액션 생성
 * 7. 도구 호출이 없으면 샌드박스 중지 (작업 완료)
 * 8. mark_task_completed가 다른 도구와 함께 호출되면 제거 (단독 호출만 허용)
 * 9. 캐시 성능 추적 및 로깅
 *
 * 라우팅:
 * 이 노드는 라우팅하지 않고 상태만 업데이트합니다.
 * 다음 노드는 Programmer 그래프의 conditional_edge가 결정합니다.
 */

// === 외부 라이브러리 ===
import { v4 as uuidv4 } from "uuid"; // 고유 ID 생성 (메시지 ID 용)

// === Open SWE 공유 타입 ===
import {
  GraphState,    // Programmer 그래프 상태
  GraphConfig,   // 그래프 설정 (GitHub 토큰, 샌드박스 설정 등)
  GraphUpdate,   // 상태 업데이트 타입
  TaskPlan,      // 작업 계획 타입
} from "@openswe/shared/open-swe/types";

// === LLM 모델 관리 ===
import {
  getModelManager,                 // 모델 매니저 싱글톤 가져오기
  loadModel,                       // LLM 모델 로드 (프로바이더별 도구/메시지 적용)
  Provider,                        // LLM 프로바이더 타입 (anthropic, openai, google-genai)
  supportsParallelToolCallsParam,  // 병렬 도구 호출 지원 여부
} from "../../../../utils/llms/index.js";
import { LLMTask } from "@openswe/shared/open-swe/llm-task"; // LLM 작업 타입 (PROGRAMMER, PLANNER 등)

// === 도구 생성 함수들 ===
import {
  createShellTool,                    // Shell 명령 실행 도구
  createApplyPatchTool,               // Git 패치 적용 도구 (OpenAI/Google용)
  createRequestHumanHelpToolFields,   // 사람 도움 요청 도구
  createUpdatePlanToolFields,         // 계획 업데이트 도구
  createGetURLContentTool,            // URL 컨텐츠 가져오기 도구
  createSearchDocumentForTool,        // LLM 기반 문서 검색 도구
  createWriteDefaultTsConfigTool,     // TypeScript 설정 파일 생성 도구
} from "../../../../tools/index.js";

// === 프롬프트 및 샌드박스 유틸리티 ===
import { formatPlanPrompt } from "../../../../utils/plan-prompt.js"; // 계획을 프롬프트 형식으로 변환
import { stopSandbox } from "../../../../utils/sandbox.js"; // 샌드박스 중지 (작업 완료 시)

// === 로깅 및 작업 유틸리티 ===
import { createLogger, LogLevel } from "../../../../utils/logger.js";
import { getCurrentPlanItem } from "../../../../utils/current-task.js"; // 현재 작업 항목 가져오기
import { getMessageContentString } from "@openswe/shared/messages"; // 메시지 내용 문자열 추출
import { getActivePlanItems } from "@openswe/shared/open-swe/tasks"; // 활성 작업 항목 목록

// === 프롬프트 템플릿 ===
import {
  CODE_REVIEW_PROMPT,                    // 코드 리뷰 프롬프트
  DEPENDENCIES_INSTALLED_PROMPT,         // 의존성 설치됨 프롬프트
  DEPENDENCIES_NOT_INSTALLED_PROMPT,     // 의존성 미설치 프롬프트
  DYNAMIC_SYSTEM_PROMPT,                 // 동적 시스템 프롬프트 (계획, 코드베이스 트리)
  STATIC_ANTHROPIC_SYSTEM_INSTRUCTIONS,  // Anthropic 정적 지침
  STATIC_SYSTEM_INSTRUCTIONS,            // 일반 정적 지침 (OpenAI/Google)
  CUSTOM_FRAMEWORK_PROMPT,               // 커스텀 프레임워크 프롬프트
} from "./prompt.js";

// === Git 및 GitHub 유틸리티 ===
import { getRepoAbsolutePath } from "@openswe/shared/git"; // 저장소 절대 경로
import { getMissingMessages } from "../../../../utils/github/issue-messages.js"; // GitHub 이슈에서 누락된 메시지 가져오기
import { getPlansFromIssue } from "../../../../utils/github/issue-task.js"; // GitHub 이슈에서 최신 계획 가져오기

// === 추가 도구 ===
import { createGrepTool } from "../../../../tools/grep.js"; // 파일 검색 도구
import { createInstallDependenciesTool } from "../../../../tools/install-dependencies.js"; // 의존성 설치 도구

// === 커스텀 룰 및 MCP ===
import { formatCustomRulesPrompt } from "../../../../utils/custom-rules.js"; // 커스텀 룰 프롬프트 포맷팅
import { getMcpTools } from "../../../../utils/mcp-client.js"; // MCP 프로토콜 도구 가져오기

// === 코드 리뷰 유틸리티 ===
import {
  formatCodeReviewPrompt, // 코드 리뷰 프롬프트 포맷팅
  getCodeReviewFields,    // 메시지에서 코드 리뷰 추출
} from "../../../../utils/review.js";

// === 메시지 유틸리티 ===
import { filterMessagesWithoutContent } from "../../../../utils/message/content.js"; // 빈 메시지 필터링

// === 프롬프트 캐싱 ===
import {
  CacheablePromptSegment,                   // 캐시 가능한 프롬프트 세그먼트 타입
  convertMessagesToCacheControlledMessages, // 메시지에 캐시 제어 추가
  trackCachePerformance,                    // 캐시 성능 추적
} from "../../../../utils/caching.js";

// === 작업 완료 도구 ===
import { createMarkTaskCompletedToolFields } from "@openswe/shared/open-swe/tools"; // 작업 완료 표시 도구

// === LangChain 메시지 타입 ===
import {
  BaseMessage,     // 메시지 기본 타입
  BaseMessageLike, // 메시지 유사 타입
  HumanMessage,    // 사람 메시지
} from "@langchain/core/messages";
import { BindToolsInput } from "@langchain/core/language_models/chat_models"; // 도구 바인딩 입력 타입

// === 이슈 및 프레임워크 체크 ===
import { shouldCreateIssue } from "../../../../utils/should-create-issue.js"; // 이슈 생성 필요 여부

// === 리뷰 댓글 도구 ===
import {
  createReplyToReviewCommentTool, // 리뷰 댓글 응답 도구
  createReplyToCommentTool,       // 일반 댓글 응답 도구
  shouldIncludeReviewCommentTool, // 리뷰 댓글 도구 포함 여부
  createReplyToReviewTool,        // 리뷰 응답 도구
} from "../../../../tools/reply-to-review-comment.js";
import { shouldUseCustomFramework } from "../../../../utils/should-use-custom-framework.js"; // 커스텀 프레임워크 사용 여부

/**
 * 로거 인스턴스 생성
 * @constant {Logger}
 */
const logger = createLogger(LogLevel.INFO, "GenerateMessageNode");

/**
 * 동적 컨텍스트 프롬프트를 생성합니다.
 *
 * @description
 * 현재 작업 계획, 컨텍스트 수집 노트, 저장소 경로, 의존성 설치 상태, 코드베이스 트리 등
 * 실행 중 변경되는 동적 정보를 포함한 프롬프트를 생성합니다.
 *
 * 포함 내용:
 * - 활성 작업 계획 항목들 (완료/진행 중/남은 작업)
 * - Planner가 수집한 컨텍스트 노트
 * - 저장소 절대 경로
 * - 의존성 설치 여부 및 안내 메시지
 * - 코드베이스 디렉토리 트리
 *
 * @param {GraphState} state - 현재 GraphState.
 * @returns {string} 생성된 동적 컨텍스트 프롬프트 문자열.
 */
const formatDynamicContextPrompt = (state: GraphState) => {
  const planString = getActivePlanItems(state.taskPlan)
    .map((i) => `<plan-item index="${i.index}">\n${i.plan}\n</plan-item>`)
    .join("\n");
  return DYNAMIC_SYSTEM_PROMPT.replaceAll("{PLAN_PROMPT}", planString)
    .replaceAll(
      "{PLAN_GENERATION_NOTES}",
      state.contextGatheringNotes || "컨텍스트 수집 노트가 없습니다.",
    )
    .replaceAll("{REPO_DIRECTORY}", getRepoAbsolutePath(state.targetRepository))
    .replaceAll(
      "{DEPENDENCIES_INSTALLED_PROMPT}",
      state.dependenciesInstalled
        ? DEPENDENCIES_INSTALLED_PROMPT
        : DEPENDENCIES_NOT_INSTALLED_PROMPT,
    )
    .replaceAll(
      "{CODEBASE_TREE}",
      state.codebaseTree || "코드베이스 트리가 아직 생성되지 않았습니다.",
    );
};

/**
 * 정적 지침 프롬프트를 생성합니다.
 *
 * @description
 * 프로바이더별 정적 지침, 저장소 경로, 커스텀 룰, 커스텀 프레임워크 프롬프트 등
 * 실행 중 변경되지 않는 정적 정보를 포함한 프롬프트를 생성합니다.
 *
 * Anthropic vs 기타 프로바이더:
 * - Anthropic: text_editor_20250429 네이티브 도구 사용 방법 포함
 * - 기타: apply-patch 도구 사용 방법 포함
 *
 * @param {GraphState} state - 현재 GraphState.
 * @param {GraphConfig} config - 그래프 설정.
 * @param {boolean} isAnthropicModel - Anthropic 모델 사용 여부.
 * @returns {string} 생성된 정적 지침 프롬프트 문자열.
 */
const formatStaticInstructionsPrompt = (
  state: GraphState,
  config: GraphConfig,
  isAnthropicModel: boolean,
) => {
  return (
    isAnthropicModel
      ? STATIC_ANTHROPIC_SYSTEM_INSTRUCTIONS
      : STATIC_SYSTEM_INSTRUCTIONS
  )
    .replaceAll("{REPO_DIRECTORY}", getRepoAbsolutePath(state.targetRepository))
    .replaceAll("{CUSTOM_RULES}", formatCustomRulesPrompt(state.customRules))
    .replace(
      "{CUSTOM_FRAMEWORK_PROMPT}",
      shouldUseCustomFramework(config) ? CUSTOM_FRAMEWORK_PROMPT : "",
    )
    .replace("{DEV_SERVER_PROMPT}", ""); // 개발 서버 도구를 추가할 때까지 항상 비워 둡니다.
};

/**
 * 캐시 가능한 프롬프트를 생성합니다 (Anthropic 프롬프트 캐싱).
 *
 * @description
 * Anthropic의 프롬프트 캐싱 기능을 활용하여 반복되는 프롬프트 부분을 캐시합니다.
 * 4단계 캐시 전략:
 * - Cache Breakpoint 1: 도구 정의 (createToolsAndPrompt에서 처리)
 * - Cache Breakpoint 2: 정적 지침 (시스템 프롬프트, 커스텀 룰)
 * - Cache Breakpoint 3: 동적 컨텍스트 (계획, 코드베이스 트리) - 자주 변경됨
 * - Cache Breakpoint 4: 코드 리뷰 (있는 경우에만)
 *
 * 비용 절감:
 * - 캐시된 토큰은 90% 비용 절감
 * - 정적 지침은 거의 변경되지 않으므로 높은 캐시 적중률
 *
 * @param {GraphState} state - 현재 GraphState.
 * @param {GraphConfig} config - 그래프 설정.
 * @param {Object} args - 추가 인수
 * @param {boolean} args.isAnthropicModel - Anthropic 모델 사용 여부
 * @param {boolean} args.excludeCacheControl - 캐시 제어 제외 여부 (OpenAI/Google용)
 * @returns {CacheablePromptSegment[]} 생성된 캐시 가능 프롬프트 세그먼트 배열.
 */
const formatCacheablePrompt = (
  state: GraphState,
  config: GraphConfig,
  args?: {
    isAnthropicModel?: boolean;
    excludeCacheControl?: boolean;
  },
): CacheablePromptSegment[] => {
  const codeReview = getCodeReviewFields(state.internalMessages);

  const segments: CacheablePromptSegment[] = [
    // === Cache Breakpoint 2: 정적 지침 (캐시 적중률 높음) ===
    {
      type: "text",
      text: formatStaticInstructionsPrompt(
        state,
        config,
        !!args?.isAnthropicModel,
      ),
      ...(!args?.excludeCacheControl
        ? { cache_control: { type: "ephemeral" } }
        : {}),
    },

    // === Cache Breakpoint 3: 동적 컨텍스트 (자주 변경됨) ===
    // 계획 진행에 따라 자주 변경되므로 캐시 적중률 낮음
    {
      type: "text",
      text: formatDynamicContextPrompt(state),
    },
  ];

  // === Cache Breakpoint 4: 코드 리뷰 컨텍스트 (선택적) ===
  // Reviewer에서 피드백이 있을 때만 추가
  if (codeReview) {
    segments.push({
      type: "text",
      text: formatCodeReviewPrompt(CODE_REVIEW_PROMPT, {
        review: codeReview.review,
        newActions: codeReview.newActions,
      }),
      ...(!args?.excludeCacheControl
        ? { cache_control: { type: "ephemeral" } }
        : {}),
    });
  }

  // 빈 세그먼트 필터링
  return segments.filter((segment) => segment.text.trim() !== "");
};

/**
 * 작업 계획 세부 정보 프롬프트 템플릿
 * @constant {string}
 * @description
 * 현재 작업 중인 계획 항목을 강조하는 프롬프트 템플릿입니다.
 * 완료된 작업, 현재 작업, 남은 작업을 모두 보여줍니다.
 */
const planSpecificPrompt = `<detailed_plan_information>
작업 중인 요청에 대한 작업 실행 계획은 다음과 같습니다.
위에 제공된 모든 지침, 메시지 및 컨텍스트를 주의 깊게 읽으십시오.
현재 작업 상태를 명확하게 이해한 후 아래 제공된 계획을 분석하고 이를 기반으로 조치를 취하십시오.
완료된 작업, 현재 작업 및 남은 작업을 포함하여 전체 작업 목록이 제공됩니다.

현재 작업을 실행하는 중입니다:

{PLAN_PROMPT}
</detailed_plan_information>`;

/**
 * 특정 계획 프롬프트를 생성합니다.
 *
 * @description
 * 현재 활성 작업 계획을 포맷팅하여 HumanMessage로 반환합니다.
 * 이 메시지는 LLM에게 현재 무엇을 해야 하는지 명확히 알려줍니다.
 *
 * @param {GraphState} state - 현재 GraphState.
 * @returns {HumanMessage} 생성된 HumanMessage.
 */
const formatSpecificPlanPrompt = (state: GraphState): HumanMessage => {
  return new HumanMessage({
    id: uuidv4(),
    content: planSpecificPrompt.replace(
      "{PLAN_PROMPT}",
      formatPlanPrompt(getActivePlanItems(state.taskPlan)),
    ),
  });
};

/**
 * 도구와 프롬프트를 생성합니다.
 *
 * @description
 * 프로바이더별로 다른 도구 세트와 프롬프트를 생성합니다.
 *
 * 프로바이더별 차이:
 * - **Anthropic**: text_editor_20250429 네이티브 도구 사용, 프롬프트 캐싱 적용
 * - **OpenAI/Google**: apply-patch 도구 사용, 캐싱 미적용
 *
 * 공통 도구:
 * - grep, shell, request-human-help, update-plan
 * - get-url-content, install-dependencies, mark-task-completed
 * - search-document-for, write-default-tsconfig
 * - MCP 도구들
 *
 * Cache Breakpoint 1:
 * - 도구 정의의 마지막 도구(text_editor 또는 apply-patch)에 cache_control 추가
 *
 * @param {GraphState} state - 현재 GraphState.
 * @param {GraphConfig} config - 그래프 설정.
 * @param {Object} options - 추가 옵션
 * @param {TaskPlan | null} options.latestTaskPlan - GitHub 이슈에서 가져온 최신 작업 계획
 * @param {BaseMessage[]} options.missingMessages - GitHub 이슈에서 가져온 누락된 메시지
 * @returns {Promise<{providerTools, providerMessages}>} 제공자별 도구 및 메시지.
 */
async function createToolsAndPrompt(
  state: GraphState,
  config: GraphConfig,
  options: {
    latestTaskPlan: TaskPlan | null;
    missingMessages: BaseMessage[];
  },
): Promise<{
  providerTools: Record<Provider, BindToolsInput[]>;
  providerMessages: Record<Provider, BaseMessageLike[]>;
}> {
  // === 1단계: MCP 도구 로드 ===
  const mcpTools = await getMcpTools(config);

  // === 2단계: 모든 프로바이더에 공통으로 제공되는 도구들 ===
  const sharedTools = [
    createGrepTool(state, config),               // 파일 내용 검색
    createShellTool(state, config),              // Shell 명령 실행
    createRequestHumanHelpToolFields(),          // 사람 도움 요청
    createUpdatePlanToolFields(),                // 계획 업데이트
    createGetURLContentTool(state),              // URL 컨텐츠 가져오기
    createInstallDependenciesTool(state, config), // 의존성 설치
    createMarkTaskCompletedToolFields(),         // 작업 완료 표시
    createSearchDocumentForTool(state, config),  // LLM 기반 문서 검색
    createWriteDefaultTsConfigTool(state, config), // TypeScript 설정 파일 생성
    // 리뷰 컨텍스트가 있는 경우에만 리뷰 댓글 도구 추가
    ...(shouldIncludeReviewCommentTool(state, config)
      ? [
          createReplyToReviewCommentTool(state, config),
          createReplyToCommentTool(state, config),
          createReplyToReviewTool(state, config),
        ]
      : []),
    ...mcpTools, // 외부 MCP 도구들
  ];

  logger.info(
    `프로그래머에 추가된 MCP 도구: ${mcpTools.map((t) => t.name).join(", ")}`,
  );

  // === 3단계: Anthropic 전용 도구 세트 ===
  // Cache Breakpoint 1: 마지막 도구(text_editor)에 cache_control 추가
  const anthropicModelTools = [
    ...sharedTools,
    {
      type: "text_editor_20250429", // Anthropic 네이티브 편집 도구
      name: "str_replace_based_edit_tool",
      cache_control: { type: "ephemeral" }, // 도구 정의 캐싱
    },
  ];

  // === 4단계: OpenAI/Google 전용 도구 세트 ===
  const nonAnthropicModelTools = [
    ...sharedTools,
    {
      ...createApplyPatchTool(state, config), // Unified Diff 패치 도구
      cache_control: { type: "ephemeral" },   // 도구 정의 캐싱 (지원 안 되지만 추가)
    },
  ];

  // === 5단계: 입력 메시지 준비 ===
  // 빈 메시지 필터링 (content가 없는 메시지 제거)
  const inputMessages = filterMessagesWithoutContent([
    ...state.internalMessages,
    ...options.missingMessages, // GitHub 이슈에서 가져온 누락된 메시지 추가
  ]);
  if (!inputMessages.length) {
    throw new Error("처리할 메시지가 없습니다.");
  }

  // === 6단계: Anthropic 메시지 생성 (프롬프트 캐싱 적용) ===
  const anthropicMessages = [
    {
      role: "system",
      content: formatCacheablePrompt(
        {
          ...state,
          taskPlan: options.latestTaskPlan ?? state.taskPlan, // 최신 계획 사용
        },
        config,
        {
          isAnthropicModel: true,
          excludeCacheControl: false, // 캐시 제어 포함
        },
      ),
    },
    // 기존 메시지들에 캐시 제어 추가
    ...convertMessagesToCacheControlledMessages(inputMessages),
    // 현재 작업 계획 강조
    formatSpecificPlanPrompt(state),
  ];

  // === 7단계: OpenAI/Google 메시지 생성 (캐싱 미적용) ===
  const nonAnthropicMessages = [
    {
      role: "system",
      content: formatCacheablePrompt(
        {
          ...state,
          taskPlan: options.latestTaskPlan ?? state.taskPlan,
        },
        config,
        {
          isAnthropicModel: false,
          excludeCacheControl: true, // 캐시 제어 제외
        },
      ),
    },
    ...inputMessages, // 원본 메시지 그대로 사용
    formatSpecificPlanPrompt(state),
  ];

  // === 8단계: 프로바이더별 도구 및 메시지 반환 ===
  return {
    providerTools: {
      anthropic: anthropicModelTools,
      openai: nonAnthropicModelTools,
      "google-genai": nonAnthropicModelTools,
    },
    providerMessages: {
      anthropic: anthropicMessages,
      openai: nonAnthropicMessages,
      "google-genai": nonAnthropicMessages,
    },
  };
}

/**
 * LLM을 사용하여 다음에 수행할 액션을 생성하는 노드입니다.
 *
 * @description
 * Programmer 그래프의 핵심 노드로, LLM을 호출하여 다음 단계의 도구 호출을 생성합니다.
 *
 * 처리 흐름:
 * 1. 모델 매니저에서 PROGRAMMER 작업용 모델 이름 가져오기
 * 2. 병렬 도구 호출 지원 여부 확인
 * 3. GitHub 이슈에서 누락된 메시지 및 최신 계획 가져오기 (선택적)
 * 4. 프로바이더별 도구 및 프롬프트 생성
 * 5. 모델 로드 및 도구 바인딩
 * 6. LLM 호출하여 다음 액션 생성
 * 7. 도구 호출이 없으면 샌드박스 중지 (작업 완료)
 * 8. mark_task_completed 검증 (다른 도구와 함께 호출 시 제거)
 * 9. 캐시 성능 추적 및 로깅
 *
 * 특별 처리:
 * - **mark_task_completed**: 이 도구는 단독으로만 호출되어야 함
 *   - 다른 도구와 함께 호출되면 제거 (LLM이 잘못 사용한 경우)
 * - **샌드박스 중지**: 도구 호출이 없으면 작업이 완료된 것으로 간주하고 샌드박스 중지
 * - **계획 동기화**: GitHub 이슈에서 최신 계획을 가져와 상태 업데이트
 *
 * @param {GraphState} state - 현재 GraphState.
 * @param {GraphConfig} config - 그래프 설정.
 * @returns {Promise<GraphUpdate>} 그래프 상태 업데이트.
 */
export async function generateAction(
  state: GraphState,
  config: GraphConfig,
): Promise<GraphUpdate> {
  // === 1단계: 모델 설정 가져오기 ===
  const modelManager = getModelManager();
  const modelName = modelManager.getModelNameForTask(
    config,
    LLMTask.PROGRAMMER,
  );
  const modelSupportsParallelToolCallsParam = supportsParallelToolCallsParam(
    config,
    LLMTask.PROGRAMMER,
  );
  const markTaskCompletedTool = createMarkTaskCompletedToolFields();
  const isAnthropicModel = modelName.includes("claude-");

  // === 2단계: GitHub 이슈 동기화 (선택적) ===
  // shouldCreateIssue가 true면 GitHub 이슈에서 누락된 메시지와 최신 계획 가져오기
  const [missingMessages, { taskPlan: latestTaskPlan }] = shouldCreateIssue(
    config,
  )
    ? await Promise.all([
        getMissingMessages(state, config),
        getPlansFromIssue(state, config),
      ])
    : [[], { taskPlan: null }];

  // === 3단계: 프로바이더별 도구 및 프롬프트 생성 ===
  const { providerTools, providerMessages } = await createToolsAndPrompt(
    state,
    config,
    {
      latestTaskPlan,
      missingMessages,
    },
  );

  // === 4단계: LLM 모델 로드 ===
  const model = await loadModel(config, LLMTask.PROGRAMMER, {
    providerTools: providerTools,
    providerMessages: providerMessages,
  });

  // === 5단계: 도구 바인딩 ===
  const modelWithTools = model.bindTools(
    isAnthropicModel ? providerTools.anthropic : providerTools.openai,
    {
      tool_choice: "auto", // LLM이 자유롭게 도구 선택
      ...(modelSupportsParallelToolCallsParam
        ? {
            parallel_tool_calls: true, // 병렬 도구 호출 활성화
          }
        : {}),
    },
  );

  // === 6단계: LLM 호출 ===
  const response = await modelWithTools.invoke(
    isAnthropicModel ? providerMessages.anthropic : providerMessages.openai,
  );

  // === 7단계: 샌드박스 중지 (도구 호출이 없는 경우) ===
  const hasToolCalls = !!response.tool_calls?.length;
  let newSandboxSessionId: string | undefined;
  if (!hasToolCalls && state.sandboxSessionId) {
    logger.info("도구 호출을 찾을 수 없습니다. 샌드박스를 중지합니다...");
    newSandboxSessionId = await stopSandbox(state.sandboxSessionId);
  }

  // === 8단계: mark_task_completed 검증 ===
  // 이 도구는 단독으로만 호출되어야 함 (다른 도구와 함께 호출 시 제거)
  if (
    response.tool_calls?.length &&
    response.tool_calls?.length > 1 &&
    response.tool_calls.some((t) => t.name === markTaskCompletedTool.name)
  ) {
    logger.error(
      `${markTaskCompletedTool.name}을 포함하여 여러 도구 호출이 발견되었습니다. ${markTaskCompletedTool.name} 호출을 제거합니다.`,
      {
        toolCalls: JSON.stringify(response.tool_calls, null, 2),
      },
    );
    // mark_task_completed 제거
    response.tool_calls = response.tool_calls.filter(
      (t) => t.name !== markTaskCompletedTool.name,
    );
  }

  // === 9단계: 생성된 액션 로깅 ===
  logger.info("생성된 액션", {
    currentTask: getCurrentPlanItem(getActivePlanItems(state.taskPlan)).plan,
    ...(getMessageContentString(response.content) && {
      content: getMessageContentString(response.content),
    }),
    ...(response.tool_calls?.map((tc) => ({
      name: tc.name,
      args: tc.args,
    })) || []),
  });

  // === 10단계: 상태 업데이트 반환 ===
  const newMessagesList = [...missingMessages, response];
  return {
    messages: newMessagesList,           // 사용자 메시지
    internalMessages: newMessagesList,   // 내부 메시지 (LLM 컨텍스트)
    ...(newSandboxSessionId && { sandboxSessionId: newSandboxSessionId }), // 샌드박스 중지 시 업데이트
    ...(latestTaskPlan && { taskPlan: latestTaskPlan }), // 최신 계획 동기화
    tokenData: trackCachePerformance(response, modelName), // 캐시 성능 추적
  };
}
