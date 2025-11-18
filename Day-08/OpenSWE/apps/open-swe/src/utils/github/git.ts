/**
 * @file GitHub Git 작업 유틸리티
 * @description
 * Git 저장소 복제, 브랜치 관리, 커밋/푸시 작업을 수행하는 유틸리티.
 *
 * 주요 기능:
 * 1. 저장소 복제 및 브랜치 체크아웃
 * 2. 파일 변경 사항 커밋 및 푸시
 * 3. Pull Request 생성 및 관리
 * 4. Git 상태 파싱 및 파일 필터링
 * 5. 로컬/샌드박스 모드 지원
 *
 * 처리 흐름:
 * 1. cloneRepo: 저장소 복제 및 브랜치 설정
 * 2. getValidFilesToCommit: 제외 패턴으로 파일 필터링
 * 3. checkoutBranchAndCommit: 변경 사항 커밋 및 푸시
 * 4. Pull/Push 재시도 로직으로 충돌 해결
 *
 * 사용 위치:
 * - Programmer 그래프: 코드 변경 커밋
 * - Manager 그래프: 저장소 초기화
 */

import { Sandbox } from "@daytonaio/sdk";
import { createLogger, LogLevel } from "../logger.js";
import {
  GraphConfig,
  TargetRepository,
  TaskPlan,
} from "@openswe/shared/open-swe/types";
import { TIMEOUT_SEC } from "@openswe/shared/constants";
import { getSandboxErrorFields } from "../sandbox-error-fields.js";
import { getRepoAbsolutePath } from "@openswe/shared/git";
import { ExecuteResponse } from "@daytonaio/sdk/src/types/ExecuteResponse.js";
import { withRetry } from "../retry.js";
import {
  addPullRequestNumberToActiveTask,
  getActiveTask,
  getPullRequestNumberFromActiveTask,
} from "@openswe/shared/open-swe/tasks";
import { createPullRequest, getBranch } from "./api.js";
import { addTaskPlanToIssue } from "./issue-task.js";
import { DEFAULT_EXCLUDED_PATTERNS } from "./constants.js";
import { escapeRegExp } from "../string-utils.js";
import { isLocalMode } from "@openswe/shared/open-swe/local-mode";
import { createShellExecutor } from "../shell-executor/index.js";
import { shouldCreateIssue } from "../should-create-issue.js";

const logger = createLogger(LogLevel.INFO, "GitHub-Git");

/**
 * git status 출력을 파싱하여 파일 경로 배열을 반환합니다.
 * 각 줄에서 git 상태 표시기(처음 3자)를 제거합니다.
 * @param gitStatusOutput - `git status --porcelain`의 출력.
 * @returns 파일 경로 배열.
 */
export function parseGitStatusOutput(gitStatusOutput: string): string[] {
  return gitStatusOutput
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.substring(3))
    .filter(Boolean);
}

/**
 * git add 작업 전에 파일을 유효성 검사하고 필터링합니다.
 * 커밋해서는 안 되는 파일/디렉토리를 제외합니다.
 * @param absoluteRepoDir - 저장소의 절대 경로.
 * @param sandbox - 샌드박스 인스턴스.
 * @param config - 그래프 설정.
 * @param excludePatterns - 제외할 패턴 배열.
 * @returns 커밋할 유효한 파일 경로 배열.
 */
async function getValidFilesToCommit(
  absoluteRepoDir: string,
  sandbox: Sandbox,
  config: GraphConfig,
  excludePatterns: string[] = DEFAULT_EXCLUDED_PATTERNS,
): Promise<string[]> {
  // 통합 셸 실행기 사용
  const executor = createShellExecutor(config);
  const gitStatusOutput = await executor.executeCommand({
    command: "git status --porcelain",
    workdir: absoluteRepoDir,
    timeout: TIMEOUT_SEC,
    sandbox,
  });

  if (gitStatusOutput.exitCode !== 0) {
    logger.error(`파일 유효성 검사를 위한 git 상태를 가져오는 데 실패했습니다.`, {
      gitStatusOutput,
    });
    throw new Error("파일 유효성 검사를 위한 git 상태를 가져오는 데 실패했습니다.");
  }

  const allFiles = parseGitStatusOutput(gitStatusOutput.result);

  const validFiles = allFiles.filter((filePath) => {
    return !shouldExcludeFile(filePath, excludePatterns);
  });

  const excludedFiles = allFiles.filter((filePath) => {
    return shouldExcludeFile(filePath, excludePatterns);
  });

  if (excludedFiles.length > 0) {
    logger.info(`${excludedFiles.length}개의 파일을 커밋에서 제외했습니다:`, {
      excludedFiles: excludedFiles,
    });
  }

  return validFiles;
}

