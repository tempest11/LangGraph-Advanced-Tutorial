/**
 * @file GitHub 이슈 계획 메시지 관리
 * @description
 * GitHub 이슈 댓글에 Planner의 계획 메시지를 게시/업데이트하는 유틸리티.
 *
 * 주요 기능:
 * 1. 이슈 댓글 생성/업데이트
 * 2. XML 태그로 메시지 구분 (<open-swe-plan-message>)
 * 3. 기존 댓글 찾기 및 업데이트
 * 4. 로컬 모드에서 건너뛰기
 *
 * 처리 흐름:
 * 1. 로컬 모드 확인 → 건너뛰기
 * 2. 기존 댓글 검색 (GitHub App 이름으로 필터링)
 * 3. 없으면 새 댓글 생성
 * 4. 있으면 기존 댓글에 메시지 추가/갱신
 *
 * 사용 위치:
 * - Planner 그래프: 계획 제안 게시
 * - Manager 그래프: 진행 상황 업데이트
 */

// 그래프 설정 타입
import { GraphConfig } from "@openswe/shared/open-swe/types";

// 토큰 추출 유틸리티
import { getGitHubTokensFromConfig } from "../github-tokens.js";

// GitHub API 함수들
import {
  createIssueComment, // 새 댓글 생성
  getIssueComments, // 댓글 목록 조회
  updateIssueComment, // 기존 댓글 업데이트
} from "./api.js";

// 로거
import { createLogger, LogLevel } from "../logger.js";

// 로컬 모드 확인
import { isLocalMode } from "@openswe/shared/open-swe/local-mode";

/**
 * 로거 인스턴스
 * @constant {Logger}
 */
const logger = createLogger(LogLevel.INFO, "GitHubPlan");

/**
 * 계획 메시지 시작 태그
 * @description XML 형식의 열기 태그로 계획 메시지 영역 표시
 * @constant {string}
 */
const PLAN_MESSAGE_OPEN_TAG = "<open-swe-plan-message>";

/**
 * 계획 메시지 종료 태그
 * @description XML 형식의 닫기 태그로 계획 메시지 영역 표시
 * @constant {string}
 */
const PLAN_MESSAGE_CLOSE_TAG = "</open-swe-plan-message>";

/**
 * 댓글 본문에 계획 메시지를 추가하거나 업데이트합니다.
 *
 * @description
 * 기존 댓글에 계획 메시지 태그가 있으면 해당 영역만 교체하고,
 * 없으면 댓글 끝에 새 태그 영역을 추가합니다.
 *
 * 처리 로직:
 * 1. 기존 태그 존재 확인
 * 2. 있으면: 태그 사이 내용만 교체 (앞뒤 보존)
 * 3. 없으면: 끝에 새 태그 영역 추가
 *
 * @param {string} body - 기존 댓글 본문
 * @param {string} message - 추가/갱신할 계획 메시지
 * @returns {string} 업데이트된 댓글 본문
 *
 * @example
 * // 기존 태그 없음
 * const updated = formatBodyWithPlanMessage(
 *   "원본 내용",
 *   "새 계획"
 * );
 * // "원본 내용\n<open-swe-plan-message>\n\n새 계획\n\n</open-swe-plan-message>"
 *
 * @example
 * // 기존 태그 있음
 * const updated = formatBodyWithPlanMessage(
 *   "원본<open-swe-plan-message>구 계획</open-swe-plan-message>추가 내용",
 *   "새 계획"
 * );
 * // "원본<open-swe-plan-message>\n\n새 계획\n\n</open-swe-plan-message>\n추가 내용"
 */
function formatBodyWithPlanMessage(body: string, message: string): string {
  // 기존 태그가 있으면 해당 영역만 교체
  if (
    body.includes(PLAN_MESSAGE_OPEN_TAG) &&
    body.includes(PLAN_MESSAGE_CLOSE_TAG)
  ) {
    const bodyBeforeTag = body.split(PLAN_MESSAGE_OPEN_TAG)[0];
    const bodyAfterTag = body.split(PLAN_MESSAGE_CLOSE_TAG)[1];
    const newInnerContents = `\n${PLAN_MESSAGE_OPEN_TAG}\n\n${message}\n\n${PLAN_MESSAGE_CLOSE_TAG}\n`;
    return `${bodyBeforeTag}${newInnerContents}${bodyAfterTag}`;
  }

  // 태그가 없으면 끝에 추가
  return `${body}\n${PLAN_MESSAGE_OPEN_TAG}\n\n${message}\n\n${PLAN_MESSAGE_CLOSE_TAG}`;
}

