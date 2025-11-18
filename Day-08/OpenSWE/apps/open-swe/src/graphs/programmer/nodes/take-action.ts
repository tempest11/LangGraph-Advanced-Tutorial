/**
 * @file Programmer의 도구 실행 노드
 * @description
 * LLM이 요청한 도구 호출들을 실제로 실행하는 핵심 노드입니다.
 * Shell, Text Editor, Grep, Apply Patch 등 10개 이상의 도구를 병렬로 실행하고,
 * 결과를 처리하여 다음 단계로 라우팅합니다.
 *
 * 주요 기능:
 * - 10+ 도구 병렬 실행 (shell, text-editor, grep, apply-patch, MCP 도구 등)
 * - 안전하지 않은 명령 필터링 (로컬 모드 전용)
 * - Git 자동 커밋 (샌드박스 모드, 변경 사항 발생 시)
 * - 에러 진단 라우팅 (연속 실패 감지)
 * - 도구 출력 컨텍스트 제한 관리
 * - 문서 캐시 병합 및 상태 업데이트
 *
 * 실행 워크플로우:
 * 1. 마지막 AI 메시지에서 도구 호출 추출
 * 2. 모든 도구 초기화 및 맵핑
 * 3. 안전하지 않은 명령 필터링 (로컬 모드)
 * 4. 샌드박스 환경 설정
 * 5. 병렬 도구 호출 실행 (Promise.all)
 * 6. 결과 처리 및 컨텍스트 제한 적용
 * 7. Git 커밋 (샌드박스 모드, 변경 발생 시)
 * 8. 에러 진단 필요 여부 판단
 * 9. 다음 노드로 라우팅 (diagnose-error or generate-action)
 */

// 외부 라이브러리
import { v4 as uuidv4 } from "uuid";
import { isAIMessage, ToolMessage, AIMessage } from "@langchain/core/messages";
// 유틸리티 함수
import { createLogger, LogLevel } from "../../../utils/logger.js"; // 로거 생성
// 도구 생성 함수들
import {
  createApplyPatchTool, // Patch 파일 적용 도구
  createGetURLContentTool, // URL 콘텐츠 가져오기 도구
  createTextEditorTool, // 텍스트 편집기 도구
  createShellTool, // Shell 명령 실행 도구
  createSearchDocumentForTool, // 문서 검색 도구
  createWriteDefaultTsConfigTool, // 기본 tsconfig 작성 도구
} from "../../../tools/index.js";
// Open SWE 공유 타입
import {
  GraphState, // 그래프 전역 상태 타입
  GraphConfig, // LangGraph 설정 타입
  GraphUpdate, // 상태 업데이트 타입
  TaskPlan, // 작업 계획 타입
} from "@openswe/shared/open-swe/types";
// Git 유틸리티
import {
  checkoutBranchAndCommit, // 브랜치 체크아웃 및 커밋
  getChangedFilesStatus, // 변경된 파일 상태 확인
} from "../../../utils/github/git.js";

// Zod 스키마 처리
import {
  safeSchemaToString, // Zod 스키마를 안전하게 문자열로 변환
  safeBadArgsError, // 잘못된 인자 에러 메시지 생성
} from "../../../utils/zod-to-string.js";

// LangGraph 라우팅
import { Command } from "@langchain/langgraph";

// 샌드박스 관리
import { getSandboxWithErrorHandling } from "../../../utils/sandbox.js"; // 샌드박스 가져오기 (에러 처리 포함)

// 코드베이스 트리
import {
  FAILED_TO_GENERATE_TREE_MESSAGE, // 트리 생성 실패 메시지
  getCodebaseTree, // 코드베이스 트리 생성
} from "../../../utils/tree.js";

// 추가 도구들
import { createInstallDependenciesTool } from "../../../tools/install-dependencies.js"; // 의존성 설치 도구
import { isLocalMode } from "@openswe/shared/open-swe/local-mode"; // 로컬 모드 확인
import { createGrepTool } from "../../../tools/grep.js"; // Grep 검색 도구
import { getMcpTools } from "../../../utils/mcp-client.js"; // MCP 프로토콜 도구 가져오기

// 에러 처리
import { shouldDiagnoseError } from "../../../utils/tool-message-error.js"; // 에러 진단 필요 여부 판단

// GitHub 관련
import { getGitHubTokensFromConfig } from "../../../utils/github-tokens.js"; // GitHub 토큰 추출
import { processToolCallContent } from "../../../utils/tool-output-processing.js"; // 도구 출력 처리
import { getActiveTask } from "@openswe/shared/open-swe/tasks"; // 현재 활성 작업
import { createPullRequestToolCallMessage } from "../../../utils/message/create-pr-message.js"; // PR 메시지 생성
import { filterUnsafeCommands } from "../../../utils/command-evaluation.js"; // 안전하지 않은 명령 필터링
import { getRepoAbsolutePath } from "@openswe/shared/git"; // 저장소 절대 경로

