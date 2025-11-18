/**
 * @file command-evaluation.ts
 * @description
 * 명령어 평가 및 안전성 검증 유틸리티 함수를 제공합니다.
 * 도구 호출을 포맷팅하고 명령어 안전성을 평가합니다.
 */

import { createLogger, LogLevel } from "./logger.js";
import { createCommandSafetyEvaluator } from "../tools/command-safety-evaluator.js";
import { GraphConfig } from "@openswe/shared/open-swe/types";
import {
  formatGrepCommand,
  formatShellCommand,
  formatViewCommand,
  formatSearchDocumentsCommand,
  formatGetURLContentCommand,
  formatStrReplaceEditCommand,
  GrepCommand,
  createShellToolFields,
  createViewToolFields,
  createSearchDocumentForToolFields,
  createGetURLContentToolFields,
  createTextEditorToolFields,
} from "@openswe/shared/open-swe/tools";
import { ToolCall } from "@langchain/core/messages/tool";
import { z } from "zod";

const logger = createLogger(LogLevel.INFO, "CommandEvaluation");

// 도구 호출 인수에 대한 타입 정의 - 실제 도구 스키마에서 파생됩니다. 린터가 불평하지 않도록 밑줄을 사용합니다.
const dummyRepo = { owner: "dummy", repo: "dummy" };
const _shellTool = createShellToolFields(dummyRepo);
type ShellToolArgs = z.infer<typeof _shellTool.schema>;

const _viewTool = createViewToolFields(dummyRepo);
type ViewToolArgs = z.infer<typeof _viewTool.schema>;

const _searchDocumentsTool = createSearchDocumentForToolFields();
type SearchDocumentsToolArgs = z.infer<typeof _searchDocumentsTool.schema>;

const _getURLContentTool = createGetURLContentToolFields();
type GetURLContentToolArgs = z.infer<typeof _getURLContentTool.schema>;

const _textEditorTool = createTextEditorToolFields(dummyRepo, {});
type StrReplaceEditToolArgs = z.infer<typeof _textEditorTool.schema>;

/**
 * 명령어 평가 결과를 나타내는 인터페이스입니다.
 */
export interface CommandEvaluation {
  toolCall: ToolCall;
  commandDescription: string;
  commandString: string;
  isSafe: boolean;
  reasoning: string;
  riskLevel: "low" | "medium" | "high";
}

/**
 * 명령어 평가 결과의 집계를 나타내는 인터페이스입니다.
 */
export interface CommandEvaluationResult {
  safeCommands: CommandEvaluation[];
  unsafeCommands: CommandEvaluation[];
  allCommands: CommandEvaluation[];
  filteredToolCalls: ToolCall[];
  wasFiltered: boolean;
}

// 읽기용으로 안전하다고 알려진 명령어
const SAFE_READ_COMMANDS = [
  "ls",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "grep",
  "find",
  "locate",
  "file",
  "stat",
  "du",
  "df",
  "ps",
  "top",
  "htop",
  "free",
  "uptime",
  "who",
  "w",
  "id",
  "pwd",
  "echo",
  "printenv",
  "env",
  "which",
  "whereis",
  "man",
  "help",
  "info",
  "type",
  "hash",
  "history",
  "alias",
];

/**
 * 명령어가 안전한 읽기 명령어인지 확인합니다.
 * @param command - 확인할 명령어 문자열.
 * @returns 안전한 읽기 명령어이면 true, 그렇지 않으면 false.
 */
