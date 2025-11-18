/**
 * @file tools.ts
 * @description 이 파일은 에이전트가 사용할 수 있는 다양한 도구의 필드(스키마, 설명 등)를 생성하는
 * 팩토리 함수들을 정의합니다. 이를 통해 도구 정의를 동적으로 구성하고 재사용성을 높입니다.
 * 또한, 명령어 포맷팅과 같은 관련 유틸리티 함수도 포함합니다.
 */

import { z } from "zod";
import { TargetRepository, GraphConfig } from "./types.js";
import { getRepoAbsolutePath } from "../git.js";
import { TIMEOUT_SEC } from "../constants.js";
import { isLocalMode, getLocalWorkingDirectory } from "./local-mode.js";

/**
 * `apply_patch` 도구의 필드를 생성합니다.
 * @param targetRepository 대상 저장소 정보.
 * @returns 도구 이름, 설명, Zod 스키마를 포함하는 객체.
 */
export function createApplyPatchToolFields(targetRepository: TargetRepository) {
  const repoRoot = getRepoAbsolutePath(targetRepository);
  const applyPatchToolSchema = z.object({
    diff: z
      .string()
      .describe(
        `적용할 diff 내용입니다. 표준 diff 형식을 사용하세요. 이 필드는 항상 제공되어야 합니다.`,
      ),
    file_path: z.string().describe("diff를 적용할 파일 경로입니다."),
  });

  return {
    name: "apply_patch",
    description:
      "파일 경로와 diff 콘텐츠가 주어졌을 때 파일에 diff를 적용합니다."
      +` 이 diff가 적용될 작업 디렉토리는 
${repoRoot}
입니다. 제공하는 파일 경로는 이 디렉토리에 상대적인 경로여야 합니다.`,
    schema: applyPatchToolSchema,
  };
}

/**
 * `request_human_help` 도구의 필드를 생성합니다.
 * @returns 도구 이름, 설명, Zod 스키마를 포함하는 객체.
 */
export function createRequestHumanHelpToolFields() {
  const requestHumanHelpSchema = z.object({
    help_request: z
      .string()
      .describe(
        "사용자에게 보낼 도움 요청입니다. 간결하지만 설명적이어야 합니다.\n" +
          "중요: 이는 사용자가 도움을 줄 수 있는 요청이어야 합니다. 예를 들어, 코드베이스 내에서 함수의 위치나 사용처에 대한 컨텍스트를 제공하거나, 스크립트 실행 방법에 대한 질문에 답변하는 것 등입니다.\n" +
          "중요: 사용자는 당신이 실행 중인 파일 시스템에 접근할 수 없으므로, 코드를 대신 변경해 줄 수 없습니다.",
      ),
  });
  return {
    name: "request_human_help",
    schema: requestHumanHelpSchema,
    description:
      "이 도구를 사용하여 사용자에게 도움을 요청하세요. 막혔거나 계속 진행할 수 없을 때만 호출해야 합니다. 사용자가 응답할 때까지 실행이 일시 중지됩니다. 사용자와 여러 번 대화할 수 없으므로, 도움 요청에 사용자가 응답하는 데 필요한 모든 정보와 컨텍스트가 포함되어 있는지 확인하세요.",
  };
}

/**
 * `session_plan` 도구의 필드를 생성합니다.
 * @returns 도구 이름, 설명, Zod 스키마를 포함하는 객체.
 */
export function createSessionPlanToolFields() {
  const sessionPlanSchema = z.object({
    title: z
      .string()
      .describe(
        "계획의 제목입니다. 사용자의 요청/그것을 이행하기 위해 생성된 계획에 대한 짧은 한 문장 설명이어야 합니다.",
      ),
    plan: z
      .array(z.string())
      .describe("사용자의 요청을 처리하기 위한 계획입니다."),
  });
  return {
    name: "session_plan",
    description: "계획을 생성할 준비가 되었을 때 이 도구를 호출하세요.",
    schema: sessionPlanSchema,
  };
}

