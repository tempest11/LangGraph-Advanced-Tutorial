/**
 * @file GitHub PR 리뷰 댓글 답글 도구
 * @description
 * GitHub Pull Request 리뷰 댓글에 자동으로 답글을 다는 LangChain 도구들.
 * Reviewer 그래프가 PR 리뷰 작업을 완료한 후 GitHub에 응답할 수 있도록 지원.
 *
 * 주요 기능:
 * 1. 리뷰 댓글에 직접 답글 (replyToReviewComment)
 * 2. PR 댓글에 인용 답글 (quoteReplyToPullRequestComment)
 * 3. 리뷰에 인용 답글 (quoteReplyToReview)
 * 4. 도구 포함 여부 자동 판단 (GitHub Webhook 기반)
 *
 * 사용 시나리오:
 * - Reviewer가 코드 리뷰 결과를 GitHub PR에 자동 게시
 * - 사용자의 리뷰 댓글에 봇이 응답
 * - PR 리뷰 워크플로우 자동화
 *
 * 인증:
 * - GitHub App Installation Token 사용
 * - config.configurable에서 토큰 및 PR 정보 추출
 */

// LangChain 도구 생성 함수
import { tool } from "@langchain/core/tools";

// 리뷰 답글 도구 필드 정의 (3가지 도구)
import {
  createReplyToCommentToolFields, // PR 댓글 답글
  createReplyToReviewCommentToolFields, // 리뷰 댓글 답글
  createReplyToReviewToolFields, // 리뷰 답글
} from "@openswe/shared/open-swe/tools";

// GitHub 토큰 추출 유틸리티
import { getGitHubTokensFromConfig } from "../utils/github-tokens.js";

// GraphConfig, GraphState 타입
import { GraphConfig, GraphState } from "@openswe/shared/open-swe/types";

// GitHub API 리뷰 답글 함수들
import {
  quoteReplyToPullRequestComment, // PR 댓글에 인용 답글
  quoteReplyToReview, // 리뷰에 인용 답글
  replyToReviewComment, // 리뷰 댓글에 직접 답글
} from "../utils/github/api.js";

// 최근 사용자 요청 추출 유틸리티
import { getRecentUserRequest } from "../utils/user-request.js";

// 요청 출처 열거형 (GitHub Webhook 등)
import { RequestSource } from "../constants.js";

// GitHub 사용자 로그인 헤더 상수
import { GITHUB_USER_LOGIN_HEADER } from "@openswe/shared/constants";

/**
 * 리뷰 댓글 도구 포함 여부 판단
 *
 * @description
 * 현재 실행 컨텍스트가 GitHub PR 리뷰 상황인지 판단하여
 * 리뷰 댓글 도구를 포함할지 결정.
 *
 * 포함 조건 (OR):
 * 1. 요청 출처가 GITHUB_PULL_REQUEST_WEBHOOK (GitHub에서 웹훅 호출)
 * 2. config.configurable.reviewPullNumber 존재 (수동으로 PR 번호 지정)
 *
 * 사용처:
 * - Reviewer 그래프의 도구 리스트 구성 시
 * - PR 리뷰가 아닌 경우 불필요한 도구 제외
 *
 * @param {GraphState} state - 그래프 상태 (메시지 히스토리)
 * @param {GraphConfig} config - 그래프 설정 (reviewPullNumber)
 * @returns {boolean} 리뷰 댓글 도구 포함 여부
 *
 * @example
 * // GitHub Webhook에서 호출된 경우
 * const shouldInclude = shouldIncludeReviewCommentTool(state, config);
 * // => true (PR 리뷰 컨텍스트)
 */
export function shouldIncludeReviewCommentTool(
  state: GraphState,
  config: GraphConfig,
): boolean {
  // === 1단계: 최근 사용자 메시지 가져오기 ===
  const userMessage = getRecentUserRequest(state.messages, {
    returnFullMessage: true,
    config,
  });

  // === 2단계: 요청 출처 확인 ===
  // GitHub PR Webhook 또는 reviewPullNumber 설정 확인
  const shouldIncludeReviewCommentTool =
    userMessage.additional_kwargs?.requestSource ===
      RequestSource.GITHUB_PULL_REQUEST_WEBHOOK ||
    !!config.configurable?.reviewPullNumber;

  return shouldIncludeReviewCommentTool;
}