/**
 * 패턴에 따라 파일을 커밋에서 제외해야 하는지 확인합니다.
 * @param filePath - 확인할 파일 경로.
 * @param excludePatterns - 제외할 패턴 배열.
 * @returns 제외해야 하면 true, 그렇지 않으면 false.
 */
export function shouldExcludeFile(
  filePath: string,
  excludePatterns: string[],
): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");

  return excludePatterns.some((pattern) => {
    if (pattern.includes("*")) {
      const escapedPattern = escapeRegExp(pattern);
      const regexPattern = escapedPattern.replace(/\\\*/g, ".*");
      const regex = new RegExp(
        `^${regexPattern}$|/${regexPattern}$|^${regexPattern}/|/${regexPattern}/`,
      );
      return regex.test(normalizedPath);
    }

    return (
      normalizedPath === pattern ||
      normalizedPath.startsWith(pattern + "/") ||
      normalizedPath.includes("/" + pattern + "/") ||
      normalizedPath.endsWith("/" + pattern)
    );
  });
}

/**
 * 스레드 ID로부터 브랜치 이름을 생성합니다.
 * @param configOrThreadId - 그래프 설정 또는 스레드 ID.
 * @returns 생성된 브랜치 이름.
 */
export function getBranchName(configOrThreadId: GraphConfig | string): string {
  const threadId =
    typeof configOrThreadId === "string"
      ? configOrThreadId
      : configOrThreadId.configurable?.thread_id;
  if (!threadId) {
    throw new Error("스레드 ID가 제공되지 않았습니다.");
  }

  return `open-swe/${threadId}`;
}

/**
 * 변경된 파일의 상태를 가져옵니다.
 * @param absoluteRepoDir - 저장소의 절대 경로.
 * @param sandbox - 샌드박스 인스턴스.
 * @param config - 그래프 설정.
 * @returns 변경된 파일 경로 배열.
 */
export async function getChangedFilesStatus(
  absoluteRepoDir: string,
  sandbox: Sandbox,
  config: GraphConfig,
): Promise<string[]> {
  // 통합 셸 실행기 사용
  const executor = createShellExecutor(config);
  const gitStatusOutput = await executor.executeCommand({
    command: "git status --porcelain",
    workdir: absoluteRepoDir,
    timeout: TIMEOUT_SEC,
    sandbox,
  });

  if (gitStatusOutput.exitCode !== 0) {
    logger.error(`변경된 파일 상태를 가져오는 데 실패했습니다.`, {
      gitStatusOutput,
    });
    return [];
  }

  return parseGitStatusOutput(gitStatusOutput.result);
}

/**
 * 변경 사항을 스태시하고 작업 디렉토리를 정리합니다.
 * @param absoluteRepoDir - 저장소의 절대 경로.
 * @param sandbox - 샌드박스 인스턴스.
 * @param config - 그래프 설정.
 * @returns 실행 응답 또는 실패 시 false.
 */
export async function stashAndClearChanges(
  absoluteRepoDir: string,
  sandbox: Sandbox | null,
  config?: GraphConfig,
): Promise<ExecuteResponse | false> {
  // 로컬 모드에서는 변경 사항을 스태시하고 정리하지 않습니다.
  if (config && isLocalMode(config)) {
    logger.info("로컬 모드에서 스태시 및 변경 사항 정리를 건너뜁니다.");
    return {
      exitCode: 0,
      result: "로컬 모드에서 스태시 및 정리를 건너뛰었습니다.",
    };
  }

  try {
    // 통합 셸 실행기 사용
    const executor = createShellExecutor(config);
    const gitStashOutput = await executor.executeCommand({
      command: "git add -A && git stash && git reset --hard",
      workdir: absoluteRepoDir,
      timeout: TIMEOUT_SEC,
      sandbox: sandbox || undefined,
    });

    if (gitStashOutput.exitCode !== 0) {
      logger.error(`스태시 및 변경 사항 정리에 실패했습니다.`, {
        gitStashOutput,
      });
    }
    return gitStashOutput;
  } catch (e) {
    // 통합 오류 처리
    const errorFields = getSandboxErrorFields(e);
    logger.error(`스태시 및 변경 사항 정리에 실패했습니다.`, {
      ...(errorFields && { errorFields }),
      ...(e instanceof Error && {
        name: e.name,
        message: e.message,
        stack: e.stack,
      }),
    });
    return errorFields ?? false;
  }
}