/**
 * `shell` 도구의 필드를 생성합니다.
 * @param targetRepository 대상 저장소 정보.
 * @returns 도구 이름, 설명, Zod 스키마를 포함하는 객체.
 */
export function createShellToolFields(targetRepository: TargetRepository) {
  const repoRoot = getRepoAbsolutePath(targetRepository);
  const shellToolSchema = z.object({
    command: z
      .array(z.string())
      .describe(
        "실행할 명령어입니다. 인자가 올바른 순서로, 그리고 필요한 문자열, 따옴표 등을 포함하여 올바르게 포맷되었는지 확인하세요. 기본적으로 이 명령어는 저장소의 루트에서 실행되지만, 사용자 지정 작업 디렉토리를 지정할 수 있습니다.",
      ),
    workdir: z
      .string()
      .default(repoRoot)
      .describe(
        `명령어의 작업 디렉토리입니다. 기본값은 저장소의 루트(${repoRoot})입니다. 실행하려는 명령어가 저장소 루트에서 실행될 수 없는 경우에만 이 값을 지정해야 합니다.`,
      ),
    timeout: z
      .number()
      .optional()
      .default(TIMEOUT_SEC)
      .describe(
        "명령어가 완료될 때까지 기다리는 최대 시간(초)입니다. 테스트 실행과 같이 완료하는 데 오랜 시간이 걸릴 수 있는 명령어의 경우 이 값을 늘려야 합니다.",
      ),
  });
  return {
    name: "shell",
    description: "셸 명령어를 실행하고 그 출력을 반환합니다.",
    schema: shellToolSchema,
  };
}

/**
 * `update_plan` 도구의 필드를 생성합니다.
 * @returns 도구 이름, 설명, Zod 스키마를 포함하는 객체.
 */
export function createUpdatePlanToolFields() {
  const updatePlanSchema = z.object({
    update_plan_reasoning: z
      .string()
      .describe(
        "계획을 업데이트하는 이유입니다. 여기에는 계획을 실제로 업데이트할 때 유용한 컨텍스트(예: 어떤 계획 항목을 업데이트, 편집 또는 제거할지)와 기타 유용한 컨텍스트가 포함되어야 합니다.",
      ),
  });

  return {
    name: "update_plan",
    schema: updatePlanSchema,
    description:
      "현재 계획을 업데이트하려면 이 도구를 호출하세요. 현재 계획에서 계획 항목을 제거, 편집 또는 추가하려는 경우에만 호출해야 합니다."
      + "\n계획 항목을 완료로 표시하거나 요약을 추가하기 위해 이 도구를 호출하지 마세요."
      + "\n완료된 계획 항목은 편집/제거할 수 없습니다. 이 도구는 남은 및 현재 계획 항목에서 계획 항목을 업데이트/추가/제거하는 데만 사용할 수 있습니다."
      + "\n이 도구에 전달하는 이유는 실제로 계획을 업데이트하는 단계에서 사용되므로 유용하고 간결해야 합니다.",
  };
}

/**
 * `grep` 도구의 필드를 생성합니다.
 * @param targetRepository 대상 저장소 정보.
 * @returns 도구 이름, 설명, Zod 스키마를 포함하는 객체.
 */