// 리뷰 댓글 도구
import {
  createReplyToCommentTool, // 댓글 답변 도구
  createReplyToReviewCommentTool, // 리뷰 댓글 답변 도구
  createReplyToReviewTool, // 리뷰 답변 도구
  shouldIncludeReviewCommentTool, // 리뷰 댓글 도구 포함 여부
} from "../../../tools/reply-to-review-comment.js";

// 로거 인스턴스 생성
const logger = createLogger(LogLevel.INFO, "TakeAction");

/**
 * LLM이 요청한 도구 호출들을 실제로 실행하고 결과를 처리하는 노드 함수입니다
 *
 * @description
 * Programmer 그래프의 핵심 실행 노드로, AI가 요청한 모든 도구 호출을 병렬로 처리합니다.
 * Shell 명령, 파일 편집, 검색, Patch 적용 등 다양한 작업을 수행하고,
 * 변경 사항을 Git에 자동으로 커밋하며, 에러 발생 시 진단 노드로 라우팅합니다.
 *
 * 주요 처리 로직:
 * 1. 마지막 AI 메시지에서 도구 호출 목록 추출
 * 2. 사용 가능한 모든 도구 초기화 (shell, grep, text-editor, apply-patch, MCP 등)
 * 3. 로컬 모드에서 안전하지 않은 명령 필터링
 * 4. 샌드박스 환경 준비 (샌드박스 모드) 또는 로컬 환경 사용
 * 5. 모든 도구 호출을 병렬로 실행 (Promise.all)
 * 6. 각 도구 결과를 ToolMessage로 변환
 * 7. 도구 출력 크기 제한 (higherContextLimitToolNames 제외)
 * 8. 변경된 파일이 있으면 Git 커밋 (샌드박스 모드)
 * 9. 연속 에러 발생 시 diagnose-error 노드로 라우팅
 * 10. 정상 진행 시 generate-action 노드로 라우팅
 *
 * @param {GraphState} state - 현재 그래프 상태
 * @param {GraphConfig} config - LangGraph 설정
 * @returns {Promise<Command>} 다음 노드 라우팅 및 상태 업데이트 명령
 *
 * @throws {Error} 마지막 메시지가 AI 메시지가 아니거나 도구 호출이 없는 경우
 *
 * @example
 * // LangGraph에서 자동으로 호출됨
 * // AI가 여러 도구를 호출했을 때:
 * // [
 * //   { name: "shell", args: { command: "ls -la" } },
 * //   { name: "text-editor", args: { path: "file.ts", content: "..." } }
 * // ]
 * // → 병렬 실행 → Git 커밋 → generate-action으로 라우팅
 */
