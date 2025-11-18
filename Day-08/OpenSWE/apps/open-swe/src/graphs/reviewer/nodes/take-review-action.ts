/**
 * @file Reviewer 그래프의 액션 실행 노드 (take-review-action.ts)
 * @description
 * Reviewer LLM이 생성한 리뷰 액션(도구 호출)을 실행하는 노드입니다.
 *
 * 주요 기능:
 * 1. **읽기 전용 도구 실행**: grep, shell, view, scratchpad 등 검사 도구 실행
 * 2. **병렬 실행**: 여러 도구 호출을 동시에 실행하여 성능 최적화
 * 3. **Git 커밋**: 파일 변경 시 자동 커밋 (Reviewer가 의도치 않게 파일 수정한 경우)
 * 4. **최대 액션 제한**: 무한 루프 방지를 위한 최대 액션 수 제한
 * 5. **에러 진단 라우팅**: 도구 실행 실패 시 diagnose-reviewer-error 노드로 라우팅
 * 6. **안전 필터링**: 로컬 모드에서 위험한 명령어 필터링
 *
 * 워크플로우:
 * 1. 마지막 Reviewer 메시지에서 도구 호출 추출
 * 2. 도구 생성 (grep, shell, view, install_dependencies, scratchpad)
 * 3. 로컬 모드에서 위험한 명령어 필터링 (rm -rf 등)
 * 4. 샌드박스 연결
 * 5. 도구 호출 병렬 실행
 * 6. Git 커밋 (파일 변경 감지 시)
 * 7. 최대 액션 수 확인 (초과 시 final-review로 강제 이동)
 * 8. 에러 진단 필요 여부 판단
 * 9. 다음 노드로 라우팅
 *
 * 라우팅:
 * - final-review: 최대 액션 수 초과 시
 * - diagnose-reviewer-error: 도구 실행 실패 감지 시
 * - generate-review-actions: 정상 실행 시 (다음 리뷰 액션 생성)
 *
 * 최대 액션 제한:
 * - maxReviewActions (기본값: 30)
 * - AI 메시지 + 도구 메시지 쌍 = 2개 메시지
 * - 최대 메시지 수 = maxReviewActions * 2 = 60
 * - 초과 시 자동으로 final-review로 이동 (무한 루프 방지)
 */

// === 외부 라이브러리 ===
import { v4 as uuidv4 } from "uuid"; // 고유 ID 생성

// === LangChain 메시지 타입 ===
import {
  isAIMessage,   // AI 메시지 타입 가드
  isToolMessage, // 도구 메시지 타입 가드
  ToolMessage,   // 도구 실행 결과 메시지
  AIMessage,     // AI가 생성한 메시지
} from "@langchain/core/messages";

// === 도구 생성 함수들 ===
import {
  createInstallDependenciesTool, // 의존성 설치 도구
  createShellTool,                // Shell 명령 실행 도구
} from "../../../tools/index.js";

// === 타입 정의 ===
import { GraphConfig, TaskPlan } from "@openswe/shared/open-swe/types";
import {
  ReviewerGraphState,  // Reviewer 그래프 상태
  ReviewerGraphUpdate, // Reviewer 상태 업데이트
} from "@openswe/shared/open-swe/reviewer/types";

// === 로깅 유틸리티 ===
import { createLogger, LogLevel } from "../../../utils/logger.js";

// === Zod 스키마 유틸리티 ===
import { zodSchemaToString } from "../../../utils/zod-to-string.js"; // Zod 스키마 문자열 변환
import { formatBadArgsError } from "../../../utils/zod-to-string.js"; // 잘못된 인자 에러 포맷팅

// === 출력 유틸리티 ===
import { truncateOutput } from "../../../utils/truncate-outputs.js"; // 출력 길이 제한

// === Grep 도구 ===
import { createGrepTool } from "../../../tools/grep.js"; // 파일 검색 도구

// === GitHub Git 유틸리티 ===
import {
  checkoutBranchAndCommit, // 브랜치 체크아웃 및 커밋
  getChangedFilesStatus,   // 변경된 파일 상태 확인
} from "../../../utils/github/git.js";