export function createGrepToolFields(targetRepository: TargetRepository) {
  const repoRoot = getRepoAbsolutePath(targetRepository);
  const searchSchema = z.object({
    query: z
      .string()
      .describe(
        "코드베이스에서 검색할 문자열 또는 정규식입니다. 일반 문자열을 전달하는 경우 'match_string' 필드를 true로 설정해야 합니다. 정규식을 전달하는 경우 'match_string' 필드를 false로 설정해야 합니다.",
      ),

    match_string: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "쿼리를 고정된 문자열로 검색할지 여부입니다. true이면 쿼리와 정확히 일치하는 결과를 검색합니다. false이면 쿼리는 정규식으로 처리됩니다. 기본값은 false입니다.",
      ),

    case_sensitive: z
      .boolean()
      .optional()
      .default(false)
      .describe("검색을 대소문자 구분으로 할지 여부입니다. 기본값은 false입니다."),

    context_lines: z
      .number()
      .optional()
      .default(0)
      .describe("일치 항목 전후에 포함할 컨텍스트 라인 수입니다."),

    exclude_files: z
      .string()
      .optional()
      .describe("제외할 파일의 Glob 패턴입니다."),

    include_files: z
      .string()
      .optional()
      .describe("포함할 파일의 Glob 패턴입니다."),

    max_results: z
      .number()
      .optional()
      .default(0)
      .describe(
        "반환할 최대 결과 수입니다. 기본값은 0이며, 모든 결과를 반환합니다.",
      ),
    file_types:
      z.array(z.string())
      .optional()
      .describe("특정 파일 확장자로 제한합니다 (예: ['.js', '.ts'])."),
    follow_symlinks:
      z.boolean()
      .optional()
      .default(false)
      .describe("심볼릭 링크를 따라갈지 여부입니다. 기본값은 false입니다."),
  });

  return {
    name: "grep",
    schema: searchSchema,
    description: `저장소에서 grep (ripgrep) 검색을 실행합니다. 코드베이스에서 문자열 일치 또는 정규식을 통해 콘텐츠를 검색하는 데 사용해야 합니다. 이 명령어가 실행될 작업 디렉토리는 
${repoRoot}
입니다.`, 
  };
}

// 타입 추론에만 사용됩니다.
const _tmpSearchToolSchema = createGrepToolFields({
  owner: "x",
  repo: "x",
}).schema;
export type GrepCommand = z.infer<typeof _tmpSearchToolSchema>;

/**
 * 셸 인자를 이스케이프 처리합니다.
 * @param arg 이스케이프 처리할 인자.
 * @returns 이스케이프 처리된 인자 문자열.
 */
function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, `''`)}'`;
}

/**
 * Grep 명령어를 위한 인자 배열을 포맷합니다.
 * @param cmd Grep 명령어 객체.
 * @param options 포맷팅 옵션.
 * @returns `rg` 명령어에 전달될 인자 배열.
 */
export function formatGrepCommand(
  cmd: GrepCommand,
  options?: {
    excludeRequiredFlags?: boolean;
  },
): string[] {
  const args = ["rg"];

  // 출력 형식을 일관되게 유지하기 위한 필수 플래그
  const requiredFlags = ["--color=never", "--line-number", "--heading"];

  if (!options?.excludeRequiredFlags) {
    args.push(...requiredFlags);
  }

  if (!cmd.case_sensitive) {
    args.push("-i");
  }

  if (cmd.match_string) {
    args.push("--fixed-strings");
  }

  if (cmd.context_lines && cmd.context_lines > 0) {
    args.push(`-C`, String(cmd.context_lines));
  }

  if (cmd.include_files) {
    args.push("--glob", escapeShellArg(cmd.include_files));
  }

  if (cmd.exclude_files) {
    args.push("--glob", escapeShellArg(`!${cmd.exclude_files}`));
  }

  if (cmd.file_types && cmd.file_types.length > 0) {
    for (const ext of cmd.file_types) {
      const normalizedExt = ext.startsWith(".") ? ext : `.${ext}`;
      args.push("--glob", escapeShellArg(`**/*${normalizedExt}`));
    }
  }

  if (cmd.follow_symlinks) {
    args.push("-L");
  }

  if (cmd.max_results && cmd.max_results > 0) {
    args.push("--max-count", String(cmd.max_results));
  }

  if (cmd.query) {
    args.push(escapeShellArg(cmd.query));
  }

  return args;
}

/**
 * 표시 목적으로 셸 명령어를 포맷합니다.
 */
