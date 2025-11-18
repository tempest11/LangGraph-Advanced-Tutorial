/**
 * @file Reviewer 그래프의 리뷰 액션 생성 노드 (generate-review-actions/index.ts)
 * @description
 * LLM을 호출하여 코드 리뷰에 필요한 액션(도구 호출)을 생성하는 Reviewer의 핵심 노드입니다.
 *
 * 주요 기능:
 * 1. **다중 프로바이더 지원**: Anthropic, OpenAI, Google Gemini 지원
 * 2. **프롬프트 캐싱**: Anthropic 전용 캐시 전략으로 비용 최적화
 * 3. **도구 제공**: grep, shell, view, install_dependencies, scratchpad
 * 4. **대화 히스토리 통합**: Programmer의 전체 대화 내역 제공
 * 5. **이전 리뷰 반영**: 여러 리뷰 사이클에서 이전 리뷰 컨텍스트 유지
 *
 * 프롬프트 캐싱 전략 (Anthropic):
 * - Cache Breakpoint 1: 도구 정의 (마지막 도구에 cache_control)
 * - Cache Breakpoint 2: 시스템 프롬프트 (정적 지침, 계획, 코드베이스 트리)
 * - Cache Breakpoint 3: 대화 히스토리 (Programmer의 모든 작업 내역)
 * - Cache Breakpoint 4: Reviewer 메시지 (이전 리뷰 액션)
 *
 * 워크플로우:
 * 1. 모델 매니저에서 REVIEWER 모델 가져오기
 * 2. 도구 생성 (grep, shell, view, install_dependencies, scratchpad)
 * 3. 시스템 프롬프트 생성 (코드베이스 트리, 변경 파일, 계획, 사용자 요청)
 * 4. Programmer 대화 히스토리 포맷팅
 * 5. 프롬프트 캐싱 적용 (Anthropic만)
 * 6. LLM 호출하여 리뷰 액션 생성
 * 7. 캐시 성능 추적 및 로깅
 *
 * 다음 노드:
 * take-review-action (리뷰 액션 실행)
 */

// === LLM 모델 관리 ===
import {
  getModelManager,                 // 모델 매니저 싱글톤 가져오기
  loadModel,                       // LLM 모델 로드 (프로바이더별 메시지 적용)
  Provider,                        // LLM 프로바이더 타입 (anthropic, openai, google-genai)
  supportsParallelToolCallsParam,  // 병렬 도구 호출 지원 여부
} from "../../../../utils/llms/index.js";
import { LLMTask } from "@openswe/shared/open-swe/llm-task"; // LLM 작업 타입 (REVIEWER)

// === Reviewer 타입 ===
import {
  ReviewerGraphState,  // Reviewer 그래프 상태
  ReviewerGraphUpdate, // Reviewer 상태 업데이트
} from "@openswe/shared/open-swe/reviewer/types";

// === 공유 타입 ===
import { GraphConfig } from "@openswe/shared/open-swe/types"; // 그래프 설정

// === 로깅 유틸리티 ===
import { createLogger, LogLevel } from "../../../../utils/logger.js";

// === 메시지 유틸리티 ===
import { getMessageContentString } from "@openswe/shared/messages"; // 메시지 내용 문자열 추출

// === 프롬프트 템플릿 ===
import {
  PREVIOUS_REVIEW_PROMPT,   // 이전 리뷰 프롬프트 (리뷰 사이클 반복 시)
  SYSTEM_PROMPT,            // Reviewer 시스템 프롬프트
  CUSTOM_FRAMEWORK_PROMPT,  // 커스텀 프레임워크 프롬프트 (LangGraph 등)
} from "./prompt.js";

// === 프레임워크 유틸리티 ===
import { shouldUseCustomFramework } from "../../../../utils/should-use-custom-framework.js"; // 커스텀 프레임워크 사용 여부

// === Git 유틸리티 ===
import { getRepoAbsolutePath } from "@openswe/shared/git"; // 저장소 절대 경로

// === 도구 생성 함수들 ===
import {
  createGrepTool,                 // 파일 검색 도구
  createShellTool,                // Shell 명령 실행 도구
  createInstallDependenciesTool,  // 의존성 설치 도구
} from "../../../../tools/index.js";

