/**
 * @file Planner 도구 실행 노드
 * @description
 * Planner 그래프에서 컨텍스트 수집을 위한 읽기 전용 도구들을 실행합니다.
 *
 * 주요 기능:
 * 1. 다양한 도구 생성 (view, shell, grep, URL, search, MCP 등)
 * 2. LLM이 요청한 도구 호출들을 병렬로 실행
 * 3. **읽기 전용 강제**: 파일 변경 감지 시 자동 되돌리기
 * 4. 최대 액션 수 제한 체크
 * 5. 에러 발생 시 diagnose-error 노드로 라우팅
 *
 * 처리 흐름:
 * 1. 마지막 AI 메시지에서 도구 호출 추출
 * 2. 도구 생성 (view, shell, grep, scratchpad, URL, search, MCP)
 * 3. 샌드박스 조회/생성
 * 4. 도구 호출 병렬 실행
 * 5. 파일 변경 감지 → 있으면 되돌리고 경고
 * 6. 최대 액션 수 체크 → 초과 시 generate-plan으로 이동
 * 7. 에러 발생 시 diagnose-error, 아니면 generate-plan-context-action
 */

// === UUID ===
import { v4 as uuidv4 } from "uuid"; // 고유 메시지 ID 생성

// === LangChain 메시지 ===
import {
  isAIMessage, // AIMessage 타입 가드
  isToolMessage, // ToolMessage 타입 가드
  ToolMessage, // 도구 실행 결과 메시지
} from "@langchain/core/messages";

// === 로컬 모드 ===
import {
  isLocalMode, // 로컬 모드 여부 확인
  getLocalWorkingDirectory, // 로컬 작업 디렉토리 경로
} from "@openswe/shared/open-swe/local-mode";

// === 도구들 ===
import {
  createGetURLContentTool, // URL 컨텐츠 가져오기 도구
  createShellTool, // 쉘 명령어 실행 도구
  createSearchDocumentForTool, // 문서 검색 도구
} from "../../../tools/index.js";
import { createGrepTool } from "../../../tools/grep.js"; // 파일 내용 검색 도구
import { createScratchpadTool } from "../../../tools/scratchpad.js"; // 노트 작성 도구
import { createViewTool } from "../../../tools/builtin-tools/view.js"; // 파일 보기 도구

// === MCP 도구 ===
import { getMcpTools } from "../../../utils/mcp-client.js"; // Model Context Protocol 도구

// === 타입 정의 ===
import { GraphConfig } from "@openswe/shared/open-swe/types"; // LangGraph 설정 객체
import {
  PlannerGraphState, // Planner 그래프 상태 타입
  PlannerGraphUpdate, // Planner 그래프 업데이트 타입
} from "@openswe/shared/open-swe/planner/types";

// === LangGraph ===
import { Command } from "@langchain/langgraph"; // 다음 노드로 이동하는 Command 객체

// === 로깅 ===
import { createLogger, LogLevel } from "../../../utils/logger.js"; // 구조화된 로거

// === Zod 스키마 유틸리티 ===
import {
  safeSchemaToString, // 스키마를 문자열로 변환
  safeBadArgsError, // 잘못된 인자 에러 메시지 생성
} from "../../../utils/zod-to-string.js";

// === Git 유틸리티 ===
import {
  getChangedFilesStatus, // 변경된 파일 조회
  stashAndClearChanges, // 변경사항 되돌리기
} from "../../../utils/github/git.js";
import { getRepoAbsolutePath } from "@openswe/shared/git"; // 리포지토리 절대 경로

// === 샌드박스 ===
import { getSandboxWithErrorHandling } from "../../../utils/sandbox.js"; // 에러 처리가 포함된 샌드박스 조회

// === 에러 진단 ===
import { shouldDiagnoseError } from "../../../utils/tool-message-error.js"; // 에러 진단이 필요한지 판단

// === 메시지 필터링 ===
import { filterHiddenMessages } from "../../../utils/message/filter-hidden.js"; // hidden=true 메시지 제외

// === 상수 ===
import { DO_NOT_RENDER_ID_PREFIX } from "@openswe/shared/constants"; // 렌더링 제외 메시지 ID 접두사

// === 도구 출력 처리 ===
import { processToolCallContent } from "../../../utils/tool-output-processing.js"; // 도구 출력 가공

// === 로거 인스턴스 ===
const logger = createLogger(LogLevel.INFO, "TakeAction");