export function formatShellCommand(
  command: string[],
  workdir?: string,
): string {
  const commandStr = command.join(" ");
  return workdir ? `${commandStr} (in ${workdir})` : commandStr;
}

/**
 * 표시 목적으로 view 명령어를 포맷합니다.
 */
export function formatViewCommand(path: string): string {
  return `cat "${path}"`;
}

/**
 * 표시 목적으로 문서 검색 명령어를 포맷합니다.
 */
export function formatSearchDocumentsCommand(
  query: string,
  url: string,
): string {
  return `search for "${query}" in ${url}`;
}

/**
 * `mark_task_not_completed` 도구의 필드를 생성합니다.
 */
export function createMarkTaskNotCompletedToolFields() {
  const markTaskNotCompletedToolSchema = z.object({
    reasoning: z
      .string()
      .describe(
        "현재 작업 상태에 대한 간결한 이유 요약. 왜 완료되지 않았다고 생각하는지 설명합니다.",
      ),
  });

  const markTaskNotCompletedTool = {
    name: "mark_task_not_completed",
    description:
      "현재 작업을 완료되지 않음으로 표시하고, 상태를 뒷받침하는 간결한 이유 요약을 제공합니다.",
    schema: markTaskNotCompletedToolSchema,
  };

  return markTaskNotCompletedTool;
}

/**
 * `mark_task_completed` 도구의 필드를 생성합니다.
 */
export function createMarkTaskCompletedToolFields() {
  const markTaskCompletedToolSchema = z.object({
    completed_task_summary: z
      .string()
      .describe(
        "현재 작업을 완료하기 위해 수행한 작업에 대한 상세한 요약입니다. " +
          "수행한 작업의 구체적인 내용, 작업을 완료하면서 코드베이스에 대해 알게 된 통찰력, 그리고 다른 개발자가 당신이 수행한 작업을 검토할 때 유용할 다른 모든 컨텍스트를 포함하세요. " +
          "파일 경로와 변경 사항 목록을 포함할 수 있지만, 전체 파일 내용이나 전체 코드 변경 사항은 포함하지 마세요. " +
          "요약이 간결하고, 사려 깊으며, 도움이 되도록 하세요.",
      ),
  });

  const markTaskCompletedTool = {
    name: "mark_task_completed",
    description:
      "현재 작업을 완료로 표시하고, 작업을 완료하기 위해 수행한 작업에 대한 간결한 이유 요약을 제공합니다.",
    schema: markTaskCompletedToolSchema,
  };

  return markTaskCompletedTool;
}

/**
 * `install_dependencies` 도구의 필드를 생성합니다.
 */
export function createInstallDependenciesToolFields(
  targetRepository: TargetRepository,
) {
  const repoRoot = getRepoAbsolutePath(targetRepository);

  const installDependenciesToolSchema = z.object({
    command: z
      .array(z.string())
      .describe("의존성을 설치하기 위해 실행할 명령어입니다."),
    workdir:
      z.string()
      .default(repoRoot)
      .describe(
        `명령어를 실행할 작업 디렉토리입니다. 이 명령어가 실행될 기본 작업 디렉토리는 저장소의 루트입니다: 
${repoRoot}
. 다른 위치에서 이 설치 명령어를 실행하려면 이 필드에 경로를 전달하세요.`, 
      ),
  });

  return {
    name: "install_dependencies",
    description:
      "저장소의 의존성을 설치합니다. 특정 작업을 위해 의존성을 설치해야 할 경우에만 이 도구를 호출해야 합니다. 의존성 설치 방법에 대한 컨텍스트(예: 패키지 관리자, 적절한 설치 명령어 등)를 수집한 후에만 이 도구를 호출해야 합니다.",
    schema: installDependenciesToolSchema,
  };
}

/**
 * `open_pr` 도구의 필드를 생성합니다.
 */