// === 커스텀 룰 유틸리티 ===
import { formatCustomRulesPrompt } from "../../../../utils/custom-rules.js"; // 커스텀 룰 프롬프트 포맷팅

// === 사용자 요청 유틸리티 ===
import { formatUserRequestPrompt } from "../../../../utils/user-request.js"; // 사용자 요청 프롬프트 포맷팅

// === 작업 계획 유틸리티 ===
import { getActivePlanItems } from "@openswe/shared/open-swe/tasks"; // 활성 계획 항목 가져오기
import { formatPlanPromptWithSummaries } from "../../../../utils/plan-prompt.js"; // 계획 프롬프트 포맷팅

// === 코드 리뷰 유틸리티 ===
import {
  formatCodeReviewPrompt, // 코드 리뷰 프롬프트 포맷팅
  getCodeReviewFields,    // 메시지에서 코드 리뷰 추출
} from "../../../../utils/review.js";

// === LangChain 메시지 타입 ===
import { BaseMessage, BaseMessageLike } from "@langchain/core/messages";

// === 메시지 포맷팅 유틸리티 ===
import { getMessageString } from "../../../../utils/message/content.js"; // 메시지 문자열 변환

// === 프롬프트 캐싱 ===
import {
  CacheablePromptSegment,                   // 캐시 가능한 프롬프트 세그먼트 타입
  convertMessagesToCacheControlledMessages, // 메시지에 캐시 제어 추가
  trackCachePerformance,                    // 캐시 성능 추적
} from "../../../../utils/caching.js";

// === 스크래치패드 도구 ===
import { createScratchpadTool } from "../../../../tools/scratchpad.js"; // 노트 작성 도구

// === 내장 도구 ===
import { createViewTool } from "../../../../tools/builtin-tools/view.js"; // 파일 보기 도구

// === 도구 바인딩 타입 ===
import { BindToolsInput } from "@langchain/core/language_models/chat_models";

/**
 * 로거 인스턴스 생성
 * @constant {Logger}
 */
const logger = createLogger(LogLevel.INFO, "GenerateReviewActionsNode");

/**
 * Reviewer의 시스템 프롬프트를 생성합니다.
 *
 * @description
 * 코드베이스 컨텍스트, 변경 파일 목록, 완료된 작업, 사용자 요청 등을
 * 포함한 종합적인 시스템 프롬프트를 생성합니다.
 *
 * 플레이스홀더 치환:
 * - {CODEBASE_TREE}: 코드베이스 디렉토리 트리
 * - {CURRENT_WORKING_DIRECTORY}: 저장소 절대 경로
 * - {CUSTOM_RULES}: 사용자 정의 규칙
 * - {CHANGED_FILES}: 변경된 파일 목록 (git diff 결과)
 * - {BASE_BRANCH_NAME}: 기본 브랜치 이름
 * - {CUSTOM_FRAMEWORK_PROMPT}: LangGraph 등 커스텀 프레임워크 프롬프트
 * - {COMPLETED_TASKS_AND_SUMMARIES}: 완료된 작업 및 요약
 * - {DEPENDENCIES_INSTALLED}: 의존성 설치 여부 ("예" 또는 "아니오")
 * - {USER_REQUEST_PROMPT}: 사용자 요청 프롬프트
 *
 * 포함 내용:
 * 1. **코드베이스 정보**: 디렉토리 트리, 작업 경로, 변경 파일 목록
 * 2. **작업 컨텍스트**: 완료된 작업, 기본 브랜치, 의존성 상태
 * 3. **사용자 정의**: 커스텀 룰, 커스텀 프레임워크 지침
 * 4. **사용자 요청**: 원래 사용자가 요청한 내용
 *
 * @param {ReviewerGraphState} state - 현재 ReviewerGraphState
 *   - codebaseTree: 코드베이스 트리
 *   - targetRepository: 타겟 저장소
 *   - customRules: 커스텀 룰
 *   - changedFiles: 변경 파일 목록
 *   - baseBranchName: 기본 브랜치 이름
 *   - taskPlan: 작업 계획
 *   - dependenciesInstalled: 의존성 설치 여부
 *   - messages: 사용자 메시지
 *
 * @param {GraphConfig} config - 그래프 설정
 *   - configurable.customFramework: 커스텀 프레임워크 사용 여부
 *
 * @returns {string} 생성된 시스템 프롬프트 문자열
 *
 * @example
 * const systemPrompt = formatSystemPrompt(state, config);
 * // "<codebase_tree>...\n<changed_files>src/file1.ts\nsrc/file2.ts..."
 */