/**
 * 리뷰 댓글 직접 답글 도구 팩토리
 *
 * @description
 * GitHub PR의 특정 리뷰 댓글에 직접 답글을 다는 LangChain 도구 생성.
 *
 * 처리 흐름:
 * 1. GitHub Installation Token 추출
 * 2. reviewPullNumber 검증 (config.configurable)
 * 3. GitHub API로 답글 생성 (replyToReviewComment)
 * 4. 성공 상태 반환
 *
 * 필수 파라미터:
 * - input.id: 리뷰 댓글 ID
 * - input.comment: 답글 내용
 * - config.configurable.reviewPullNumber: PR 번호
 *
 * @param {Pick<GraphState, "targetRepository">} state - 그래프 상태 (타겟 레포지토리)
 * @param {GraphConfig} config - 그래프 설정 (GitHub 토큰, PR 번호)
 * @returns {Tool} 리뷰 댓글 답글 도구
 *
 * @throws {Error} reviewPullNumber가 없을 때
 *
 * @example
 * // Reviewer 그래프에서 사용
 * const tool = createReplyToReviewCommentTool(state, config);
 * await tool.invoke({ id: 123456, comment: "Fixed the issue!" });
 */
export function createReplyToReviewCommentTool(
  state: Pick<GraphState, "targetRepository">,
  config: GraphConfig,
) {
  const replyToReviewCommentTool = tool(
    async (input): Promise<{ result: string; status: "success" | "error" }> => {
      // === 1단계: GitHub 토큰 추출 ===
      const { githubInstallationToken } = getGitHubTokensFromConfig(config);

      // === 2단계: PR 번호 추출 ===
      const { reviewPullNumber } = config.configurable ?? {};

      // === 3단계: PR 번호 검증 ===
      if (!reviewPullNumber) {
        throw new Error("No pull request number found");
      }

      // === 4단계: GitHub API로 답글 생성 ===
      await replyToReviewComment({
        owner: state.targetRepository.owner,
        repo: state.targetRepository.repo,
        commentId: input.id,
        body: input.comment,
        pullNumber: reviewPullNumber,
        githubInstallationToken,
      });

      // === 5단계: 성공 결과 반환 ===
      return {
        result: "Successfully replied to review comment.",
        status: "success",
      };
    },
    // 도구 메타데이터 (이름, 설명, 스키마)
    createReplyToReviewCommentToolFields(),
  );

  return replyToReviewCommentTool;
}

/**
 * PR 댓글 인용 답글 도구 팩토리
 *
 * @description
 * GitHub PR의 일반 댓글에 인용 답글을 다는 LangChain 도구 생성.
 * 원본 댓글 작성자를 멘션하여 알림 발송.
 *
 * 처리 흐름:
 * 1. GitHub Installation Token 추출
 * 2. reviewPullNumber 및 userLogin 검증
 * 3. GitHub API로 인용 답글 생성 (quoteReplyToPullRequestComment)
 * 4. 성공 상태 반환
 *
 * 필수 파라미터:
 * - input.id: PR 댓글 ID
 * - input.comment: 답글 내용
 * - config.configurable.reviewPullNumber: PR 번호
 * - config.configurable.GITHUB_USER_LOGIN_HEADER: 원본 댓글 작성자
 *
 * @param {Pick<GraphState, "targetRepository">} state - 그래프 상태 (타겟 레포지토리)
 * @param {GraphConfig} config - 그래프 설정 (GitHub 토큰, PR 번호, 사용자 로그인)
 * @returns {Tool} PR 댓글 인용 답글 도구
 *
 * @throws {Error} reviewPullNumber 또는 userLogin이 없을 때
 *
 * @example
 * // Reviewer 그래프에서 사용
 * const tool = createReplyToCommentTool(state, config);
 * await tool.invoke({ id: 789, comment: "@user Thanks for the feedback!" });
 */