export function createOpenPrToolFields() {
  const openPrToolSchema = z.object({
    title: z
      .string()
      .describe(
        "풀 리퀘스트의 제목입니다. 간결하고 사려 깊은 제목이어야 합니다. conventional commit 제목 형식을 따라야 합니다 (예: 'fix:', 'feat:', 'chore:' 등).",
      ),
    body:
      z.string()
      .optional()
      .describe(
        "풀 리퀘스트의 본문입니다. PR이 변경하는 내용에 대한 간결한 설명을 제공해야 합니다. 절대적으로 필요한 최소한의 기술적 세부 정보가 아닌 이상 과도하게 설명하거나 추가하지 마세요. 사용자는 설명을 빠르게 읽고 PR이 무엇을 하는지 이해할 수 있어야 합니다. 기억하세요: 기술적 세부 정보를 원한다면 변경된 파일을 읽을 수 있으므로 여기서 자세히 설명할 필요가 없습니다.",
      ),
  });

  return {
    name: "open_pr",
    schema: openPrToolSchema,
    description: "이 도구를 사용하여 풀 리퀘스트를 엽니다.",
  };
}

/**
 * `scratchpad` 도구의 필드를 생성합니다.
 */
export function createScratchpadFields(whenMessage: string) {
  const scratchpadSchema = z.object({
    scratchpad: z
      .array(z.string())
      .describe(
        `스크래치패드에 간결하고 기술적이며 유용한 노트를 작성하세요. 이 노트는 
${whenMessage}
에 사용할 수 있도록 저장됩니다.`, 
      ),
  });

  return {
    name: "scratchpad",
    schema: scratchpadSchema,
    description:
      `이 도구를 사용하여 수행하는 작업, 관찰한 내용, 그리고 
${whenMessage}
에 유용할 것이라고 생각되는 모든 노트에 대한 기술적인 노트를 작성하고 저장하세요.` +
      " 나중 단계에서 유용할 것이라고 생각되는 컨텍스트를 발견하면 이 도구를 호출해야 합니다.",
  };
}

/**
 * `diagnose_error` 도구의 필드를 생성합니다.
 */
export function createDiagnoseErrorToolFields() {
  const diagnoseErrorToolSchema = z.object({
    diagnosis: z.string().describe("오류 진단 내용입니다."),
  });

  return {
    name: "diagnose_error",
    description: "주어진 진단 내용으로 오류를 진단합니다.",
    schema: diagnoseErrorToolSchema,
  };
}

/**
 * `get_url_content` 도구의 필드를 생성합니다.
 */
export function createGetURLContentToolFields() {
  const getURLContentSchema = z.object({
    url: z
      .string()
      .describe(
        "콘텐츠를 가져올 URL입니다. 페이지 콘텐츠를 마크다운 형식으로 반환합니다.",
      ),
  });

  return {
    name: "get_url_content",
    description: "주어진 URL의 전체 페이지 콘텐츠를 마크다운 형식으로 가져옵니다.",
    schema: getURLContentSchema,
  };
}

/**
 * 표시 목적으로 get URL content 명령어를 포맷합니다.
 */
export function formatGetURLContentCommand(url: string): string {
  return `curl ${url}`;
}

/**
 * 표시 목적으로 str_replace_based_edit_tool 명령어를 포맷합니다.
 */
export function formatStrReplaceEditCommand(
  command: string,
  path: string,
): string {
  switch (command) {
    case "view":
      return `view file ${path}`;
    case "str_replace":
      return `replace text in ${path}`;
    case "create":
      return `create file ${path}`;
    case "insert":
      return `insert text in ${path}`;
    default:
      return `${command} ${path}`;
  }
}

/**
 * `search_document_for` 도구의 필드를 생성합니다.
 */