/**
 * 커밋 메시지를 구성합니다.
 * @returns 커밋 메시지 문자열.
 */
function constructCommitMessage(): string {
  const baseCommitMessage = "Apply patch";
  const skipCiString = "[skip ci]";
  const vercelSkipCi = process.env.SKIP_CI_UNTIL_LAST_COMMIT === "true";
  if (vercelSkipCi) {
    return `${baseCommitMessage} ${skipCiString}`;
  }
  return baseCommitMessage;
}

/**
 * 브랜치를 체크아웃하고 변경 사항을 커밋합니다.
 * @param config - 그래프 설정.
 * @param targetRepository - 대상 저장소.
 * @param sandbox - 샌드박스 인스턴스.
 * @param options - 브랜치 이름, GitHub 설치 토큰, 작업 계획, GitHub 이슈 ID.
 * @returns 브랜치 이름과 업데이트된 작업 계획.
 */
export async function checkoutBranchAndCommit(
  config: GraphConfig,
  targetRepository: TargetRepository,
  sandbox: Sandbox,
  options: {
    branchName?: string;
    githubInstallationToken: string;
    taskPlan: TaskPlan;
    githubIssueId: number;
  },
): Promise<{ branchName: string; updatedTaskPlan?: TaskPlan }> {
  const absoluteRepoDir = getRepoAbsolutePath(targetRepository);
  const branchName = options.branchName || getBranchName(config);

  logger.info(`${branchName} 브랜치에 변경 사항을 커밋합니다.`);

  // 커밋하기 전에 파일 유효성 검사 및 필터링
  const validFiles = await getValidFilesToCommit(
    absoluteRepoDir,
    sandbox,
    config,
  );

  if (validFiles.length === 0) {
    logger.info("필터링 후 커밋할 유효한 파일이 없습니다.");
    return { branchName, updatedTaskPlan: options.taskPlan };
  }

  // "."으로 모든 파일을 추가하는 대신 유효성이 검증된 파일만 추가합니다.
  await sandbox.git.add(absoluteRepoDir, validFiles);

  const botAppName = process.env.GITHUB_APP_NAME;
  if (!botAppName) {
    logger.error("GITHUB_APP_NAME 환경 변수가 설정되지 않았습니다.");
    throw new Error("GITHUB_APP_NAME 환경 변수가 설정되지 않았습니다.");
  }
  const userName = `${botAppName}[bot]`;
  const userEmail = `${botAppName}@users.noreply.github.com`;
  await sandbox.git.commit(
    absoluteRepoDir,
    constructCommitMessage(),
    userName,
    userEmail,
  );

  // git API를 사용하여 변경 사항을 푸시하여 인증을 처리합니다.
  const pushRes = await withRetry(
    async () => {
      return await sandbox.git.push(
        absoluteRepoDir,
        "git",
        options.githubInstallationToken,
      );
    },
    { retries: 3, delay: 0 },
  );

  if (pushRes instanceof Error) {
    const errorFields =
      pushRes instanceof Error
        ? {
            message: pushRes.message,
            name: pushRes.name,
          }
        : pushRes;

    logger.error("변경 사항 푸시 실패, 풀 후 다시 푸시 시도 중", {
      ...errorFields,
    });

    // git pull을 시도한 다음 다시 푸시합니다.
    const pullRes = await withRetry(
      async () => {
        return await sandbox.git.pull(
          absoluteRepoDir,
          "git",
          options.githubInstallationToken,
        );
      },
      { retries: 1, delay: 0 },
    );

    if (pullRes instanceof Error) {
      const errorFields =
        pullRes instanceof Error
          ? {
              message: pullRes.message,
              name: pullRes.name,
            }
          : pullRes;
      logger.error("푸시 실패 후 변경 사항 풀 실패.", {
        ...errorFields,
      });
    } else {
      logger.info("변경 사항을 성공적으로 풀했습니다. 다시 푸시합니다.");
    }

    const pushRes2 = await withRetry(
      async () => {
        return await sandbox.git.push(
          absoluteRepoDir,
          "git",
          options.githubInstallationToken,
        );
      },
      { retries: 3, delay: 0 },
    );

    if (pushRes2 instanceof Error) {
      const gitStatus = await sandbox.git.status(absoluteRepoDir);
      const errorFields = {
        ...(pushRes2 instanceof Error
          ? {
              name: pushRes2.name,
              message: pushRes2.message,
              stack: pushRes2.stack,
              cause: pushRes2.cause,
            }
          : pushRes2),
      };
      logger.error("변경 사항 푸시 실패", {
        ...errorFields,
        gitStatus: JSON.stringify(gitStatus, null, 2),
      });
      throw new Error("변경 사항 푸시 실패");
    } else {
      logger.info("푸시하기 전에 변경 사항을 성공적으로 풀했습니다.");
    }
  } else {
    logger.info("변경 사항을 성공적으로 푸시했습니다.");
  }

  // 활성 작업에 PR이 연결되어 있는지 확인합니다. 그렇지 않은 경우 임시 PR을 만듭니다.
  let updatedTaskPlan: TaskPlan | undefined;
  const activeTask = getActiveTask(options.taskPlan);
  const prForTask = getPullRequestNumberFromActiveTask(options.taskPlan);

  if (!prForTask) {
    logger.info("첫 번째 커밋 감지, 임시 풀 리퀘스트 생성 중.");
    const hasIssue = shouldCreateIssue(config);

    const reviewPullNumber = config.configurable?.reviewPullNumber;

    const pullRequest = await createPullRequest({
      owner: targetRepository.owner,
      repo: targetRepository.repo,
      headBranch: branchName,
      title: `[WIP]: ${activeTask?.title ?? "Open SWE task"}`,
      body: `**작업 진행 중인 OPEN SWE PR**${hasIssue ? `\n\n수정: #${options.githubIssueId}` : ""}${reviewPullNumber ? `\n\n풀 리퀘스트에서 트리거됨: #${reviewPullNumber}` : ""}`,
      githubInstallationToken: options.githubInstallationToken,
      draft: true,
      baseBranch: targetRepository.branch,
      nullOnError: true,
    });

    if (pullRequest) {
      updatedTaskPlan = addPullRequestNumberToActiveTask(
        options.taskPlan,
        pullRequest.number,
      );
      if (hasIssue) {
        await addTaskPlanToIssue(
          {
            githubIssueId: options.githubIssueId,
            targetRepository,
          },
          config,
          updatedTaskPlan,
        );
        logger.info(`임시 풀 리퀘스트 생성됨: #${pullRequest.number}`);
      }
    }
  }

  logger.info("성공적으로 체크아웃하고 변경 사항을 커밋했습니다.", {
    commitAuthor: userName,
  });

  return { branchName, updatedTaskPlan };
}