export function createReplyToCommentTool(
  state: Pick<GraphState, "targetRepository">,
  config: GraphConfig,
) {
  const replyToReviewCommentTool = tool(
    async (input): Promise<{ result: string; status: "success" | "error" }> => {
      // === 1단계: GitHub 토큰 추출 ===
      const { githubInstallationToken } = getGitHubTokensFromConfig(config);

      // === 2단계: PR 번호 및 사용자 로그인 추출 ===
      const reviewPullNumber = config.configurable?.reviewPullNumber;
      const userLogin = config.configurable?.[GITHUB_USER_LOGIN_HEADER];

      // === 3단계: 필수 파라미터 검증 ===
      if (!reviewPullNumber || !userLogin) {
        throw new Error("No pull request number or user login found");
      }

      // === 4단계: GitHub API로 인용 답글 생성 ===
      // 원본 댓글 작성자를 멘션하여 알림 발송
      await quoteReplyToPullRequestComment({
        owner: state.targetRepository.owner,
        repo: state.targetRepository.repo,
        commentId: input.id,
        body: input.comment,
        pullNumber: reviewPullNumber,
        originalCommentUserLogin: userLogin,
        githubInstallationToken,
      });

      // === 5단계: 성공 결과 반환 ===
      return {
        result: "Successfully replied to review comment.",
        status: "success",
      };
    },
    // 도구 메타데이터 (이름, 설명, 스키마)
    createReplyToCommentToolFields(),
  );

  return replyToReviewCommentTool;
}

/**
 * 리뷰 인용 답글 도구 팩토리
 *
 * @description
 * GitHub PR의 전체 리뷰에 인용 답글을 다는 LangChain 도구 생성.
 * 리뷰 작성자를 멘션하여 알림 발송.
 *
 * 처리 흐름:
 * 1. GitHub Installation Token 추출
 * 2. reviewPullNumber 및 userLogin 검증
 * 3. GitHub API로 인용 답글 생성 (quoteReplyToReview)
 * 4. 성공 상태 반환
 *
 * 필수 파라미터:
 * - input.id: 리뷰 댓글 ID
 * - input.comment: 답글 내용
 * - config.configurable.reviewPullNumber: PR 번호
 * - config.configurable.GITHUB_USER_LOGIN_HEADER: 리뷰 작성자
 *
 * @param {Pick<GraphState, "targetRepository">} state - 그래프 상태 (타겟 레포지토리)
 * @param {GraphConfig} config - 그래프 설정 (GitHub 토큰, PR 번호, 사용자 로그인)
 * @returns {Tool} 리뷰 인용 답글 도구
 *
 * @throws {Error} reviewPullNumber 또는 userLogin이 없을 때
 *
 * @example
 * // Reviewer 그래프에서 사용
 * const tool = createReplyToReviewTool(state, config);
 * await tool.invoke({ id: 456, comment: "@reviewer All issues addressed!" });
 */
export function createReplyToReviewTool(
  state: Pick<GraphState, "targetRepository">,
  config: GraphConfig,
) {
  const replyToReviewTool = tool(
    async (input): Promise<{ result: string; status: "success" | "error" }> => {
      // === 1단계: GitHub 토큰 추출 ===
      const { githubInstallationToken } = getGitHubTokensFromConfig(config);

      // === 2단계: PR 번호 및 사용자 로그인 추출 ===
      const reviewPullNumber = config.configurable?.reviewPullNumber;
      const userLogin = config.configurable?.[GITHUB_USER_LOGIN_HEADER];

      // === 3단계: 필수 파라미터 검증 ===
      if (!reviewPullNumber || !userLogin) {
        throw new Error("No pull request number or user login found");
      }

      // === 4단계: GitHub API로 인용 답글 생성 ===
      // 리뷰 작성자를 멘션하여 알림 발송
      await quoteReplyToReview({
        owner: state.targetRepository.owner,
        repo: state.targetRepository.repo,
        reviewCommentId: input.id,
        body: input.comment,
        pullNumber: reviewPullNumber,
        originalCommentUserLogin: userLogin,
        githubInstallationToken,
      });

      // === 5단계: 성공 결과 반환 ===
      return {
        result: "Successfully replied to review.",
        status: "success",
      };
    },
    // 도구 메타데이터 (이름, 설명, 스키마)
    createReplyToReviewToolFields(),
  );

  return replyToReviewTool;
}