export function createSearchDocumentForToolFields() {
  const searchDocumentForSchema = z.object({
    url:
      z.string()
      .describe(
        "검색할 문서의 URL입니다. 이전에 가져와서 처리한 URL이어야 합니다.",
      ),
    query:
      z.string()
      .describe(
        "문서 내용 내에서 검색할 자연어 쿼리입니다. 이 쿼리는 LLM에 전달되어 문서에서 관련 콘텐츠를 추출하는 데 사용됩니다. 찾고 있는 정보에 대해 구체적으로 작성하세요.",
      ),
  });

  return {
    name: "search_document_for",
    description:
      "자연어 쿼리를 사용하여 이전에 가져온 문서 내에서 특정 정보를 검색합니다. 이 도구는 목차가 있는 대규모 문서를 요약했을 때 특히 유용합니다. " +
      "이 도구는 문서나 웹 페이지를 읽고 목차로 요약한 후 문서 내에서 특정 정보를 검색해야 할 때만 호출해야 합니다.",
    schema: searchDocumentForSchema,
  };
}

/**
 * `write_technical_notes` 도구의 필드를 생성합니다.
 */
export function createWriteTechnicalNotesToolFields() {
  const writeTechnicalNotesSchema = z.object({
    notes: z
      .string()
      .describe(
        "대화 기록을 기반으로 생성한 노트입니다.",
      ),
  });

  return {
    name: "write_technical_notes",
    description:
      "제공된 대화 기록을 기반으로 기술 노트를 작성합니다. 이 노트가 계획을 실행할 때 유용하도록 간결하면서도 충분한 정보를 포함하도록 하세요.",
    schema: writeTechnicalNotesSchema,
  };
}

/**
 * `summarize_conversation_history` 도구의 필드를 생성합니다.
 */
export function createConversationHistorySummaryToolFields() {
  const conversationHistorySummarySchema = z.object({
    reasoning: z.string(),
  });

  return {
    name: "summarize_conversation_history",
    description:
      "<실제 도구 호출로 사용되지 않음. 클라이언트와 에이전트 간의 공유 타입으로만 사용됨>",
    schema: conversationHistorySummarySchema,
  };
}

/**
 * `code_review_mark_task_completed` 도구의 필드를 생성합니다.
 */
export function createCodeReviewMarkTaskCompletedFields() {
  const markTaskCompletedSchema = z.object({
    review:
      z.string()
      .describe(
        "완료된 작업에 대한 최종 리뷰입니다. 간결하지만 설명적이어야 합니다.",
      ),
  });

  return {
    name: "code_review_mark_task_completed",
    schema: markTaskCompletedSchema,
    description:
      "이 도구를 사용하여 작업을 완료로 표시합니다. 작업이 성공적으로 완료되었다고 판단되면 이 도구를 호출해야 합니다.",
  };
}

/**
 * `code_review_mark_task_not_complete` 도구의 필드를 생성합니다.
 */
export function createCodeReviewMarkTaskNotCompleteFields() {
  const markTaskNotCompleteSchema = z.object({
    review:
      z.string()
      .describe(
        "완료된 작업에 대한 최종 리뷰입니다. 간결하지만 설명적이어야 합니다.",
      ),
    additional_actions:
      z.array(z.string())
      .describe(
        "리뷰를 성공적으로 만족시키고 작업을 완료하기 위해 수행할 추가 작업 목록입니다.",
      ),
  });

  return {
    name: "code_review_mark_task_not_complete",
    schema: markTaskNotCompleteSchema,
    description:
      "이 도구를 사용하여 작업을 완료되지 않음으로 표시합니다. 작업이 성공적으로 완료되지 않았다고 판단하고 프로그래머가 작업을 성공적으로 완료하기 위해 수행해야 할 추가 작업이 있는 경우 이 도구를 호출해야 합니다.",
  };
}

/**
 * `review_started` 도구의 필드를 생성합니다.
 */
export function createReviewStartedToolFields() {
  const reviewStartedSchema = z.object({
    review_started: z.boolean(),
  });

  return {
    name: "review_started",
    description:
      "<실제 도구 호출로 사용되지 않음. 클라이언트와 에이전트 간의 공유 타입으로만 사용됨>",
    schema: reviewStartedSchema,
  };
}

