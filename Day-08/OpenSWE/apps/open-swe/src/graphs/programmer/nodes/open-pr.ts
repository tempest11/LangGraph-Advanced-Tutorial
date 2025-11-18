/**
 * @file Programmer의 Pull Request 생성 노드
 * @description
 * 모든 작업이 완료되면 Pull Request를 생성하거나 업데이트하는 노드입니다.
 * Git 브랜치 생성, 커밋, PR 생성, 샌드박스 정리까지 모든 과정을 처리합니다.
 *
 * 주요 기능:
 * - 변경 파일 확인 및 Git 커밋
 * - LLM을 사용한 PR 제목/본문 생성
 * - PR 생성 또는 기존 PR 업데이트
 * - 샌드박스 삭제 (작업 완료)
 * - GitHub 이슈 자동 링크 (Fixes #이슈번호)
 *
 * PR 생성 프로세스:
 * 1. 변경된 파일 확인
 * 2. 브랜치 체크아웃 및 커밋
 * 3. LLM으로 PR 제목/본문 생성
 * 4. PR 생성 or 업데이트
 * 5. 샌드박스 삭제
 */

// 외부 라이브러리
import { v4 as uuidv4 } from "uuid"; // UUID 생성

// Open SWE 공유 타입
import {
  CustomRules, // 커스텀 규칙 타입
  GraphConfig, // LangGraph 설정 타입
  GraphState, // 그래프 전역 상태 타입
  GraphUpdate, // 상태 업데이트 타입
  PlanItem, // 개별 계획 항목 타입
  TaskPlan, // 작업 계획 타입
} from "@openswe/shared/open-swe/types";

// Git 유틸리티
import {
  checkoutBranchAndCommit, // 브랜치 체크아웃 및 커밋
  getChangedFilesStatus, // 변경된 파일 상태 확인
  pushEmptyCommit, // 빈 커밋 푸시 (CI 스킵용)
} from "../../../utils/github/git.js";
import {
  createPullRequest, // PR 생성
  updatePullRequest, // PR 업데이트
} from "../../../utils/github/api.js";