/**
 * 빈 커밋을 푸시합니다.
 * @param targetRepository - 대상 저장소.
 * @param sandbox - 샌드박스 인스턴스.
 * @param config - 그래프 설정.
 * @param options - GitHub 설치 토큰.
 */
export async function pushEmptyCommit(
  targetRepository: TargetRepository,
  sandbox: Sandbox,
  config: GraphConfig,
  options: {
    githubInstallationToken: string;
  },
) {
  const botAppName = process.env.GITHUB_APP_NAME;
  if (!botAppName) {
    logger.error("GITHUB_APP_NAME 환경 변수가 설정되지 않았습니다.");
    throw new Error("GITHUB_APP_NAME 환경 변수가 설정되지 않았습니다.");
  }
  const userName = `${botAppName}[bot]`;
  const userEmail = `${botAppName}@users.noreply.github.com`;

  try {
    const absoluteRepoDir = getRepoAbsolutePath(targetRepository);
    const executor = createShellExecutor(config);
    const setGitConfigRes = await executor.executeCommand({
      command: `git config user.name "${userName}" && git config user.email "${userEmail}"`,
      workdir: absoluteRepoDir,
      timeout: TIMEOUT_SEC,
    });
    if (setGitConfigRes.exitCode !== 0) {
      logger.error(`git 설정을 하는 데 실패했습니다.`, {
        exitCode: setGitConfigRes.exitCode,
        result: setGitConfigRes.result,
      });
      return;
    }

    const emptyCommitRes = await executor.executeCommand({
      command: "git commit --allow-empty -m 'CI를 트리거하기 위한 빈 커밋'",
      workdir: absoluteRepoDir,
      timeout: TIMEOUT_SEC,
    });
    if (emptyCommitRes.exitCode !== 0) {
      logger.error(`빈 커밋을 푸시하는 데 실패했습니다.`, {
        exitCode: emptyCommitRes.exitCode,
        result: emptyCommitRes.result,
      });
      return;
    }

    await sandbox.git.push(
      absoluteRepoDir,
      "git",
      options.githubInstallationToken,
    );

    logger.info("빈 커밋을 성공적으로 푸시했습니다.");
  } catch (e) {
    const errorFields = getSandboxErrorFields(e);
    logger.error(`빈 커밋을 푸시하는 데 실패했습니다.`, {
      ...(errorFields && { errorFields }),
      ...(e instanceof Error && {
        name: e.name,
        message: e.message,
        stack: e.stack,
      }),
    });
  }
}