/**
 * 태스크 항목을 코드 블록으로 감쌉니다.
 *
 * @description
 * Markdown 코드 블록(```) 내부의 백틱을 이스케이프하여
 * GitHub 댓글에 안전하게 표시할 수 있도록 합니다.
 *
 * 변환 로직:
 * 1. 내부 ``` → \``` 로 이스케이프
 * 2. 전체를 ```\n...\n``` 로 감싸기
 *
 * @param {string} taskItem - 태스크 항목 문자열
 * @returns {string} 코드 블록으로 감싼 문자열
 *
 * @example
 * const task = "Run `npm install`";
 * const cleaned = cleanTaskItems(task);
 * // "```\nRun `npm install`\n```"
 *
 * @example
 * // 내부 백틱 이스케이프
 * const task = "Use ```code``` here";
 * const cleaned = cleanTaskItems(task);
 * // "```\nUse \\```code\\``` here\n```"
 */
export function cleanTaskItems(taskItem: string): string {
  return "```\n" + taskItem.replace("```", "\\```") + "\n```";
}

/**
 * GitHub 이슈에 계획 댓글을 게시하거나 업데이트합니다.
 *
 * @description
 * Planner가 생성한 계획을 GitHub 이슈 댓글로 게시합니다.
 * GitHub App 이름으로 기존 댓글을 찾아 업데이트하거나,
 * 없으면 새 댓글을 생성합니다.
 *
 * 처리 흐름:
 * 1. 로컬 모드 확인 → 건너뛰기
 * 2. GitHub App 이름 확인 (GITHUB_APP_NAME)
 * 3. Installation Token 가져오기
 * 4. 기존 댓글 목록 조회
 * 5. App 이름으로 시작하는 마지막 댓글 찾기
 * 6. 없으면: 새 댓글 생성
 * 7. 있으면: formatBodyWithPlanMessage로 업데이트
 *
 * 주요 특징:
 * - 로컬 모드에서는 댓글 게시 생략
 * - 실패 시 예외 throw 안 함 (전체 프로세스 중단 방지)
 * - 기존 댓글의 다른 내용은 보존
 *
 * 필수 환경 변수:
 * - GITHUB_APP_NAME: GitHub App 이름 (댓글 필터링용)
 *
 * @param {Object} input - 입력 파라미터
 * @param {number} input.githubIssueId - 이슈 번호
 * @param {Object} input.targetRepository - 대상 레포지토리 (owner, repo)
 * @param {string} input.commentBody - 댓글 내용
 * @param {GraphConfig} input.config - 그래프 설정
 * @returns {Promise<void>}
 *
 * @example
 * // Planner에서 계획 게시
 * await postGitHubIssueComment({
 *   githubIssueId: 123,
 *   targetRepository: { owner: "user", repo: "project" },
 *   commentBody: "## 실행 계획\n1. ...",
 *   config
 * });
 */
export async function postGitHubIssueComment(input: {
  githubIssueId: number;
  targetRepository: { owner: string; repo: string };
  commentBody: string;
  config: GraphConfig;
}): Promise<void> {
  const { githubIssueId, targetRepository, commentBody, config } = input;

  // === 1단계: 로컬 모드 확인 ===
  if (isLocalMode(config)) {
    logger.info("Skipping GitHub comment posting in local mode");
    return;
  }

  // === 2단계: GitHub App 이름 확인 ===
  const githubAppName = process.env.GITHUB_APP_NAME;
  if (!githubAppName) {
    throw new Error("GITHUB_APP_NAME not set");
  }

  try {
    // === 3단계: Installation Token 가져오기 ===
    const { githubInstallationToken } = getGitHubTokensFromConfig(config);

    // === 4단계: 기존 댓글 목록 조회 ===
    const existingComments = await getIssueComments({
      owner: targetRepository.owner,
      repo: targetRepository.repo,
      issueNumber: githubIssueId,
      githubInstallationToken,
      filterBotComments: false, // 모든 댓글 조회
    });

    // === 5단계: Open SWE App의 마지막 댓글 찾기 ===
    const existingOpenSWEComment = existingComments?.findLast((c) =>
      c.user?.login?.toLowerCase()?.startsWith(githubAppName.toLowerCase()),
    );

    // === 6단계: 기존 댓글 없으면 새로 생성 ===
    if (!existingOpenSWEComment) {
      await createIssueComment({
        owner: targetRepository.owner,
        repo: targetRepository.repo,
        issueNumber: githubIssueId,
        body: commentBody,
        githubToken: githubInstallationToken,
      });

      logger.info(`Posted comment to GitHub issue #${githubIssueId}`);
      return;
    }

    // === 7단계: 기존 댓글 업데이트 ===
    const newCommentBody = formatBodyWithPlanMessage(
      existingOpenSWEComment.body ?? "",
      commentBody,
    );
    await updateIssueComment({
      owner: targetRepository.owner,
      repo: targetRepository.repo,
      commentId: existingOpenSWEComment.id,
      body: newCommentBody,
      githubInstallationToken,
    });

    logger.info(`Updated comment to GitHub issue #${githubIssueId}`);
  } catch (error) {
    // 댓글 게시 실패로 전체 프로세스를 중단하지 않음
    logger.error("Failed to post GitHub comment:", error);
  }
}
