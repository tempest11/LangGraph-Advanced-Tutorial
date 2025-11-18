/**
 * @file GitHub API 응답 타입 정의
 * @description
 * Octokit REST API 응답 타입을 재export하여 프로젝트 전역에서 사용.
 * GitHub API와의 타입 안정성을 보장합니다.
 *
 * 주요 타입:
 * - GitHubIssue: 이슈 상세 정보
 * - GitHubIssueComment: 이슈 댓글
 * - GitHubPullRequest: PR 생성 응답
 * - GitHubPullRequestUpdate: PR 업데이트 응답
 * - GitHubPullRequestList: PR 목록
 * - GitHubBranch: 브랜치 정보
 * - GitHubPullRequestGet: PR 상세 조회
 * - GitHubReviewComment: PR 리뷰 댓글
 *
 * 사용 위치:
 * - api.ts: API 함수 반환 타입
 * - git.ts, issue-messages.ts, plan.ts 등
 */

// Octokit REST API 타입 정의
import type { RestEndpointMethodTypes } from "@octokit/rest";

/**
 * GitHub 이슈 타입
 * @typedef {RestEndpointMethodTypes["issues"]["get"]["response"]["data"]} GitHubIssue
 * @description 이슈 조회 API 응답 타입 (제목, 본문, 상태, 라벨 등)
 */
export type GitHubIssue =
  RestEndpointMethodTypes["issues"]["get"]["response"]["data"];

/**
 * GitHub 이슈 댓글 타입
 * @typedef {RestEndpointMethodTypes["issues"]["listComments"]["response"]["data"][number]} GitHubIssueComment
 * @description 이슈 댓글 배열의 단일 요소 타입
 */
export type GitHubIssueComment =
  RestEndpointMethodTypes["issues"]["listComments"]["response"]["data"][number];

/**
 * GitHub Pull Request 생성 응답 타입
 * @typedef {RestEndpointMethodTypes["pulls"]["create"]["response"]["data"]} GitHubPullRequest
 * @description PR 생성 API 응답 타입 (PR 번호, URL 등)
 */
export type GitHubPullRequest =
  RestEndpointMethodTypes["pulls"]["create"]["response"]["data"];

/**
 * GitHub Pull Request 업데이트 응답 타입
 * @typedef {RestEndpointMethodTypes["pulls"]["update"]["response"]["data"]} GitHubPullRequestUpdate
 * @description PR 업데이트 API 응답 타입
 */
export type GitHubPullRequestUpdate =
  RestEndpointMethodTypes["pulls"]["update"]["response"]["data"];

/**
 * GitHub Pull Request 목록 타입
 * @typedef {RestEndpointMethodTypes["pulls"]["list"]["response"]["data"]} GitHubPullRequestList
 * @description PR 목록 조회 API 응답 타입 (배열)
 */
export type GitHubPullRequestList =
  RestEndpointMethodTypes["pulls"]["list"]["response"]["data"];

/**
 * GitHub 브랜치 타입
 * @typedef {RestEndpointMethodTypes["repos"]["getBranch"]["response"]["data"]} GitHubBranch
 * @description 브랜치 조회 API 응답 타입 (커밋 SHA, 보호 상태 등)
 */
export type GitHubBranch =
  RestEndpointMethodTypes["repos"]["getBranch"]["response"]["data"];

/**
 * GitHub Pull Request 상세 조회 타입
 * @typedef {RestEndpointMethodTypes["pulls"]["get"]["response"]["data"]} GitHubPullRequestGet
 * @description PR 상세 조회 API 응답 타입
 */
export type GitHubPullRequestGet =
  RestEndpointMethodTypes["pulls"]["get"]["response"]["data"];

/**
 * GitHub PR 리뷰 댓글 타입
 * @typedef {RestEndpointMethodTypes["pulls"]["createReviewComment"]["response"]["data"]} GitHubReviewComment
 * @description PR 리뷰 댓글 생성 API 응답 타입
 */
export type GitHubReviewComment =
  RestEndpointMethodTypes["pulls"]["createReviewComment"]["response"]["data"];