export async function takeAction(
  state: GraphState,
  config: GraphConfig,
): Promise<Command> {
  // 1️⃣ 마지막 AI 메시지에서 도구 호출 추출
  const lastMessage = state.internalMessages[state.internalMessages.length - 1];

  if (!isAIMessage(lastMessage) || !lastMessage.tool_calls?.length) {
    throw new Error("Last message is not an AI message with tool calls.");
  }

  // 2️⃣ 모든 도구 초기화
  const applyPatchTool = createApplyPatchTool(state, config);
  const shellTool = createShellTool(state, config);
  const searchTool = createGrepTool(state, config);
  const textEditorTool = createTextEditorTool(state, config);
  const installDependenciesTool = createInstallDependenciesTool(state, config);
  const getURLContentTool = createGetURLContentTool(state);
  const searchDocumentForTool = createSearchDocumentForTool(state, config);
  const mcpTools = await getMcpTools(config);
  const writeDefaultTsConfigTool = createWriteDefaultTsConfigTool(
    state,
    config,
  );

  // 더 높은 컨텍스트 제한을 가진 도구들 (출력 크기 제한 완화)
  const higherContextLimitToolNames = [
    ...mcpTools.map((t) => t.name),
    getURLContentTool.name,
    searchDocumentForTool.name,
    writeDefaultTsConfigTool.name,
  ];

  const allTools = [
    shellTool,
    searchTool,
    textEditorTool,
    installDependenciesTool,
    applyPatchTool,
    getURLContentTool,
    searchDocumentForTool,
    writeDefaultTsConfigTool,
    ...(shouldIncludeReviewCommentTool(state, config)
      ? [
          createReplyToReviewCommentTool(state, config),
          createReplyToCommentTool(state, config),
          createReplyToReviewTool(state, config),
        ]
      : []),
    ...mcpTools,
  ];
  // 도구 이름으로 빠른 조회를 위한 맵 생성
  const toolsMap = Object.fromEntries(
    allTools.map((tool) => [tool.name, tool]),
  );

  let toolCalls = lastMessage.tool_calls;
  if (!toolCalls?.length) {
    throw new Error("No tool calls found.");
  }

  // 3️⃣ 로컬 모드에서만 안전하지 않은 명령 필터링
  // (샌드박스 모드에서는 격리된 환경이므로 필터링 불필요)
  let modifiedMessage: AIMessage | undefined;
  let wasFiltered = false;
  if (isLocalMode(config)) {
    const filterResult = await filterUnsafeCommands(toolCalls, config);

    if (filterResult.wasFiltered) {
      wasFiltered = true;
      modifiedMessage = new AIMessage({
        ...lastMessage,
        tool_calls: filterResult.filteredToolCalls,
      });
      toolCalls = filterResult.filteredToolCalls;
    }
  }

  // 4️⃣ 샌드박스 환경 준비 (또는 로컬 환경 사용)
  const { sandbox, dependenciesInstalled } = await getSandboxWithErrorHandling(
    state.sandboxSessionId,
    state.targetRepository,
    state.branchName,
    config,
  );

  // 5️⃣ 모든 도구 호출을 병렬로 실행 (Promise.all로 병렬 처리)
  const toolCallResultsPromise = toolCalls.map(async (toolCall) => {
    const tool = toolsMap[toolCall.name];

    // 도구가 존재하지 않으면 에러 반환
    if (!tool) {
      logger.error(`Unknown tool: ${toolCall.name}`);
      const toolMessage = new ToolMessage({
        id: uuidv4(),
        tool_call_id: toolCall.id ?? "",
        content: `Unknown tool: ${toolCall.name}`,
        name: toolCall.name,
        status: "error",
      });
      return { toolMessage, stateUpdates: undefined };
    }

    // 도구 실행 및 결과 처리
    let result = "";
    let toolCallStatus: "success" | "error" = "success";
    try {
      const toolResult: { result: string; status: "success" | "error" } =
        // @ts-expect-error tool.invoke types are weird here...
        await tool.invoke({
          ...toolCall.args,
          // 샌드박스 모드에서만 세션 ID 전달 (로컬 모드에서는 불필요)
          ...(isLocalMode(config) ? {} : { xSandboxSessionId: sandbox.id }),
        });
      if (typeof toolResult === "string") {
        result = toolResult;
        toolCallStatus = "success";
      } else {
        result = toolResult.result;
        toolCallStatus = toolResult.status;
      }

      if (!result) {
        result =
          toolCallStatus === "success"
            ? "Tool call returned no result"
            : "Tool call failed";
      }
    } catch (e) {
      toolCallStatus = "error";
      // Zod 스키마 검증 실패 (잘못된 인자)
      if (
        e instanceof Error &&
        e.message === "Received tool input did not match expected schema"
      ) {
        logger.error("Received tool input did not match expected schema", {
          toolCall,
          expectedSchema: safeSchemaToString(tool.schema),
        });
        result = safeBadArgsError(tool.schema, toolCall.args, toolCall.name);
      } else {
        // 기타 도구 실행 에러
        logger.error("Failed to call tool", {
          ...(e instanceof Error
            ? { name: e.name, message: e.message, stack: e.stack }
            : { error: e }),
        });
        const errMessage = e instanceof Error ? e.message : "Unknown error";
        result = `FAILED TO CALL TOOL: "${toolCall.name}"\n\n${errMessage}`;
      }
    }

    // 6️⃣ 도구 출력 크기 제한 적용 및 문서 캐시 업데이트 추출
    const { content, stateUpdates } = await processToolCallContent(
      toolCall,
      result,
      {
        higherContextLimitToolNames,
        state,
        config,
      },
    );

    // ToolMessage 생성 (LangChain 메시지 형식)
    const toolMessage = new ToolMessage({
      id: uuidv4(),
      tool_call_id: toolCall.id ?? "",
      content,
      name: toolCall.name,
      status: toolCallStatus,
    });

    return { toolMessage, stateUpdates };
  });

  const toolCallResultsWithUpdates = await Promise.all(toolCallResultsPromise);
  const toolCallResults = toolCallResultsWithUpdates.map(
    (item) => item.toolMessage,
  );

  // 7️⃣ 모든 도구 호출의 문서 캐시 업데이트 병합
  // (searchDocumentFor, getURLContent 등이 반환한 문서 캐시를 하나로 합침)
  const allStateUpdates = toolCallResultsWithUpdates
    .map((item) => item.stateUpdates)
    .filter(Boolean)
    .reduce(
      (acc: { documentCache: Record<string, string> }, update) => {
        if (update?.documentCache) {
          acc.documentCache = { ...acc.documentCache, ...update.documentCache };
        }
        return acc;
      },
      { documentCache: {} } as { documentCache: Record<string, string> },
    );

  // 8️⃣ 의존성 설치 도구가 성공했는지 확인
  let wereDependenciesInstalled: boolean | null = null;
  toolCallResults.forEach((toolCallResult) => {
    if (toolCallResult.name === installDependenciesTool.name) {
      wereDependenciesInstalled = toolCallResult.status === "success";
    }
  });

  // 9️⃣ Git 커밋 준비 (브랜치명, PR 번호, 작업 계획)
  let branchName: string | undefined = state.branchName;
  let pullRequestNumber: number | undefined;
  let updatedTaskPlan: TaskPlan | undefined;

  // 샌드박스 모드에서만 Git 커밋 수행 (로컬 모드는 사용자가 직접 커밋)
  if (!isLocalMode(config)) {
    const repoPath = getRepoAbsolutePath(state.targetRepository);
    const changedFiles = await getChangedFilesStatus(repoPath, sandbox, config);

    if (changedFiles.length > 0) {
      logger.info(`Has ${changedFiles.length} changed files. Committing.`, {
        changedFiles,
      });

      // GitHub 토큰 가져오기 및 자동 커밋 수행
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
      // 커밋 결과에서 브랜치명, PR 번호, 업데이트된 작업 계획 추출
      branchName = result.branchName;
      pullRequestNumber = result.updatedTaskPlan
        ? getActiveTask(result.updatedTaskPlan)?.pullRequestNumber
        : undefined;
      updatedTaskPlan = result.updatedTaskPlan;
    }
  }

  // 🔟 에러 진단 노드로 라우팅할지 판단 (연속 실패 감지)
  const shouldRouteDiagnoseNode = shouldDiagnoseError([
    ...state.internalMessages,
    ...toolCallResults,
  ]);

  // 1️⃣1️⃣ 코드베이스 트리 업데이트
  const codebaseTree = await getCodebaseTree(config);

  // 트리 생성 실패 시 이전 트리로 폴백 (없으면 실패 메시지 사용)
  const codebaseTreeToReturn =
    codebaseTree === FAILED_TO_GENERATE_TREE_MESSAGE
      ? (state.codebaseTree ?? codebaseTree)
      : codebaseTree;

  // 1️⃣2️⃣ 의존성 설치 상태 업데이트 결정
  // (이번 실행에서 설치했으면 우선, 아니면 이전 상태 유지)
  const dependenciesInstalledUpdate =
    wereDependenciesInstalled !== null
      ? wereDependenciesInstalled
      : dependenciesInstalled !== null
        ? dependenciesInstalled
        : null;

  // 1️⃣3️⃣ 사용자에게 보여질 메시지 업데이트 생성
  // Draft PR이 열렸으면 PR 메시지도 추가
  const userFacingMessagesUpdate = [
    ...toolCallResults,
    ...(updatedTaskPlan && pullRequestNumber
      ? createPullRequestToolCallMessage(
          state.targetRepository,
          pullRequestNumber,
          true,
        )
      : []),
  ];

  // 1️⃣4️⃣ 내부 메시지 업데이트 생성
  // 필터링된 메시지가 있으면 원본 대신 필터링된 버전 포함
  const internalMessagesUpdate =
    wasFiltered && modifiedMessage
      ? [modifiedMessage, ...toolCallResults]
      : toolCallResults;

  // 1️⃣5️⃣ 최종 Command 객체 생성 (라우팅 + 상태 업데이트)
  const commandUpdate: GraphUpdate = {
    messages: userFacingMessagesUpdate,
    internalMessages: internalMessagesUpdate,
    ...(branchName && { branchName }),
    ...(updatedTaskPlan && {
      taskPlan: updatedTaskPlan,
    }),
    codebaseTree: codebaseTreeToReturn,
    sandboxSessionId: sandbox.id,
    ...(dependenciesInstalledUpdate !== null && {
      dependenciesInstalled: dependenciesInstalledUpdate,
    }),
    ...allStateUpdates,
  };
  return new Command({
    goto: shouldRouteDiagnoseNode ? "diagnose-error" : "generate-action",
    update: commandUpdate,
  });
}