/**
 * Planner 도구 실행 노드
 *
 * @description
 * Planner 그래프에서 컨텍스트 수집을 위한 읽기 전용 도구들을 실행합니다.
 * **중요**: Planner는 읽기 전용이므로 파일 변경을 감지하면 자동으로 되돌립니다.
 *
 * 처리 흐름:
 * 1. 마지막 AI 메시지에서 도구 호출 추출
 * 2. 도구 생성 및 매핑
 * 3. 샌드박스 조회/생성
 * 4. 도구 호출 병렬 실행
 * 5. 파일 변경 감지 → 되돌리고 경고
 * 6. 최대 액션 수 체크
 * 7. 에러 진단 필요 여부 확인 → 라우팅
 *
 * 사용 가능 도구:
 * - view: 파일 내용 보기
 * - shell: 쉘 명령어 실행 (읽기 전용)
 * - grep: 파일 내용 검색
 * - scratchpad: 노트 작성
 * - getURLContent: URL 컨텐츠 가져오기
 * - searchDocumentFor: 문서 검색
 * - MCP 도구들: 확장 가능한 외부 도구
 *
 * @param {PlannerGraphState} state - Planner 그래프 상태
 * @param {GraphConfig} config - LangGraph 설정
 * @returns {Promise<Command>} 다음 노드로 이동하는 Command
 *   - goto: "generate-plan" (최대 액션 초과)
 *   - goto: "diagnose-error" (에러 발생)
 *   - goto: "generate-plan-context-action" (정상)
 * @throws {Error} 마지막 메시지가 도구 호출이 없는 AI 메시지일 때
 * @throws {Error} 도구 호출이 없을 때
 *
 * @example
 * // LLM이 view와 grep 도구 호출 요청
 * // → 병렬로 실행 → 결과 반환 → 파일 변경 감지 → 되돌리기
 */
