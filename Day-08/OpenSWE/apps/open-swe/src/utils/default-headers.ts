/**
 * @file default-headers.ts
 * @description
 * GitHub API 요청에 필요한 기본 헤더를 생성하는 유틸리티 함수를 제공합니다.
 * GitHub App 인증(Installation Token) 또는 개인 액세스 토큰(PAT) 인증을 지원하며,
 * 환경(개발/프로덕션)에 따라 적절한 헤더를 자동으로 구성합니다.
 *
 * 주요 기능:
 * - GitHub App Installation Token 기반 인증
 * - GitHub Personal Access Token (PAT) 기반 인증 (개발 환경)
 * - 사용자 정보 헤더 자동 포함
 *
 * @example
 * const headers = getDefaultHeaders(config);
 * // GitHub API 요청 시 사용
 */

import { GraphConfig } from "@openswe/shared/open-swe/types";
import {
  GITHUB_INSTALLATION_TOKEN_COOKIE,
  GITHUB_TOKEN_COOKIE,
  GITHUB_USER_ID_HEADER,
  GITHUB_USER_LOGIN_HEADER,
  GITHUB_INSTALLATION_NAME,
  GITHUB_PAT,
  GITHUB_INSTALLATION_ID,
} from "@openswe/shared/constants";

/**
 * GitHub API 요청에 필요한 기본 헤더를 생성합니다.
 *
 * @description
 * GraphConfig에서 GitHub 인증 정보를 추출하여 API 요청에 필요한 헤더를 구성합니다.
 *
 * 인증 방식 우선순위:
 * 1. **개발 환경 + PAT**: Personal Access Token 단독 사용
 * 2. **프로덕션 환경**: GitHub App Installation Token + 사용자 정보 사용
 *
 * 필수 헤더 (프로덕션):
 * - GitHub Installation Token (쿠키)
 * - Installation Name
 * - Installation ID
 *
 * 선택 헤더 (프로덕션):
 * - GitHub User Token (쿠키)
 * - User ID
 * - User Login
 *
 * @param config - LangGraph 설정 객체 (GitHub 인증 정보 포함)
 * @returns GitHub API 요청에 사용할 헤더 객체
 *
 * @throws {Error} 프로덕션 환경에서 필수 헤더가 누락된 경우
 *
 * @example
 * // PAT 인증 (개발 환경)
 * const headers = getDefaultHeaders(config);
 * // { "x-github-pat": "ghp_xxx..." }
 *
 * // GitHub App 인증 (프로덕션)
 * const headers = getDefaultHeaders(config);
 * // {
 * //   "x-github-installation-token": "ghs_xxx...",
 * //   "x-github-installation-name": "my-org",
 * //   "x-github-installation-id": "12345",
 * //   ...
 * // }
 */
export function getDefaultHeaders(config: GraphConfig): Record<string, string> {
  const githubPat = config.configurable?.[GITHUB_PAT];
  const isProd = process.env.NODE_ENV === "production";
  if (githubPat && !isProd) {
    // PAT-only
    return {
      [GITHUB_PAT]: githubPat,
    };
  }

  const githubInstallationTokenCookie =
    config.configurable?.[GITHUB_INSTALLATION_TOKEN_COOKIE];
  const githubInstallationName =
    config.configurable?.[GITHUB_INSTALLATION_NAME];
  const githubInstallationId = config.configurable?.[GITHUB_INSTALLATION_ID];

  if (
    !githubInstallationTokenCookie ||
    !githubInstallationName ||
    !githubInstallationId
  ) {
    throw new Error("Missing required headers");
  }

  const githubTokenCookie = config.configurable?.[GITHUB_TOKEN_COOKIE] ?? "";
  const githubUserIdHeader = config.configurable?.[GITHUB_USER_ID_HEADER] ?? "";
  const githubUserLoginHeader =
    config.configurable?.[GITHUB_USER_LOGIN_HEADER] ?? "";

  return {
    // Required headers
    [GITHUB_INSTALLATION_TOKEN_COOKIE]: githubInstallationTokenCookie,
    [GITHUB_INSTALLATION_NAME]: githubInstallationName,
    [GITHUB_INSTALLATION_ID]: githubInstallationId,

    // Optional headers
    [GITHUB_TOKEN_COOKIE]: githubTokenCookie,
    [GITHUB_USER_ID_HEADER]: githubUserIdHeader,
    [GITHUB_USER_LOGIN_HEADER]: githubUserLoginHeader,
  };
}