function formatSystemPrompt(
  state: ReviewerGraphState,
  config: GraphConfig,
): string {
  const activePlan = getActivePlanItems(state.taskPlan);
  const tasksString = formatPlanPromptWithSummaries(activePlan);

  return SYSTEM_PROMPT.replaceAll(
    "{CODEBASE_TREE}",
    state.codebaseTree || "코드베이스 트리가 아직 생성되지 않았습니다.",
  )
    .replaceAll(
      "{CURRENT_WORKING_DIRECTORY}",
      getRepoAbsolutePath(state.targetRepository),
    )
    .replaceAll("{CUSTOM_RULES}", formatCustomRulesPrompt(state.customRules))
    .replaceAll("{CHANGED_FILES}", state.changedFiles)
    .replaceAll("{BASE_BRANCH_NAME}", state.baseBranchName)
    .replace(
      "{CUSTOM_FRAMEWORK_PROMPT}",
      shouldUseCustomFramework(config) ? CUSTOM_FRAMEWORK_PROMPT : "",
    )
    .replaceAll("{COMPLETED_TASKS_AND_SUMMARIES}", tasksString)
    .replaceAll(
      "{DEPENDENCIES_INSTALLED}",
      state.dependenciesInstalled ? "예" : "아니오",
    )
    .replaceAll(
      "{USER_REQUEST_PROMPT}",
      formatUserRequestPrompt(state.messages),
    );
}

/**
 * 캐시 가능한 프롬프트 세그먼트를 생성합니다 (Anthropic 프롬프트 캐싱).
 *
 * @description
 * Anthropic의 프롬프트 캐싱 기능을 활용하여 반복되는 프롬프트 부분을 캐시합니다.
 *
 * 캐시 전략:
 * - Cache Breakpoint 2: 시스템 프롬프트 (코드베이스 트리, 계획, 변경 파일 등)
 * - Cache Breakpoint 4: 이전 리뷰 컨텍스트 (리뷰 사이클 반복 시에만)
 *
 * 세그먼트 구성:
 * 1. **시스템 프롬프트**: 코드베이스 정보, 작업 컨텍스트, 사용자 요청
 *    - cache_control: ephemeral (캐시 적용)
 * 2. **이전 리뷰** (선택적): 이전 리뷰 사이클의 피드백 및 액션
 *    - 이전 리뷰가 있는 경우에만 추가
 *
 * @param {ReviewerGraphState} state - 현재 ReviewerGraphState
 *   - internalMessages: Programmer의 내부 메시지 (코드 리뷰 추출용)
 *   - codebaseTree, targetRepository, customRules 등 (시스템 프롬프트용)
 *
 * @param {GraphConfig} config - 그래프 설정
 *
 * @param {Object} [args] - 추가 옵션
 * @param {boolean} [args.excludeCacheControl=false] - 캐시 제어 제외 여부 (OpenAI/Google용)
 *
 * @returns {CacheablePromptSegment[]} 생성된 캐시 가능 프롬프트 세그먼트 배열
 *
 * @example
 * const segments = formatCacheablePrompt(state, config, { excludeCacheControl: false });
 * // [
 * //   { type: "text", text: "시스템 프롬프트...", cache_control: { type: "ephemeral" } },
 * //   { type: "text", text: "이전 리뷰..." }  // 이전 리뷰가 있는 경우
 * // ]
 */