// === 샌드박스 유틸리티 ===
import { getSandboxWithErrorHandling } from "../../../utils/sandbox.js";

// === 로컬 모드 ===
import { isLocalMode } from "@openswe/shared/open-swe/local-mode";

// === LangGraph Command ===
import { Command } from "@langchain/langgraph"; // 다음 노드 라우팅 + 상태 업데이트

// === 에러 진단 유틸리티 ===
import { shouldDiagnoseError } from "../../../utils/tool-message-error.js"; // 에러 진단 필요 여부

// === 메시지 필터링 ===
import { filterHiddenMessages } from "../../../utils/message/filter-hidden.js"; // 숨겨진 메시지 필터링

// === GitHub 토큰 유틸리티 ===
import { getGitHubTokensFromConfig } from "../../../utils/github-tokens.js";

// === 스크래치패드 도구 ===
import { createScratchpadTool } from "../../../tools/scratchpad.js";

// === 작업 계획 유틸리티 ===
import { getActiveTask } from "@openswe/shared/open-swe/tasks"; // 현재 활성 작업 가져오기

// === PR 메시지 생성 ===
import { createPullRequestToolCallMessage } from "../../../utils/message/create-pr-message.js";

// === View 도구 ===
import { createViewTool } from "../../../tools/builtin-tools/view.js"; // 파일 보기 도구

// === 명령어 안전성 평가 ===
import { filterUnsafeCommands } from "../../../utils/command-evaluation.js"; // 위험한 shell 명령어 필터링

// === Git 유틸리티 ===
import { getRepoAbsolutePath } from "@openswe/shared/git"; // 저장소 절대 경로

/**
 * 로거 인스턴스 생성
 * @constant {Logger}
 */
const logger = createLogger(LogLevel.INFO, "TakeReviewAction");

/**
 * Reviewer가 생성한 리뷰 액션을 실행하는 노드입니다.
 *
 * @description
 * Reviewer LLM이 생성한 도구 호출(grep, shell, view, scratchpad 등)을 실행하여
 * 코드 변경 사항을 검토하고 필요한 정보를 수집합니다.
 *
 * 처리 흐름:
 * 1. **도구 호출 추출**: 마지막 Reviewer 메시지에서 tool_calls 가져오기
 * 2. **도구 생성**: grep, shell, view, install_dependencies, scratchpad 생성
 * 3. **안전 필터링**: 로컬 모드에서 rm -rf 같은 위험한 명령어 차단
 * 4. **샌드박스 연결**: 클라우드 샌드박스 또는 로컬 파일시스템
 * 5. **병렬 실행**: Promise.all로 모든 도구 호출 동시 실행
 * 6. **Git 커밋**: 파일 변경 감지 시 자동 커밋 (Reviewer가 의도치 않게 수정한 경우)
 * 7. **최대 액션 확인**: maxReviewActions * 2 초과 시 final-review로 강제 이동
 * 8. **에러 진단 판단**: 도구 실행 실패 시 diagnose-reviewer-error 노드로
 * 9. **라우팅**: 다음 노드 결정
 *
 * 최대 액션 제한:
 * - Reviewer가 무한 루프에 빠지는 것을 방지
 * - maxReviewActions (기본값: 30) * 2 = 60개 메시지
 * - AI 메시지 + 도구 메시지 = 2개 메시지 (1 액션)
 * - 30 액션 = 60 메시지
 * - 초과 시 강제로 final-review로 이동하여 리뷰 마무리
 *
 * Git 커밋:
 * - Reviewer는 읽기 전용이어야 하지만
 * - 실수로 파일을 수정한 경우 자동 커밋 수행
 * - 일반적으로는 발생하지 않아야 함
 *
 * 특징:
 * - **병렬 실행**: 여러 도구 호출을 동시에 처리
 * - **안전 장치**: 로컬 모드에서 위험한 명령어 필터링
 * - **무한 루프 방지**: 최대 액션 수 제한
 * - **출력 길이 제한**: 너무 긴 출력은 잘라내기 (truncateOutput)
 *
 * @param {ReviewerGraphState} state - 현재 ReviewerGraphState
 *   - reviewerMessages: Reviewer의 메시지 히스토리
 *   - sandboxSessionId: 샌드박스 세션 ID
 *   - targetRepository: 타겟 GitHub 저장소
 *   - branchName: 작업 중인 브랜치 이름
 *   - taskPlan: 작업 계획
 *
 * @param {GraphConfig} config - 그래프 설정
 *   - configurable.maxReviewActions: 최대 리뷰 액션 수 (기본값: 30)
 *   - configurable.localMode: 로컬 모드 여부
 *
 * @returns {Promise<Command>} LangGraph Command 객체
 *   - goto: 다음 노드 이름
 *     - "final-review": 최대 액션 수 초과 시
 *     - "diagnose-reviewer-error": 에러 발생 시
 *     - "generate-review-actions": 정상 시
 *   - update: 상태 업데이트 객체
 *
 * @throws {Error} 마지막 메시지가 AI 메시지가 아니거나 도구 호출이 없는 경우
 *
 * @example
 * // LangGraph 워크플로우에서 자동 호출
 * const result = await takeReviewerActions(state, config);
 * // result.goto === "generate-review-actions" (정상)
 * // result.goto === "final-review" (최대 액션 초과)
 * // result.goto === "diagnose-reviewer-error" (에러 발생)
 */