export async function takeActions(
  state: PlannerGraphState,
  config: GraphConfig,
): Promise<Command> {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1];

  // === 1단계: 마지막 메시지 검증 ===
  // LLM이 도구 호출을 요청했는지 확인
  if (!isAIMessage(lastMessage) || !lastMessage.tool_calls?.length) {
    throw new Error("Last message is not an AI message with tool calls.");
  }

  // === 2단계: 도구 생성 ===
  const viewTool = createViewTool(state, config); // 파일 보기
  const shellTool = createShellTool(state, config); // 쉘 실행
  const searchTool = createGrepTool(state, config); // 파일 검색
  const scratchpadTool = createScratchpadTool(""); // 노트 작성
  const getURLContentTool = createGetURLContentTool(state); // URL 가져오기
  const searchDocumentForTool = createSearchDocumentForTool(state, config); // 문서 검색
  const mcpTools = await getMcpTools(config); // MCP 도구들

  // 높은 컨텍스트 제한을 가진 도구들 (출력이 길 수 있음)
  const higherContextLimitToolNames = [
    ...mcpTools.map((t) => t.name),
    getURLContentTool.name,
    searchDocumentForTool.name,
  ];

  // 모든 도구를 배열과 맵으로 관리
  const allTools = [
    viewTool,
    shellTool,
    searchTool,
    scratchpadTool,
    getURLContentTool,
    searchDocumentForTool,
    ...mcpTools,
  ];
  const toolsMap = Object.fromEntries(
    allTools.map((tool) => [tool.name, tool]),
  );

  const toolCalls = lastMessage.tool_calls;
  if (!toolCalls?.length) {
    throw new Error("No tool calls found.");
  }

  // === 3단계: 샌드박스 조회/생성 ===
  const { sandbox, codebaseTree, dependenciesInstalled } =
    await getSandboxWithErrorHandling(
      state.sandboxSessionId,
      state.targetRepository,
      state.branchName,
      config,
    );

  // === 4단계: 도구 호출 병렬 실행 ===
  const toolCallResultsPromise = toolCalls.map(async (toolCall) => {
    const tool = toolsMap[toolCall.name];

    // 알 수 없는 도구인 경우 에러 반환
    if (!tool) {
      logger.error(`Unknown tool: ${toolCall.name}`);
      const toolMessage = new ToolMessage({
        id: `${DO_NOT_RENDER_ID_PREFIX}${uuidv4()}`,
        tool_call_id: toolCall.id ?? "",
        content: `Unknown tool: ${toolCall.name}`,
        name: toolCall.name,
        status: "error",
      });

      return { toolMessage, stateUpdates: undefined };
    }

    logger.info("Executing planner tool action", {
      ...toolCall,
    });

    let result = "";
    let toolCallStatus: "success" | "error" = "success";

    try {
      // 도구 실행
      const toolResult =
        // @ts-expect-error tool.invoke types are weird here...
        (await tool.invoke({
          ...toolCall.args,
          // 로컬 모드가 아니면 샌드박스 ID 전달
          ...(isLocalMode(config) ? {} : { xSandboxSessionId: sandbox.id }),
        })) as {
          result: string;
          status: "success" | "error";
        };

      // 도구 결과 파싱
      if (typeof toolResult === "string") {
        result = toolResult;
        toolCallStatus = "success";
      } else {
        result = toolResult.result;
        toolCallStatus = toolResult.status;
      }

      // 결과가 없으면 기본 메시지 설정
      if (!result) {
        result =
          toolCallStatus === "success"
            ? "Tool call returned no result"
            : "Tool call failed";
      }
    } catch (e) {
      toolCallStatus = "error";

      // 스키마 불일치 에러 처리
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
        // 일반 에러 처리
        logger.error("Failed to call tool", {
          ...(e instanceof Error
            ? { name: e.name, message: e.message, stack: e.stack }
            : { error: e }),
        });
        const errMessage = e instanceof Error ? e.message : "Unknown error";
        result = `FAILED TO CALL TOOL: "${toolCall.name}"\n\n${errMessage}`;
      }
    }

    // 도구 출력 가공 (길이 제한, 문서 캐싱 등)
    const { content, stateUpdates } = await processToolCallContent(
      toolCall,
      result,
      {
        higherContextLimitToolNames,
        state,
        config,
      },
    );

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
  let toolCallResults = toolCallResultsWithUpdates.map(
    (item) => item.toolMessage,
  );

  // === 5단계: 문서 캐시 병합 ===
  // 각 도구 호출에서 생성된 documentCache를 하나로 병합
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

  // === 6단계: 파일 변경 감지 및 되돌리기 (읽기 전용 강제) ===
  // Planner는 읽기 전용이므로 파일 변경을 허용하지 않음
  if (!isLocalMode(config)) {
    const repoPath = isLocalMode(config)
      ? getLocalWorkingDirectory()
      : getRepoAbsolutePath(state.targetRepository);

    const changedFiles = await getChangedFilesStatus(repoPath, sandbox, config);

    if (changedFiles?.length > 0) {
      logger.warn(
        "Changes found in the codebase after taking action. Reverting.",
        {
          changedFiles,
        },
      );
      await stashAndClearChanges(repoPath, sandbox);

      // 도구 결과에 경고 메시지 추가
      toolCallResults = toolCallResults.map(
        (tc) =>
          new ToolMessage({
            ...tc,
            content: `**WARNING**: THIS TOOL, OR A PREVIOUS TOOL HAS CHANGED FILES IN THE REPO.
  Remember that you are only permitted to take **READ** actions during the planning step. The changes have been reverted.

  Please ensure you only take read actions during the planning step to gather context. You may also call the \`take_notes\` tool at any time to record important information for the programmer step.

  Command Output:\n
  ${tc.content}`,
          }),
      );
    }
  }

  logger.info("Completed planner tool action", {
    ...toolCallResults.map((tc) => ({
      tool_call_id: tc.tool_call_id,
      status: tc.status,
    })),
  });

  // === 7단계: Command 업데이트 준비 ===
  const commandUpdate: PlannerGraphUpdate = {
    messages: toolCallResults,
    sandboxSessionId: sandbox.id,
    ...(codebaseTree && { codebaseTree }),
    ...(dependenciesInstalled !== null && { dependenciesInstalled }),
    ...allStateUpdates,
  };

  // === 8단계: 최대 액션 수 체크 ===
  // 너무 많은 도구 호출이 발생하면 계획 생성으로 이동
  const maxContextActions = config.configurable?.maxContextActions ?? 75;
  const maxActionsCount = maxContextActions * 2;

  // Hidden 메시지 제외, AI 메시지와 ToolMessage만 카운트
  const filteredMessages = filterHiddenMessages([
    ...state.messages,
    ...(commandUpdate.messages ?? []),
  ]).filter((m) => isAIMessage(m) || isToolMessage(m));

  if (filteredMessages.length >= maxActionsCount) {
    // 최대 액션 수 초과 → 계획 생성으로 이동
    logger.info("Exceeded max actions count, generating plan.", {
      maxActionsCount,
      filteredMessages,
    });
    return new Command({
      goto: "generate-plan",
      update: commandUpdate,
    });
  }

  // === 9단계: 에러 진단 필요 여부 확인 ===
  const shouldRouteDiagnoseNode = shouldDiagnoseError([
    ...state.messages,
    ...toolCallResults,
  ]);

  // === 10단계: 다음 노드로 이동 ===
  return new Command({
    goto: shouldRouteDiagnoseNode
      ? "diagnose-error" // 에러 발생 → 진단 노드
      : "generate-plan-context-action", // 정상 → 다음 컨텍스트 액션
    update: commandUpdate,
  });
}