/**
 * `text_editor_tool`의 필드를 생성합니다.
 */
export function createTextEditorToolFields(
  targetRepository: TargetRepository,
  config: GraphConfig,
) {
  const repoRoot = isLocalMode(config)
    ? getLocalWorkingDirectory()
    : getRepoAbsolutePath(targetRepository);
  const textEditorToolSchema = z.object({
    command:
      z.enum(["view", "str_replace", "create", "insert"])
      .describe("실행할 명령어: view, str_replace, create, 또는 insert"),
    path:
      z.string()
      .describe("작업을 수행할 파일 또는 디렉토리의 경로"),
    view_range:
      z.tuple([z.number(), z.number()])
      .optional()
      .describe(
        "볼 라인 번호를 지정하는 두 정수의 선택적 배열 [시작, 끝]. 라인 번호는 1부터 시작합니다. 파일 끝까지 읽으려면 끝에 -1을 사용하세요. view 명령어에만 적용됩니다.",
      ),
    old_str:
      z.string()
      .optional()
      .describe(
        "교체할 텍스트 (공백 및 들여쓰기를 포함하여 정확히 일치해야 함). str_replace 명령어에 필요합니다.",
      ),
    new_str:
      z.string()
      .optional()
      .describe(
        "삽입할 새 텍스트. str_replace 및 insert 명령어에 필요합니다.",
      ),
    file_text:
      z.string()
      .optional()
      .describe(
        "새 파일에 쓸 내용. create 명령어에 필요합니다.",
      ),
    insert_line:
      z.number()
      .optional()
      .describe(
        "텍스트를 삽입할 기준 라인 번호 (파일 시작은 0). insert 명령어에 필요합니다.",
      ),
  });

  return {
    name: "str_replace_based_edit_tool",
    description:
      "A text editor tool that can view, create, and edit files. " +
      `The working directory is 
${repoRoot}
. Ensure file paths are absolute and properly formatted. ` +
      "Supports commands: view (read file/directory), str_replace (replace text), create (new file), insert (add text at line).",
    schema: textEditorToolSchema,
  };
}

/**
 * `view` 도구의 필드를 생성합니다.
 */
export function createViewToolFields(
  targetRepository: TargetRepository,
  config?: GraphConfig,
) {
  const repoRoot =
    config && isLocalMode(config)
      ? getLocalWorkingDirectory()
      : getRepoAbsolutePath(targetRepository);
  const viewSchema = z.object({
    command: z.enum(["view"]).describe("실행할 명령어: view"),
    path:
      z.string()
      .describe("작업을 수행할 파일 또는 디렉토리의 경로"),
    view_range:
      z.array(z.number())
      .optional()
      .describe(
        "볼 라인 번호를 지정하는 두 정수의 선택적 배열 [시작, 끝]. 라인 번호는 1부터 시작합니다. 파일 끝까지 읽으려면 끝에 -1을 사용하세요. view 명령어에만 적용됩니다. 이 값이 전달되면 유효한 배열이고 두 개의 양의 정수만 포함하는지 확인하세요.",
      ),
  });

  return {
    name: "view",
    description:
      "파일을 볼 수 있는 텍스트 편집기 도구입니다. " +
      `작업 디렉토리는 
${repoRoot}
입니다. 파일 경로가 절대 경로이고 올바르게 포맷되었는지 확인하세요. ` +
      "지원되는 명령어: view (파일/디렉토리 읽기).",
    schema: viewSchema,
  };
}

/**
 * `write_default_tsconfig` 도구의 필드를 생성합니다.
 */