export function isSafeReadCommand(command: string): boolean {
  const lowerCommand = command.toLowerCase();

  // 알려진 안전한 읽기 명령어 확인
  for (const safeCmd of SAFE_READ_COMMANDS) {
    if (lowerCommand.startsWith(safeCmd.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * 도구 호출에서 명령어 문자열과 설명을 가져옵니다.
 * @param toolCall - 처리할 도구 호출.
 * @returns 명령어 문자열과 설명.
 */
export function getCommandString(toolCall: ToolCall): {
  commandString: string;
  commandDescription: string;
} {
  let commandString = "";
  let commandDescription = "";

  if (toolCall.name === "shell") {
    const args = toolCall.args as ShellToolArgs;
    commandString = formatShellCommand(args.command, args.workdir);
    commandDescription = `${toolCall.name} - ${commandString}`;
  } else if (toolCall.name === "grep") {
    const args = toolCall.args as GrepCommand;
    const grepCommand = formatGrepCommand(args);
    commandString = grepCommand.join(" ");
    commandDescription = `${toolCall.name} - "${args.query}" 검색 중`;
  } else if (toolCall.name === "view") {
    const args = toolCall.args as ViewToolArgs;
    commandString = formatViewCommand(args.path);
    commandDescription = `${toolCall.name} - ${args.path} 보는 중`;
  } else if (toolCall.name === "search_documents_for") {
    const args = toolCall.args as SearchDocumentsToolArgs;
    commandString = formatSearchDocumentsCommand(args.query, args.url);
    commandDescription = `${toolCall.name} - ${args.url}에서 "${args.query}"에 대한 문서 검색 중`;
  } else if (toolCall.name === "get_url_content") {
    const args = toolCall.args as GetURLContentToolArgs;
    commandString = formatGetURLContentCommand(args.url);
    commandDescription = `${toolCall.name} - ${args.url}에서 콘텐츠 가져오는 중`;
  } else if (toolCall.name === "str_replace_based_edit_tool") {
    const args = toolCall.args as StrReplaceEditToolArgs;
    commandString = formatStrReplaceEditCommand(args.command, args.path);
    commandDescription = `${toolCall.name} - ${commandString}`;
  }

  return { commandString, commandDescription };
}

/**
 * 명령어의 안전성을 평가합니다.
 * @param commandToolCalls - 평가할 명령어 도구 호출 배열.
 * @param config - 그래프 설정.
 * @returns 명령어 평가 결과.
 */
export async function evaluateCommands(
  commandToolCalls: ToolCall[],
  config: GraphConfig,
): Promise<CommandEvaluationResult> {
  const commandExecutingTools = [
    "shell",
    "grep",
    "view",
    "search_documents_for",
    "get_url_content",
    "str_replace_based_edit_tool",
  ];
  logger.info("명령어 실행 도구의 안전성 평가 중", {
    commandToolCalls: commandToolCalls.map((c) => c.name),
  });

  // 안전성 평가기 생성
  const safetyEvaluator = createCommandSafetyEvaluator(config);

  // 각 명령어에 대한 안전성 평가
  const safetyEvaluations = await Promise.all(
    commandToolCalls.map(async (toolCall) => {
      const { commandString, commandDescription } = getCommandString(toolCall);

      try {
        const evaluation = await safetyEvaluator.invoke({
          command: commandString,
          tool_name: toolCall.name,
          args: toolCall.args,
        });

        const result = evaluation.result;
        return {
          toolCall,
          commandDescription,
          commandString,
          isSafe: result.is_safe,
          reasoning: result.reasoning,
          riskLevel: result.risk_level,
        };
      } catch (e) {
        logger.error("명령어 안전성 평가 실패", {
          toolCall,
          error: e instanceof Error ? e.message : e,
        });
        // 평가 실패 시 안전하지 않은 것으로 기본 설정
        return {
          toolCall,
          commandDescription,
          commandString,
          isSafe: false,
          reasoning: "안전성 평가 실패 - 안전하지 않은 것으로 기본 설정",
          riskLevel: "high" as const,
        };
      }
    }),
  );

  // 명령어 분류
  const safeCommands = safetyEvaluations.filter(
    (evaluation) => evaluation.isSafe,
  );
  const unsafeCommands = safetyEvaluations.filter(
    (evaluation) => !evaluation.isSafe,
  );

  // 안전하지 않은 명령어만 필터링 (안전한 쓰기 명령어는 허용)
  const safeToolCalls = safeCommands.map((evaluation) => evaluation.toolCall);
  const otherToolCalls = commandToolCalls.filter(
    (toolCall) => !commandExecutingTools.includes(toolCall.name),
  );

  const filteredToolCalls = [...safeToolCalls, ...otherToolCalls];
  const wasFiltered = filteredToolCalls.length !== commandToolCalls.length;

  return {
    safeCommands,
    unsafeCommands,
    allCommands: safetyEvaluations,
    filteredToolCalls,
    wasFiltered,
  };
}

/**
 * 안전하지 않은 명령어를 필터링합니다.
 * @param allToolCalls - 모든 도구 호출 배열.
 * @param config - 그래프 설정.
 * @returns 필터링된 도구 호출과 필터링 여부.
 */
export async function filterUnsafeCommands(
  allToolCalls: ToolCall[],
  config: GraphConfig,
): Promise<{ filteredToolCalls: ToolCall[]; wasFiltered: boolean }> {
  const commandExecutingTools = [
    "shell",
    "grep",
    "view",
    "search_documents_for",
    "get_url_content",
    "str_replace_based_edit_tool",
  ];
  const commandToolCalls = allToolCalls.filter((toolCall) =>
    commandExecutingTools.includes(toolCall.name),
  );

  if (commandToolCalls.length === 0) {
    return { filteredToolCalls: allToolCalls, wasFiltered: false };
  }

  const evaluationResult = await evaluateCommands(commandToolCalls, config);

  // 필터링되는 안전하지 않은 명령어 로깅
  if (evaluationResult.unsafeCommands.length > 0) {
    evaluationResult.unsafeCommands.forEach((evaluation) => {
      logger.warn(`안전하지 않은 명령어 필터링:`, {
        command: evaluation.commandDescription,
        reasoning: evaluation.reasoning,
        riskLevel: evaluation.riskLevel,
      });
    });
  }

  if (evaluationResult.wasFiltered) {
    logger.info(
      `${allToolCalls.length - evaluationResult.filteredToolCalls.length}개의 안전하지 않은 명령어를 필터링했습니다.`,
    );
  }

  return {
    filteredToolCalls: evaluationResult.filteredToolCalls,
    wasFiltered: evaluationResult.wasFiltered,
  };
}