const formatCacheablePrompt = (
  state: ReviewerGraphState,
  config: GraphConfig,
  args?: {
    excludeCacheControl?: boolean;
  },
): CacheablePromptSegment[] => {
  // Programmer의 내부 메시지에서 이전 코드 리뷰 추출
  const codeReview = getCodeReviewFields(state.internalMessages);

  const segments: CacheablePromptSegment[] = [
    // === Cache Breakpoint 2: 시스템 프롬프트 ===
    {
      type: "text",
      text: formatSystemPrompt(state, config),
      ...(!args?.excludeCacheControl
        ? { cache_control: { type: "ephemeral" } }
        : {}),
    },
  ];

  // === Cache Breakpoint 4: 이전 리뷰 컨텍스트 (선택적) ===
  // 리뷰 사이클이 여러 번 반복되는 경우 이전 리뷰를 포함
  if (codeReview) {
    segments.push({
      type: "text",
      text: formatCodeReviewPrompt(PREVIOUS_REVIEW_PROMPT, {
        review: codeReview.review,
        newActions: codeReview.newActions,
      }),
    });
  }

  // 빈 세그먼트 필터링
  return segments.filter((segment) => segment.text.trim() !== "");
};

/**
 * Programmer의 대화 히스토리를 포맷팅합니다.
 *
 * @description
 * Reviewer가 Programmer의 전체 작업 내역을 확인할 수 있도록
 * 모든 메시지를 <conversation_history> 태그로 감싸 제공합니다.
 *
 * 포함 내용:
 * - Programmer가 수행한 모든 도구 호출
 * - 도구 실행 결과
 * - 사용자 입력
 * - AI 응답
 *
 * 대화 히스토리 잘림 처리:
 * - 대화가 너무 길어 잘린 경우 프롬프트에 명시
 * - Reviewer는 가장 최근 메시지에 집중하도록 지시
 *
 * @param {BaseMessage[]} messages - Programmer의 내부 메시지 배열
 *
 * @param {Object} [args] - 추가 옵션
 * @param {boolean} [args.excludeCacheControl=false] - 캐시 제어 제외 여부
 *
 * @returns {CacheablePromptSegment[]} 캐시 가능 프롬프트 세그먼트 배열
 *
 * @example
 * const historySegments = formatUserConversationHistoryMessage(state.internalMessages);
 * // [
 * //   {
 * //     type: "text",
 * //     text: "<conversation_history>\nAIMessage: ...\nToolMessage: ...\n</conversation_history>",
 * //     cache_control: { type: "ephemeral" }
 * //   }
 * // ]
 */
function formatUserConversationHistoryMessage(
  messages: BaseMessage[],
  args?: {
    excludeCacheControl?: boolean;
  },
): CacheablePromptSegment[] {
  return [
    {
      type: "text",
      text: `프로그래머의 전체 대화 내역입니다. 여기에는 프로그래머가 수행한 모든 작업과 사용자 입력이 포함됩니다.
대화 내역이 너무 길어 잘린 경우 가장 최근 메시지만 고려해야 합니다.

<conversation_history>
${messages.map(getMessageString).join("\n")}
</conversation_history>`,
      // === Cache Breakpoint 3: 대화 히스토리 ===
      ...(!args?.excludeCacheControl
        ? { cache_control: { type: "ephemeral" } }
        : {}),
    },
  ];
}

/**
 * 프로바이더별 도구 및 프롬프트를 생성합니다.
 *
 * @description
 * Anthropic과 OpenAI/Google 프로바이더에 맞는 도구 세트와 메시지 형식을 생성합니다.
 *
 * 제공 도구:
 * 1. **grep**: 파일 내용 검색
 * 2. **shell**: Shell 명령 실행
 * 3. **view**: 파일 보기
 * 4. **install_dependencies**: 의존성 설치
 * 5. **scratchpad**: 검토 중 노트 작성 (최종 리뷰 생성 전)
 *
 * Anthropic 전용 캐싱:
 * - 마지막 도구(scratchpad)에 cache_control 추가 (Cache Breakpoint 1)
 * - 시스템 프롬프트, 대화 히스토리, Reviewer 메시지에 캐싱 적용
 *
 * 메시지 구조:
 * 1. **System**: 시스템 프롬프트 (코드베이스, 계획, 변경 파일)
 * 2. **User**: Programmer 대화 히스토리
 * 3. **Reviewer Messages**: 이전 Reviewer 액션 (있는 경우)
 *
 * @param {ReviewerGraphState} state - 현재 ReviewerGraphState
 *   - internalMessages: Programmer의 대화 히스토리
 *   - reviewerMessages: Reviewer의 이전 메시지
 *
 * @param {GraphConfig} config - 그래프 설정
 *
 * @returns {{providerTools, providerMessages}} 프로바이더별 도구 및 메시지
 *   - providerTools: { anthropic, openai, "google-genai" }
 *   - providerMessages: { anthropic, openai, "google-genai" }
 *
 * @example
 * const { providerTools, providerMessages } = createToolsAndPrompt(state, config);
 * // providerTools.anthropic: [grep, shell, view, install_dependencies, scratchpad (with cache_control)]
 * // providerMessages.anthropic: [system, user, ...reviewerMessages]
 */