// 유틸리티 함수
import { createLogger, LogLevel } from "../../../utils/logger.js"; // 로거 생성
import { z } from "zod"; // Zod 스키마 타입 추론
import {
  loadModel, // LLM 모델 로더
  supportsParallelToolCallsParam, // 병렬 도구 호출 지원 여부
} from "../../../utils/llms/index.js";
import { LLMTask } from "@openswe/shared/open-swe/llm-task"; // LLM 작업 타입 (ROUTER)
import { formatPlanPromptWithSummaries } from "../../../utils/plan-prompt.js"; // 계획 프롬프트 포맷팅 (요약 포함)
import { formatUserRequestPrompt } from "../../../utils/user-request.js"; // 사용자 요청 프롬프트 포맷팅
import { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages"; // LangChain 메시지 타입
import {
  deleteSandbox, // 샌드박스 삭제
  getSandboxWithErrorHandling, // 샌드박스 가져오기 (에러 처리 포함)
} from "../../../utils/sandbox.js";
import { getGitHubTokensFromConfig } from "../../../utils/github-tokens.js"; // GitHub 토큰 추출
import {
  getActivePlanItems, // 활성 계획 항목 목록
  getPullRequestNumberFromActiveTask, // 현재 작업의 PR 번호 가져오기
} from "@openswe/shared/open-swe/tasks";
import { createOpenPrToolFields } from "@openswe/shared/open-swe/tools"; // open_pr 도구 필드
import { trackCachePerformance } from "../../../utils/caching.js"; // 캐싱 성능 추적
import { getModelManager } from "../../../utils/llms/model-manager.js"; // 모델 관리자
import {
  GitHubPullRequest, // PR 생성 결과 타입
  GitHubPullRequestList, // PR 목록 타입
  GitHubPullRequestUpdate, // PR 업데이트 결과 타입
} from "../../../utils/github/types.js";
import { getRepoAbsolutePath } from "@openswe/shared/git"; // 레포지토리 절대 경로
import { GITHUB_USER_LOGIN_HEADER } from "@openswe/shared/constants"; // GitHub 사용자 로그인 헤더
import { shouldCreateIssue } from "../../../utils/should-create-issue.js"; // GitHub 이슈 생성 여부 판단

// 로거 인스턴스 생성
const logger = createLogger(LogLevel.INFO, "Open PR");

/**
 * PR 생성을 위한 시스템 프롬프트
 *
 * @description
 * LLM에게 완료된 작업을 제공하고 PR 제목/본문을 생성하도록 요청합니다.
 * 마크다운 포맷팅을 사용하고, 이슈 번호는 자동으로 추가되므로 언급하지 말라고 안내합니다.
 *
 * @constant {string}
 */
const openPrSysPrompt = `You are operating as a terminal-based agentic coding assistant built by LangChain. It wraps LLM models to enable natural language interaction with a local codebase. You are expected to be precise, safe, and helpful.

You have just completed all of your tasks, and are now ready to open a pull request.

Here are all of the tasks you completed:
{COMPLETED_TASKS}

{USER_REQUEST_PROMPT}

{CUSTOM_RULES}

Always use proper markdown formatting when generating the pull request contents.

You should not include any mention of an issue to close, unless explicitly requested by the user. The body will automatically include a mention of the issue to close.

With all of this in mind, please use the \`open_pr\` tool to open a pull request.`;

/**
 * PR 포맷팅 커스텀 규칙 프롬프트를 생성합니다
 *
 * @description
 * 사용자가 PR 포맷에 대한 커스텀 규칙을 제공한 경우,
 * LLM에게 반드시 따르도록 강조하는 프롬프트를 생성합니다.
 *
 * @param {string} pullRequestFormatting - PR 포맷팅 커스텀 규칙
 * @returns {string} 포맷팅된 커스텀 규칙 프롬프트
 */
const formatCustomRulesPrompt = (pullRequestFormatting: string): string => {
  return `<custom_formatting_rules>
The user has provided the following custom rules around how to format the contents of the pull request.
IMPORTANT: You must follow these instructions exactly when generating the pull request contents. Do not deviate from them in any way.

${pullRequestFormatting}
</custom_formatting_rules>`;
};

/**
 * PR 생성 프롬프트를 포맷팅합니다
 *
 * @description
 * 완료된 작업, 사용자 요청, 커스텀 규칙을 시스템 프롬프트에 삽입합니다.
 *
 * @param {PlanItem[]} taskPlan - 활성 계획 항목 배열
 * @param {BaseMessage[]} messages - 사용자 메시지 (요청 추출용)
 * @param {CustomRules} [customRules] - 커스텀 규칙 (선택사항)
 * @returns {string} 포맷팅된 시스템 프롬프트
 */
const formatPrompt = (
  taskPlan: PlanItem[],
  messages: BaseMessage[],
  customRules?: CustomRules,
): string => {
  const completedTasks = taskPlan.filter((task) => task.completed);
  const customPrFormattingRules = customRules?.pullRequestFormatting
    ? formatCustomRulesPrompt(customRules.pullRequestFormatting)
    : "";

  return openPrSysPrompt
    .replace("{COMPLETED_TASKS}", formatPlanPromptWithSummaries(completedTasks))
    .replace("{USER_REQUEST_PROMPT}", formatUserRequestPrompt(messages))
    .replace("{CUSTOM_RULES}", customPrFormattingRules);
};

/**
 * Pull Request를 생성하거나 업데이트하는 노드 함수입니다
 *
 * @description
 * 모든 작업이 완료되면 호출됩니다.
 * Git 커밋, PR 생성/업데이트, 샌드박스 정리까지 모든 과정을 처리합니다.
 *
 * 처리 흐름:
 * 1. 샌드박스 가져오기 및 GitHub 토큰 추출
 * 2. 변경된 파일 확인 (git diff)
 * 3. 변경 파일이 있으면 브랜치 체크아웃 및 커밋
 * 4. ROUTER 타입의 LLM 모델 로드 (간단한 작업)
 * 5. open_pr 도구를 강제 호출하도록 모델 바인딩
 * 6. LLM 호출하여 PR 제목/본문 생성
 * 7. 환경변수 설정 시 빈 커밋 푸시 (CI 스킵)
 * 8. PR 생성 or 기존 PR 업데이트
 * 9. 샌드박스 삭제
 * 10. 메시지 생성 및 반환
 *
 * @param {GraphState} state - 현재 그래프 상태 (TaskPlan, 샌드박스 ID, GitHub 정보 포함)
 * @param {GraphConfig} config - 그래프 설정 (GitHub 토큰, 모델 설정 등)
 * @returns {Promise<GraphUpdate>} PR 정보 및 메시지를 포함한 상태 업데이트
 * @throws {Error} 레포지토리 정보가 없거나 PR 생성 도구 호출 실패 시
 *
 * @example
 * // PR 생성
 * const update = await openPullRequest(state, config);
 * // => {
 * //   messages: [AIMessage, ToolMessage],
 * //   sandboxSessionId: undefined, // 삭제됨
 * // }
 */
export async function openPullRequest(
  state: GraphState,
  config: GraphConfig,
): Promise<GraphUpdate> {
  // === 1단계: 샌드박스 및 GitHub 토큰 준비 ===
  const { githubInstallationToken } = getGitHubTokensFromConfig(config);

  const { sandbox, codebaseTree, dependenciesInstalled } =
    await getSandboxWithErrorHandling(
      state.sandboxSessionId,
      state.targetRepository,
      state.branchName,
      config,
    );
  const sandboxSessionId = sandbox.id;

  const { owner, repo } = state.targetRepository;

  if (!owner || !repo) {
    throw new Error(
      "Failed to open pull request: No target repository found in config.",
    );
  }

  const repoPath = getRepoAbsolutePath(state.targetRepository);

  // === 2단계: 변경된 파일 확인 ===
  const gitDiffRes = await sandbox.process.executeCommand(
    `git diff --name-only ${state.targetRepository.branch ?? ""}`,
    repoPath,
  );

  // 변경된 파일이 없으면 샌드박스만 삭제하고 종료
  if (gitDiffRes.exitCode !== 0 || gitDiffRes.result.trim().length === 0) {
    const sandboxDeleted = await deleteSandbox(sandboxSessionId);
    return {
      ...(sandboxDeleted && {
        sandboxSessionId: undefined,
        dependenciesInstalled: false,
      }),
    };
  }

  let branchName = state.branchName;
  let updatedTaskPlan: TaskPlan | undefined;

  const changedFiles = await getChangedFilesStatus(repoPath, sandbox, config);

  // === 3단계: 변경 파일 커밋 ===
  if (changedFiles.length > 0) {
    logger.info(`Has ${changedFiles.length} changed files. Committing.`, {
      changedFiles,
    });

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
    updatedTaskPlan = result.updatedTaskPlan;
  }

  // === 4단계: LLM 모델 로드 및 도구 바인딩 ===
  const openPrTool = createOpenPrToolFields();

  // ROUTER 모델 사용 (PR 생성은 간단한 작업이므로 고급 모델 불필요)
  const model = await loadModel(config, LLMTask.ROUTER);
  const modelManager = getModelManager();
  const modelName = modelManager.getModelNameForTask(config, LLMTask.ROUTER);
  const modelSupportsParallelToolCallsParam = supportsParallelToolCallsParam(
    config,
    LLMTask.ROUTER,
  );

  // open_pr 도구를 강제 호출하도록 설정
  const modelWithTool = model.bindTools([openPrTool], {
    tool_choice: openPrTool.name, // 반드시 이 도구 사용
    ...(modelSupportsParallelToolCallsParam
      ? {
          parallel_tool_calls: false, // 병렬 호출 비활성화
        }
      : {}),
  });

  // === 5단계: LLM 호출하여 PR 제목/본문 생성 ===
  const response = await modelWithTool.invoke([
    {
      role: "user",
      content: formatPrompt(
        getActivePlanItems(state.taskPlan),
        state.internalMessages,
      ),
    },
  ]);

  const toolCall = response.tool_calls?.[0];

  if (!toolCall) {
    throw new Error(
      "Failed to generate a tool call when opening a pull request.",
    );
  }

  // === 6단계: CI 스킵용 빈 커밋 푸시 (환경변수 설정 시) ===
  if (process.env.SKIP_CI_UNTIL_LAST_COMMIT === "true") {
    await pushEmptyCommit(state.targetRepository, sandbox, config, {
      githubInstallationToken,
    });
  }

  // === 7단계: PR 제목/본문 추출 ===
  const { title, body } = toolCall.args as z.infer<typeof openPrTool.schema>;

  const userLogin = config.configurable?.[GITHUB_USER_LOGIN_HEADER];

  // 현재 작업에 연결된 PR 번호 가져오기 (이미 PR이 생성되었을 수 있음)
  const prForTask = getPullRequestNumberFromActiveTask(
    updatedTaskPlan ?? state.taskPlan,
  );

  let pullRequest:
    | GitHubPullRequest
    | GitHubPullRequestList[number]
    | GitHubPullRequestUpdate
    | null = null;

  const reviewPullNumber = config.configurable?.reviewPullNumber;

  // PR 본문 구성: 이슈 링크 + 리뷰 PR 링크 + 소유자 + LLM 생성 본문
  const prBody = `${shouldCreateIssue(config) ? `Fixes #${state.githubIssueId}` : ""}${reviewPullNumber ? `\n\nTriggered from pull request: #${reviewPullNumber}` : ""}${userLogin ? `\n\nOwner: @${userLogin}` : ""}\n\n${body}`;

  // === 8단계: PR 생성 or 업데이트 ===
  if (!prForTask) {
    // 아직 PR이 생성되지 않았으면 새로 생성
    pullRequest = await createPullRequest({
      owner,
      repo,
      headBranch: branchName,
      title,
      body: prBody,
      githubInstallationToken,
      baseBranch: state.targetRepository.branch,
    });
  } else {
    // 이미 PR이 있으면 업데이트 (Ready for review로 변경)
    pullRequest = await updatePullRequest({
      owner,
      repo,
      title,
      body: prBody,
      pullNumber: prForTask,
      githubInstallationToken,
    });
  }

  // === 9단계: 샌드박스 삭제 ===
  let sandboxDeleted = false;
  if (pullRequest) {
    sandboxDeleted = await deleteSandbox(sandboxSessionId);
  }

  // === 10단계: 메시지 생성 ===
  const newMessages = [
    // AI 메시지: PR 정보 포함 (UI 렌더링용)
    new AIMessage({
      ...response,
      additional_kwargs: {
        ...response.additional_kwargs,
        // UI에서 브랜치 정보를 렌더링하기 위해 필요
        branch: branchName,
        targetBranch: state.targetRepository.branch,
      },
    }),
    // Tool 메시지: PR 생성 결과
    new ToolMessage({
      id: uuidv4(),
      tool_call_id: toolCall.id ?? "",
      content: pullRequest
        ? `Marked pull request as ready for review: ${pullRequest.html_url}`
        : "Failed to mark pull request as ready for review.",
      name: toolCall.name,
      additional_kwargs: {
        pull_request: pullRequest, // UI에서 PR 정보 표시용
      },
    }),
  ];

  // === 11단계: 상태 업데이트 반환 ===
  return {
    messages: newMessages,
    internalMessages: newMessages,
    // 샌드박스가 성공적으로 삭제되면 상태에서 제거
    ...(sandboxDeleted && {
      sandboxSessionId: undefined,
      dependenciesInstalled: false,
    }),
    ...(codebaseTree && { codebaseTree }),
    ...(dependenciesInstalled !== null && { dependenciesInstalled }),
    tokenData: trackCachePerformance(response, modelName),
    ...(updatedTaskPlan && { taskPlan: updatedTaskPlan }),
  };
}