export function createWriteDefaultTsConfigToolFields(
  targetRepository: TargetRepository,
) {
  const repoRoot = getRepoAbsolutePath(targetRepository);

  const writeDefaultTsConfigToolSchema = z.object({
    workdir:
      z.string()
      .default(repoRoot)
      .describe(
        `tsconfig.json 파일이 작성될 디렉토리입니다. 기본값은 저장소의 루트입니다: 
${repoRoot}
.`, 
      ),
  });

  return {
    name: "write_default_tsconfig",
    description:
      "지정된 디렉토리에 기본 tsconfig.json 파일을 작성합니다. 이 도구는 새로운 TypeScript 프로젝트를 생성할 때만 호출해야 합니다.",
    schema: writeDefaultTsConfigToolSchema,
  };
}

/**
 * `reply_to_review_comment` 도구의 필드를 생성합니다.
 */
export function createReplyToReviewCommentToolFields() {
  const commentOnReviewCommentSchema = z.object({
    id:
      z.number()
      .describe(
        "답글을 달 리뷰 댓글의 ID입니다. 리뷰 댓글의 유효한 ID여야 합니다.",
      ),
    comment:
      z.string()
      .describe(
        "리뷰 댓글에 남길 답글입니다. 간결한 답글이어야 합니다.",
      ),
  });

  return {
    name: "reply_to_review_comment",
    description:
      "이 도구를 사용하여 리뷰 댓글에 답글을 답니다. 코드를 수정할 필요 없이 정보 요청과 같은 사용자 댓글에 답장할 때 이 도구를 호출해야 합니다."
      + "\n또한, 댓글이 해결되었음을 사용자에게 알리거나, 댓글을 해결할 수 없는 경우 사용자에게 알리기 위해 이 도구를 호출해야 합니다."
      + "\n리뷰 댓글에만 이 도구를 사용하세요. 일반 댓글에는 'reply_to_comment' 도구를 사용하세요.",
    schema: commentOnReviewCommentSchema,
  };
}

/**
 * `reply_to_comment` 도구의 필드를 생성합니다.
 */
export function createReplyToCommentToolFields() {
  const commentOnReviewCommentSchema = z.object({
    id:
      z.number()
      .describe(
        "답글을 달 댓글의 ID입니다. 댓글의 유효한 ID여야 합니다.",
      ),
    comment:
      z.string()
      .describe(
        "댓글에 남길 답글입니다. 간결한 답글이어야 합니다.",
      ),
  });

  return {
    name: "reply_to_comment",
    description:
      "이 도구를 사용하여 댓글에 답글을 답니다. 사용자가 태그한 댓글(리뷰 댓글 아님)을 방금 해결한 경우 항상 이 도구를 호출해야 합니다. 이 도구를 사용하여 댓글을 해결했음을 사용자에게 간결하게 알리거나 댓글에 답변하세요."
      + "\n일반 댓글에만 이 도구를 사용하세요. 리뷰 댓글에는 'reply_to_review_comment' 도구를 사용하세요.",
    schema: commentOnReviewCommentSchema,
  };
}

/**
 * `reply_to_review` 도구의 필드를 생성합니다.
 */
export function createReplyToReviewToolFields() {
  const commentOnReviewSchema = z.object({
    id:
      z.number()
      .describe(
        "답글을 달 리뷰의 ID입니다. 리뷰의 유효한 ID여야 합니다. 리뷰 댓글이 아닙니다.",
      ),
    comment:
      z.string()
      .describe(
        "리뷰에 남길 답글입니다. 간결한 답글이어야 합니다.",
      ),
  });

  return {
    name: "reply_to_review",
    description:
      "이 도구를 사용하여 리뷰에 답글을 답니다. 사용자가 태그한 리뷰(리뷰 댓글 아님)를 방금 해결한 경우 항상 이 도구를 호출해야 합니다. 이 도구를 사용하여 리뷰를 해결했음을 사용자에게 간결하게 알리거나 리뷰에 답변하세요."
      + "\n일반 리뷰에만 이 도구를 사용하세요. 리뷰 댓글에는 'reply_to_review_comment' 도구를 사용하세요.",
    schema: commentOnReviewSchema,
  };
}