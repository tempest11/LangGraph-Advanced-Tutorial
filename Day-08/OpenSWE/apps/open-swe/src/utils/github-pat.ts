/**
 * @file github-pat.ts
 * @description
 * GitHub Personal Access Token(PAT) 복호화 유틸리티 함수를 제공합니다.
 * Request 객체 또는 configurable에서 암호화된 PAT를 추출하여 복호화합니다.
 */

import { GITHUB_PAT } from "@openswe/shared/constants";
import { decryptSecret } from "@openswe/shared/crypto";

/**
 * Request에서 GitHub PAT를 추출하고 복호화합니다.
 *
 * @param configurable - 설정 객체
 * @param encryptionKey - 복호화 키
 * @returns 복호화된 PAT 또는 null
 */
export function getGitHubPatFromRequest(
  configurable: Record<string, any> | undefined,
  encryptionKey: string,
): string | null {
  if (!configurable) {
    return null;
  }
  const encryptedGitHubPat = configurable[GITHUB_PAT];
  if (!encryptedGitHubPat) {
    return null;
  }
  return decryptSecret(encryptedGitHubPat, encryptionKey);
}

/**
 * Configurable에서 GitHub PAT를 추출하고 복호화합니다.
 *
 * @param configurable - 설정 객체
 * @param encryptionKey - 복호화 키
 * @returns 복호화된 PAT 또는 null
 */
export function getGitHubPatFromConfig(
  configurable: Record<string, any> | undefined,
  encryptionKey: string,
): string | null {
  if (!configurable) {
    return null;
  }
  const encryptedGitHubPat = configurable[GITHUB_PAT];
  if (!encryptedGitHubPat) {
    return null;
  }
  return decryptSecret(encryptedGitHubPat, encryptionKey);
}
