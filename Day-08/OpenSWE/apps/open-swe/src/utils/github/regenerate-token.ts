/**
 * @file GitHub Installation Token 재생성 유틸리티
 * @description
 * 만료된 GitHub App Installation Token을 재생성하고 암호화하는 유틸리티.
 *
 * 처리 흐름:
 * 1. Installation ID 검증
 * 2. 환경 변수 확인 (App ID, Private Key, Encryption Key)
 * 3. GitHub API로 새 Installation Token 발급
 * 4. 토큰 암호화 (AES-256-GCM)
 * 5. 암호화된 토큰 반환
 *
 * 사용 위치:
 * - api.ts: getInstallationTokenAndUpdateConfig()
 * - 토큰 만료 시 자동 갱신
 *
 * 보안:
 * - 토큰은 항상 암호화되어 저장
 * - Private Key는 환경 변수에서만 로드
 * - Installation Token은 1시간 후 만료
 */

// 암호화 유틸리티
import { encryptSecret } from "@openswe/shared/crypto";

// GitHub App 인증 유틸리티
import { getInstallationToken } from "@openswe/shared/github/auth";

/**
 * GitHub App Installation Token을 재생성하고 암호화합니다.
 *
 * @description
 * 만료된 또는 무효화된 Installation Token을 새로 발급받습니다.
 * GitHub App의 Private Key로 JWT를 생성하고, 이를 사용하여
 * Installation 특정 토큰을 발급받습니다.
 *
 * Installation Token 특징:
 * - 유효 기간: 1시간
 * - 권한: Installation에 설정된 권한만 가짐
 * - 자동 만료: 1시간 후 자동 무효화
 *
 * 필수 환경 변수:
 * - GITHUB_APP_ID: GitHub App ID
 * - GITHUB_APP_PRIVATE_KEY: GitHub App Private Key (PEM 형식)
 * - SECRETS_ENCRYPTION_KEY: 토큰 암호화 키 (32바이트)
 *
 * @param {string | undefined} installationId - GitHub App Installation ID
 * @returns {Promise<string>} 암호화된 Installation Token
 * @throws {Error} Installation ID 누락 또는 환경 변수 누락 시
 *
 * @example
 * // Installation Token 재생성
 * const encryptedToken = await regenerateInstallationToken("12345678");
 * // encryptedToken은 암호화되어 있으므로 decryptSecret로 복호화 필요
 *
 * @example
 * // 사용 예시 (api.ts)
 * const newToken = await regenerateInstallationToken(state.installationId);
 * updateConfig(GITHUB_INSTALLATION_TOKEN_COOKIE, newToken);
 */
export async function regenerateInstallationToken(
  installationId: string | undefined,
): Promise<string> {
  // === 1단계: Installation ID 검증 ===
  if (!installationId) {
    throw new Error(
      "Missing installation ID for regenerating installation token.",
    );
  }

  // === 2단계: 필수 환경 변수 확인 ===
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const secretsEncryptionKey = process.env.SECRETS_ENCRYPTION_KEY;

  if (!appId || !privateKey || !secretsEncryptionKey) {
    throw new Error(
      "Missing environment variables for regenerating installation token.",
    );
  }

  // === 3단계: GitHub API로 새 Installation Token 발급 ===
  // getInstallationToken이 JWT 생성 및 API 호출 처리
  const newInstallationToken = await getInstallationToken(
    installationId,
    appId,
    privateKey,
  );

  // === 4단계: 토큰 암호화 및 반환 ===
  // AES-256-GCM 암호화로 토큰 보호
  return encryptSecret(newInstallationToken, secretsEncryptionKey);
}