/**
 * 최신 변경 사항을 풀합니다.
 * @param absoluteRepoDir - 저장소의 절대 경로.
 * @param sandbox - 샌드박스 인스턴스.
 * @param args - GitHub 설치 토큰.
 * @returns 성공 시 true, 실패 시 false.
 */
export async function pullLatestChanges(
  absoluteRepoDir: string,
  sandbox: Sandbox,
  args: {
    githubInstallationToken: string;
  },
): Promise<boolean> {
  try {
    await sandbox.git.pull(
      absoluteRepoDir,
      "git",
      args.githubInstallationToken,
    );
    return true;
  } catch (e) {
    const errorFields = getSandboxErrorFields(e);
    logger.error(`최신 변경 사항을 풀하는 데 실패했습니다.`, {
      ...(errorFields && { errorFields }),
      ...(e instanceof Error && {
        name: e.name,
        message: e.message,
        stack: e.stack,
      }),
    });
    return false;
  }
}

/**
 * 임시 자격 증명 도우미를 사용하여 GitHub 저장소를 안전하게 복제합니다.
 * GitHub 설치 토큰은 Git 구성 또는 원격 URL에 유지되지 않습니다.
 * @param sandbox - 샌드박스 인스턴스.
 * @param targetRepository - 대상 저장소.
 * @param args - GitHub 설치 토큰 및 상태 브랜치 이름.
 * @returns 복제된 브랜치 이름.
 */
export async function cloneRepo(
  sandbox: Sandbox,
  targetRepository: TargetRepository,
  args: {
    githubInstallationToken: string;
    stateBranchName?: string;
  },
): Promise<string> {
  const absoluteRepoDir = getRepoAbsolutePath(targetRepository);
  const cloneUrl = `https://github.com/${targetRepository.owner}/${targetRepository.repo}.git`;
  const branchName = args.stateBranchName || targetRepository.branch;

  try {
    // 저장소 복제 시도
    return await performClone(sandbox, cloneUrl, {
      branchName,
      targetRepository,
      absoluteRepoDir,
      githubInstallationToken: args.githubInstallationToken,
    });
  } catch (error) {
    const errorFields = getSandboxErrorFields(error);
    logger.error("저장소 복제 실패", errorFields ?? error);
    throw error;
  }
}

/**
 * 실제 Git 복제 작업을 수행하고 브랜치 관련 로직을 처리합니다.
 * 복제된 브랜치 이름을 반환합니다.
 * @param sandbox - 샌드박스 인스턴스.
 * @param cloneUrl - 복제할 URL.
 * @param args - 브랜치 이름, 대상 저장소, 절대 저장소 디렉토리, GitHub 설치 토큰.
 * @returns 복제된 브랜치 이름.
 */