export async function takeReviewerActions(
  state: ReviewerGraphState,
  config: GraphConfig,
): Promise<Command> {
  // === 1단계: 도구 호출 검증 ===
  const { reviewerMessages } = state;
  const lastMessage = reviewerMessages[reviewerMessages.length - 1];

  // AI 메시지가 아니거나 도구 호출이 없으면 에러
  if (!isAIMessage(lastMessage) || !lastMessage.tool_calls?.length) {
    throw new Error("마지막 메시지가 도구 호출이 있는 AI 메시지가 아닙니다.");
  }

  // === 2단계: 모든 도구 생성 ===
  const shellTool = createShellTool(state, config);               // Shell 명령 실행
  const searchTool = createGrepTool(state, config);               // 파일 검색
  const viewTool = createViewTool(state, config);                 // 파일 보기
  const installDependenciesTool = createInstallDependenciesTool(state, config); // 의존성 설치
  const scratchpadTool = createScratchpadTool("");                // 스크래치패드 (노트 작성)
  const allTools = [
    shellTool,
    searchTool,
    viewTool,
    installDependenciesTool,
    scratchpadTool,
  ];
  const toolsMap = Object.fromEntries(
    allTools.map((tool) => [tool.name, tool]),
  );

  // === 3단계: 도구 호출 확인 ===
  let toolCalls = lastMessage.tool_calls;
  if (!toolCalls?.length) {
    throw new Error("도구 호출을 찾을 수 없습니다.");
  }

  // === 4단계: 안전 필터링 (로컬 모드만) ===
  // 로컬 모드에서만 안전하지 않은 명령어 필터링 (rm -rf, sudo 등)
  let modifiedMessage: AIMessage | undefined;
  let wasFiltered = false;
  if (isLocalMode(config)) {
    const filterResult = await filterUnsafeCommands(toolCalls, config);

    if (filterResult.wasFiltered) {
      wasFiltered = true;
      // 필터링된 도구 호출로 AI 메시지 수정
      modifiedMessage = new AIMessage({
        ...lastMessage,
        tool_calls: filterResult.filteredToolCalls,
      });
      toolCalls = filterResult.filteredToolCalls;
    }
  }

  // === 5단계: 샌드박스 연결 ===
  // 클라우드 모드: Daytona 샌드박스 연결
  // 로컬 모드: 로컬 파일시스템 사용
  const { sandbox, codebaseTree, dependenciesInstalled } =
    await getSandboxWithErrorHandling(
      state.sandboxSessionId,
      state.targetRepository,
      state.branchName,
      config,
    );

  // === 6단계: 도구 호출 병렬 실행 ===
  const toolCallResultsPromise = toolCalls.map(async (toolCall) => {
    const tool = toolsMap[toolCall.name];

    // === 6.1: 알 수 없는 도구 처리 ===
    if (!tool) {
      logger.error(`알 수 없는 도구: ${toolCall.name}`);
      const toolMessage = new ToolMessage({
        id: uuidv4(),
        tool_call_id: toolCall.id ?? "",
        content: `알 수 없는 도구: ${toolCall.name}`,
        name: toolCall.name,
        status: "error",
      });

      return toolMessage;
    }

    logger.info("리뷰 액션 실행 중", {
      ...toolCall,
    });

    // === 6.2: 도구 실행 ===
    let result = "";
    let toolCallStatus: "success" | "error" = "success";
    try {
      const toolResult =
        // @ts-expect-error tool.invoke 타입이 여기서 이상합니다...
        (await tool.invoke({
          ...toolCall.args,
          // 샌드박스 모드에서만 샌드박스 세션 ID 전달
          // 로컬 모드에서는 전달하지 않음
          ...(isLocalMode(config) ? {} : { xSandboxSessionId: sandbox.id }),
        })) as {
          result: string;
          status: "success" | "error";
        };

      result = toolResult.result;
      toolCallStatus = toolResult.status;

      // 빈 결과 처리
      if (!result) {
        result =
          toolCallStatus === "success"
            ? "도구 호출이 결과를 반환하지 않았습니다."
            : "도구 호출에 실패했습니다.";
      }
    } catch (e) {
      // === 6.3: 에러 처리 ===
      toolCallStatus = "error";

      // Zod 스키마 검증 실패
      if (
        e instanceof Error &&
        e.message === "받은 도구 입력이 예상 스키마와 일치하지 않습니다."
      ) {
        logger.error("받은 도구 입력이 예상 스키마와 일치하지 않습니다.", {
          toolCall,
          expectedSchema: zodSchemaToString(tool.schema),
        });
        result = formatBadArgsError(tool.schema, toolCall.args);
      } else {
        // 기타 에러
        logger.error("도구 호출에 실패했습니다.", {
          ...(e instanceof Error
            ? { name: e.name, message: e.message, stack: e.stack }
            : { error: e }),
        });
        const errMessage = e instanceof Error ? e.message : "알 수 없는 오류";
        result = `도구 호출 실패: "${toolCall.name}"\n\n${errMessage}`;
      }
    }

    // === 6.4: ToolMessage 생성 (출력 길이 제한 적용) ===
    const toolMessage = new ToolMessage({
      id: uuidv4(),
      tool_call_id: toolCall.id ?? "",
      content: truncateOutput(result), // 출력 길이 제한
      name: toolCall.name,
      status: toolCallStatus,
    });
    return toolMessage;
  });

  // === 7단계: 모든 도구 실행 완료 대기 ===
  const toolCallResults = await Promise.all(toolCallResultsPromise);

  // === 8단계: Git 커밋 (파일 변경 감지 시) ===
  let branchName: string | undefined = state.branchName;
  let pullRequestNumber: number | undefined;
  let updatedTaskPlan: TaskPlan | undefined;

  if (!isLocalMode(config)) {
    const repoPath = getRepoAbsolutePath(state.targetRepository, config);
    const changedFiles = await getChangedFilesStatus(repoPath, sandbox, config);

    // 파일 변경사항이 있으면 자동 커밋
    // (Reviewer는 읽기 전용이어야 하지만 실수로 수정한 경우)
    if (changedFiles.length > 0) {
      logger.info(`${changedFiles.length}개의 변경된 파일이 있습니다. 커밋합니다.`, {
        changedFiles,
      });

      const { githubInstallationToken } = getGitHubTokensFromConfig(config);
      const result = await checkoutBranchAndCommit(
        config,
        state.targetRepository,
        sandbox,
        {
          branchName,
          githubInstallationToken,
          taskPlan: state.taskPlan,
          githubIssueId: state.githubIssueId,
        },
      );
      branchName = result.branchName;
      pullRequestNumber = result.updatedTaskPlan
        ? getActiveTask(result.updatedTaskPlan)?.pullRequestNumber
        : undefined;
      updatedTaskPlan = result.updatedTaskPlan;
    }
  }

  // === 9단계: 의존성 설치 여부 확인 ===
  let wereDependenciesInstalled: boolean | null = null;
  toolCallResults.forEach((toolCallResult) => {
    if (toolCallResult.name === installDependenciesTool.name) {
      wereDependenciesInstalled = toolCallResult.status === "success";
    }
  });

  // wereDependenciesInstalled를 dependenciesInstalled보다 우선시합니다.
  const dependenciesInstalledUpdate =
    wereDependenciesInstalled !== null
      ? wereDependenciesInstalled
      : dependenciesInstalled !== null
        ? dependenciesInstalled
        : null;

  logger.info("리뷰 액션 완료", {
    ...toolCallResults.map((tc) => ({
      tool_call_id: tc.tool_call_id,
      status: tc.status,
    })),
  });

  // === 10단계: 사용자 메시지 업데이트 생성 ===
  const userFacingMessagesUpdate = [
    ...toolCallResults,
    // Draft PR이 생성되었으면 PR 메시지도 추가
    ...(updatedTaskPlan && pullRequestNumber
      ? createPullRequestToolCallMessage(
          state.targetRepository,
          pullRequestNumber,
          true, // isDraft
        )
      : []),
  ];

  // === 11단계: Reviewer 메시지 업데이트 생성 ===
  // 필터링된 메시지가 있으면 원본 대신 필터링된 버전 포함
  const reviewerMessagesUpdate =
    wasFiltered && modifiedMessage
      ? [modifiedMessage, ...toolCallResults]
      : toolCallResults;

  // === 12단계: 상태 업데이트 객체 생성 ===
  const commandUpdate: ReviewerGraphUpdate = {
    messages: userFacingMessagesUpdate,       // 사용자 메시지
    reviewerMessages: reviewerMessagesUpdate, // Reviewer 내부 메시지
    ...(branchName && { branchName }),        // 브랜치명 업데이트
    ...(updatedTaskPlan && {
      taskPlan: updatedTaskPlan,              // 작업 계획 업데이트
    }),
    ...(codebaseTree ? { codebaseTree } : {}), // 코드베이스 트리
    ...(dependenciesInstalledUpdate !== null && {
      dependenciesInstalled: dependenciesInstalledUpdate, // 의존성 설치 여부
    }),
  };

  // === 13단계: 최대 액션 수 확인 (무한 루프 방지) ===
  const maxReviewActions = config.configurable?.maxReviewActions ?? 30;
  const maxActionsCount = maxReviewActions * 2; // AI 메시지 + 도구 메시지 = 2개
  // 숨겨진 메시지와 AI/도구 메시지가 아닌 메시지를 제외
  const filteredMessages = filterHiddenMessages([
    ...state.reviewerMessages,
    ...(commandUpdate.reviewerMessages ?? []),
  ]).filter((m) => isAIMessage(m) || isToolMessage(m));

  // 허용된 최대 리뷰 액션 수에 도달하면 최종 리뷰로 강제 이동
  if (filteredMessages.length >= maxActionsCount) {
    logger.info("최대 액션 수를 초과하여 최종 리뷰로 이동합니다.", {
      maxActionsCount,
      filteredMessages,
    });
    return new Command({
      goto: "final-review", // 강제로 final-review로 이동
      update: commandUpdate,
    });
  }

  // === 14단계: 에러 진단 노드 라우팅 판단 ===
  const shouldRouteDiagnoseNode = shouldDiagnoseError([
    ...state.reviewerMessages,
    ...toolCallResults,
  ]);

  // === 15단계: Command 객체 생성 및 반환 ===
  return new Command({
    goto: shouldRouteDiagnoseNode
      ? "diagnose-reviewer-error"      // 에러 발생 시
      : "generate-review-actions",     // 정상 시 (다음 리뷰 액션 생성)
    update: commandUpdate,
  });
}