function createToolsAndPrompt(
  state: ReviewerGraphState,
  config: GraphConfig,
): {
  providerTools: Record<Provider, BindToolsInput[]>;
  providerMessages: Record<Provider, BaseMessageLike[]>;
} {
  // === 1단계: 모든 도구 생성 ===
  const tools = [
    createGrepTool(state, config),               // 파일 검색
    createShellTool(state, config),              // Shell 명령
    createViewTool(state, config),               // 파일 보기
    createInstallDependenciesTool(state, config), // 의존성 설치
    createScratchpadTool(
      "모든 컨텍스트 수집 및 검토가 완료된 후 최종 검토를 생성할 때",
    ), // 노트 작성 (최종 리뷰 생성 전)
  ];

  // === 2단계: Anthropic 도구 세트 (캐싱 적용) ===
  const anthropicTools = tools;
  // Cache Breakpoint 1: 마지막 도구에 cache_control 추가
  anthropicTools[anthropicTools.length - 1] = {
    ...anthropicTools[anthropicTools.length - 1],
    cache_control: { type: "ephemeral" },
  } as any;

  // === 3단계: OpenAI/Google 도구 세트 (캐싱 미적용) ===
  const nonAnthropicTools = tools;

  // === 4단계: Anthropic 메시지 생성 (캐싱 적용) ===
  const anthropicMessages = [
    {
      role: "system",
      content: formatCacheablePrompt(state, config, {
        excludeCacheControl: false, // 캐시 제어 포함
      }),
    },
    {
      role: "user",
      content: formatUserConversationHistoryMessage(state.internalMessages, {
        excludeCacheControl: false, // 캐시 제어 포함
      }),
    },
    // Reviewer의 이전 메시지에 캐시 제어 추가
    ...convertMessagesToCacheControlledMessages(state.reviewerMessages),
  ];

  // === 5단계: OpenAI/Google 메시지 생성 (캐싱 미적용) ===
  const nonAnthropicMessages = [
    {
      role: "system",
      content: formatCacheablePrompt(state, config, {
        excludeCacheControl: true, // 캐시 제어 제외
      }),
    },
    {
      role: "user",
      content: formatUserConversationHistoryMessage(state.internalMessages, {
        excludeCacheControl: true, // 캐시 제어 제외
      }),
    },
    // 원본 Reviewer 메시지 사용 (캐싱 미적용)
    ...state.reviewerMessages,
  ];

  // === 6단계: 프로바이더별 도구 및 메시지 반환 ===
  return {
    providerTools: {
      anthropic: anthropicTools,
      openai: nonAnthropicTools,
      "google-genai": nonAnthropicTools,
    },
    providerMessages: {
      anthropic: anthropicMessages,
      openai: nonAnthropicMessages,
      "google-genai": nonAnthropicMessages,
    },
  };
}