async function performClone(
  sandbox: Sandbox,
  cloneUrl: string,
  args: {
    branchName: string | undefined;
    targetRepository: TargetRepository;
    absoluteRepoDir: string;
    githubInstallationToken: string;
  },
): Promise<string> {
  const {
    branchName,
    targetRepository,
    absoluteRepoDir,
    githubInstallationToken,
  } = args;
  logger.info("저장소 복제 중", {
    repoPath: `${targetRepository.owner}/${targetRepository.repo}`,
    branch: branchName,
    baseCommit: targetRepository.baseCommit,
  });

  if (!branchName && !targetRepository.baseCommit) {
    throw new Error(
      "브랜치 이름 없이 새 브랜치를 만들거나 기존 브랜치를 체크아웃할 수 없습니다.",
    );
  }

  const branchExists = branchName
    ? !!(await getBranch({
        owner: targetRepository.owner,
        repo: targetRepository.repo,
        branchName,
        githubInstallationToken,
      }))
    : false;

  if (branchExists) {
    logger.info("원격에 브랜치가 이미 존재합니다. 기존 브랜치를 복제합니다.", {
      branch: branchName,
    });
  }

  await sandbox.git.clone(
    cloneUrl,
    absoluteRepoDir,
    branchExists ? branchName : targetRepository.branch,
    branchExists ? undefined : targetRepository.baseCommit,
    "git",
    githubInstallationToken,
  );

  logger.info("저장소를 성공적으로 복제했습니다.", {
    repoPath: `${targetRepository.owner}/${targetRepository.repo}`,
    branch: branchName,
    baseCommit: targetRepository.baseCommit,
  });

  if (targetRepository.baseCommit) {
    return targetRepository.baseCommit;
  }

  if (!branchName) {
    throw new Error("브랜치 이름이 필요합니다.");
  }

  if (branchExists) {
    return branchName;
  }

  try {
    logger.info("브랜치 생성 중", {
      branch: branchName,
    });

    await sandbox.git.createBranch(absoluteRepoDir, branchName);

    logger.info("브랜치 생성됨", {
      branch: branchName,
    });
  } catch (error) {
    logger.error("브랜치 생성 실패, 브랜치 체크아웃 중", {
      branch: branchName,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
    });
  }

  try {
    // 원격에 브랜치가 존재하도록 빈 커밋을 푸시합니다.
    logger.info("원격에 빈 커밋 푸시 중", {
      branch: branchName,
    });
    await sandbox.git.push(absoluteRepoDir, "git", githubInstallationToken);

    logger.info("원격에 빈 커밋 푸시 완료", {
      branch: branchName,
    });
  } catch (error) {
    logger.error("브랜치에 빈 커밋을 푸시하는 데 실패했습니다.", {
      branch: branchName,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
    });
  }

  return branchName;
}

/**
 * 특정 커밋에서 특정 파일을 체크아웃하기 위한 옵션 인터페이스입니다.
 */
export interface CheckoutFilesOptions {
  sandbox: Sandbox;
  repoDir: string;
  commitSha: string;
  filePaths: string[];
}

/**
 * 주어진 커밋에서 특정 파일을 체크아웃합니다.
 * @param options - 체크아웃 옵션.
 */
export async function checkoutFilesFromCommit(
  options: CheckoutFilesOptions,
): Promise<void> {
  const { sandbox, repoDir, commitSha, filePaths } = options;

  if (filePaths.length === 0) {
    return;
  }

  logger.info(
    `${commitSha} 커밋에서 ${filePaths.length}개의 파일을 체크아웃합니다.`,
  );

  for (const filePath of filePaths) {
    try {
      const result = await sandbox.process.executeCommand(
        `git checkout --force ${commitSha} -- "${filePath}"`,
        repoDir,
        undefined,
        30,
      );

      if (result.exitCode !== 0) {
        logger.warn(
          `${commitSha} 커밋에서 ${filePath} 파일을 체크아웃하는 데 실패했습니다: ${result.result || "알 수 없는 오류"}`,
        );
      } else {
        logger.info(
          `${commitSha} 커밋에서 ${filePath}를 성공적으로 체크아웃했습니다.`,
        );
      }
    } catch (error) {
      logger.warn(`${filePath} 파일 체크아웃 중 오류 발생:`, { error });
    }
  }
}
