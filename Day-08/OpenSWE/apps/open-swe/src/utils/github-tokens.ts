/**
 * @file GitHub 토큰 추출 유틸리티
 * @description
 * GraphConfig에서 암호화된 GitHub 토큰들을 복호화하여 추출하는 유틸리티.
 * GitHub App Installation Token과 Personal Access Token을 모두 지원합니다.
 *
 * 토큰 타입:
 * 1. Installation Token: GitHub App 기반 인증 (프로덕션)
 * 2. Personal Access Token (PAT): 개발 환경용
 *
 * 모드:
 * - 프로덕션: Installation Token 필수
 * - 개발: PAT-only 모드 지원
 *
 * 보안:
 * - 모든 토큰은 암호화되어 저장
 * - 복호화 키는 환경 변수에서 로드
 * - AES-256-GCM 암호화 사용
 *
 * 사용 위치:
 * - api.ts: GitHub API 호출 시 인증
 * - git.ts: Git 작업 인증
 * - 모든 GitHub 관련 작업
 */

// GitHub 토큰 쿠키 상수
import {
  GITHUB_TOKEN_COOKIE, // GitHub Access Token 쿠키 키
  GITHUB_INSTALLATION_TOKEN_COOKIE, // Installation Token 쿠키 키
  GITHUB_INSTALLATION_ID, // Installation ID 설정 키
} from "@openswe/shared/constants";

// GraphConfig 타입
import { GraphConfig } from "@openswe/shared/open-swe/types";

// 암호 복호화 유틸리티
import { decryptSecret } from "@openswe/shared/crypto";

// PAT 추출 유틸리티
import { getGitHubPatFromConfig } from "./github-pat.js";

/**
 * GraphConfig에서 GitHub 토큰들을 추출하고 복호화합니다.
 *
 * @description
 * 설정에서 암호화된 GitHub 토큰들을 복호화하여 반환합니다.
 * 프로덕션과 개발 환경에서 다른 인증 방식을 지원합니다.
 *
 * 처리 흐름:
 * 1. 설정 객체 검증
 * 2. 암호화 키 확인 (환경 변수)
 * 3. 개발 환경 + PAT 있음 → PAT-only 모드
 * 4. 프로덕션 → Installation Token 필수
 * 5. 암호화된 토큰 복호화
 * 6. 토큰 객체 반환
 *
 * 인증 모드:
 * - **PAT-only 모드** (개발):
 *   - githubAccessToken: PAT
 *   - githubInstallationToken: PAT (동일)
 *   - installationId: 선택사항
 *
 * - **Installation Token 모드** (프로덕션):
 *   - githubAccessToken: User Access Token
 *   - githubInstallationToken: App Installation Token
 *   - installationId: 필수
 *
 * 필수 환경 변수:
 * - SECRETS_ENCRYPTION_KEY: 토큰 복호화 키
 * - NODE_ENV: 환경 구분 (production/development)
 *
 * @param {GraphConfig} config - 그래프 설정 (configurable 객체 포함)
 * @returns {{githubAccessToken: string, githubInstallationToken: string, installationId: string}}
 *   복호화된 토큰들
 * @throws {Error} 설정 객체 없음
 * @throws {Error} 암호화 키 누락
 * @throws {Error} Installation ID 누락 (프로덕션)
 * @throws {Error} Installation Token 누락
 *
 * @example
 * // 프로덕션 모드
 * const tokens = getGitHubTokensFromConfig(config);
 * const octokit = new Octokit({ auth: tokens.githubInstallationToken });
 *
 * @example
 * // 개발 모드 (PAT-only)
 * const tokens = getGitHubTokensFromConfig(config);
 * // tokens.githubAccessToken === tokens.githubInstallationToken (PAT)
 */
export function getGitHubTokensFromConfig(config: GraphConfig): {
  githubAccessToken: string;
  githubInstallationToken: string;
  installationId: string;
} {
  // === 1단계: 설정 객체 검증 ===
  if (!config.configurable) {
    throw new Error("No configurable object found in graph config.");
  }

  // === 2단계: 암호화 키 확인 ===
  const encryptionKey = process.env.SECRETS_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("Missing SECRETS_ENCRYPTION_KEY environment variable.");
  }

  const isProd = process.env.NODE_ENV === "production";

  // === 3단계: PAT-only 모드 확인 (개발 환경) ===
  const githubPat = getGitHubPatFromConfig(config.configurable, encryptionKey);
  if (githubPat && !isProd) {
    // 개발 환경에서 PAT가 있으면 PAT-only 모드
    return {
      githubAccessToken: githubPat,
      githubInstallationToken: githubPat, // 동일한 PAT 사용
      installationId: config.configurable[GITHUB_INSTALLATION_ID] ?? "",
    };
  }

  // === 4단계: Installation Token 모드 (프로덕션) ===
  const installationId = config.configurable[GITHUB_INSTALLATION_ID];
  if (!installationId) {
    throw new Error(
      `Missing required ${GITHUB_INSTALLATION_ID} in configuration.`,
    );
  }

  const encryptedGitHubToken = config.configurable[GITHUB_TOKEN_COOKIE];
  const encryptedInstallationToken =
    config.configurable[GITHUB_INSTALLATION_TOKEN_COOKIE];
  if (!encryptedInstallationToken) {
    throw new Error(
      `Missing required ${GITHUB_INSTALLATION_TOKEN_COOKIE} in configuration.`,
    );
  }

  // === 5단계: 토큰 복호화 ===
  const githubAccessToken = encryptedGitHubToken
    ? decryptSecret(encryptedGitHubToken, encryptionKey)
    : "";
  const githubInstallationToken = decryptSecret(
    encryptedInstallationToken,
    encryptionKey,
  );

  return { githubAccessToken, githubInstallationToken, installationId };
}