/**
 * LLM을 사용하여 리뷰 액션을 생성하는 노드입니다.
 *
 * @description
 * Reviewer 그래프의 핵심 노드로, LLM을 호출하여 코드 리뷰에 필요한 액션을 생성합니다.
 *
 * 처리 흐름:
 * 1. **모델 설정 가져오기**: 모델 매니저에서 REVIEWER 작업용 모델 이름 가져오기
 * 2. **병렬 도구 호출 지원 확인**: 프로바이더별 병렬 호출 지원 여부 확인
 * 3. **도구 및 프롬프트 생성**: 프로바이더별 도구 세트 및 메시지 생성
 * 4. **모델 로드 및 도구 바인딩**: LLM 모델 로드 후 도구 바인딩
 * 5. **LLM 호출**: 프로바이더별 메시지로 LLM 호출
 * 6. **결과 로깅**: 생성된 액션 및 도구 호출 로깅
 * 7. **캐시 성능 추적**: Anthropic 프롬프트 캐싱 성능 추적
 *
 * 생성되는 액션:
 * - **grep**: 변경된 파일 검색 및 분석
 * - **view**: 특정 파일 내용 확인
 * - **shell**: 테스트 실행, 빌드 등
 * - **scratchpad**: 검토 중 발견한 이슈 노트 작성
 * - **install_dependencies**: 필요 시 의존성 설치
 *
 * 프롬프트 캐싱 효과:
 * - 시스템 프롬프트, 대화 히스토리, 도구 정의 캐싱
 * - 리뷰 사이클 반복 시 비용 90% 절감
 * - 첫 호출: 전체 토큰 비용
 * - 두 번째 호출부터: 캐시된 토큰 비용만 (10%)
 *
 * 다음 노드:
 * - take-review-action: 생성된 액션 실행
 * - final-review: scratchpad 도구 호출 시 (최종 리뷰 생성)
 *
 * @param {ReviewerGraphState} state - 현재 ReviewerGraphState
 *   - internalMessages: Programmer의 대화 히스토리
 *   - reviewerMessages: Reviewer의 이전 메시지
 *   - codebaseTree: 코드베이스 트리
 *   - changedFiles: 변경 파일 목록
 *   - taskPlan: 작업 계획
 *
 * @param {GraphConfig} config - 그래프 설정
 *   - configurable.models.reviewer: Reviewer LLM 모델 설정
 *
 * @returns {Promise<ReviewerGraphUpdate>} 그래프 상태 업데이트
 *   - messages: [response] - 사용자에게 보이는 메시지
 *   - reviewerMessages: [response] - Reviewer 내부 메시지
 *   - tokenData: 캐시 성능 추적 데이터
 *
 * @example
 * // LangGraph에서 자동 호출
 * const update = await generateReviewActions(state, config);
 * // update.messages[0].tool_calls === [{ name: "grep", args: { pattern: "..." } }, ...]
 * // update.tokenData.cacheReadTokens > 0 (두 번째 호출부터)
 */
export async function generateReviewActions(
  state: ReviewerGraphState,
  config: GraphConfig,
): Promise<ReviewerGraphUpdate> {
  // === 1단계: 모델 설정 가져오기 ===
  const modelManager = getModelManager();
  const modelName = modelManager.getModelNameForTask(config, LLMTask.REVIEWER);
  const modelSupportsParallelToolCallsParam = supportsParallelToolCallsParam(
    config,
    LLMTask.REVIEWER,
  );
  const isAnthropicModel = modelName.includes("claude-");

  // === 2단계: 프로바이더별 도구 및 프롬프트 생성 ===
  const { providerTools, providerMessages } = createToolsAndPrompt(
    state,
    config,
  );

  // === 3단계: LLM 모델 로드 ===
  const model = await loadModel(config, LLMTask.REVIEWER, {
    providerTools,
    providerMessages,
  });

  // === 4단계: 도구 바인딩 ===
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

  // === 5단계: LLM 호출 ===
  const response = await modelWithTools.invoke(
    isAnthropicModel ? providerMessages.anthropic : providerMessages.openai,
  );

  // === 6단계: 생성된 액션 로깅 ===
  logger.info("리뷰 액션 생성됨", {
    ...(getMessageContentString(response.content) && {
      content: getMessageContentString(response.content),
    }),
    ...response.tool_calls?.map((tc) => ({
      name: tc.name,
      args: tc.args,
    })),
  });

  // === 7단계: 상태 업데이트 반환 ===
  return {
    messages: [response],           // 사용자 메시지
    reviewerMessages: [response],   // Reviewer 내부 메시지
    tokenData: trackCachePerformance(response, modelName), // 캐시 성능 추적
  };
}
