/**
 * @file useGitHubToken.ts
 * @description
 * GitHub 설치 토큰을 가져오는 커스텀 훅.
 * Git 작업을 수행하기 위한 GitHub App 설치 토큰을 API를 통해 조회합니다.
 */

import { useState, useCallback } from "react";

/** GitHub API 토큰 응답 */
interface TokenResponse {
  /** GitHub 액세스 토큰 */
  token: string;
  /** GitHub App 설치 ID */
  installation_id: string;
}

interface UseGitHubTokenReturn {
  /** GitHub 액세스 토큰 */
  token: string | null;
  /** GitHub App 설치 ID */
  installationId: string | null;
  /** 로딩 상태 */
  isLoading: boolean;
  /** 에러 메시지 */
  error: string | null;
  /** 토큰 조회 함수 */
  fetchToken: () => Promise<string | null>;
}

/**
 * @hook useGitHubToken
 * @description
 * GitHub 설치 토큰을 관리하는 커스텀 훅.
 * 에이전트 서비스에 전달하여 사용자 대신 Git 작업을 수행할 수 있는 토큰을 제공합니다.
 *
 * @features
 * - `/api/github/token` 엔드포인트를 통한 토큰 조회
 * - 로딩/에러 상태 관리
 * - 토큰 및 설치 ID 캐싱
 *
 * @example
 * ```tsx
 * const { token, fetchToken, isLoading, error } = useGitHubToken();
 *
 * useEffect(() => {
 *   fetchToken();
 * }, []);
 * ```
 */
export function useGitHubToken(): UseGitHubTokenReturn {
  const [token, setToken] = useState<string | null>(null);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * GitHub 설치 토큰을 API에서 조회
   */
  const fetchToken = useCallback(async (): Promise<string | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/github/token");

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || "Failed to fetch token");
        setIsLoading(false);
        return null;
      }

      const data: TokenResponse = await response.json();
      setToken(data.token);
      setInstallationId(data.installation_id);
      setIsLoading(false);
      return data.token;
    } catch (err) {
      setError("Network error when fetching token");
      setIsLoading(false);
      return null;
    }
  }, []);

  return {
    token,
    installationId,
    isLoading,
    error,
    fetchToken,
  };
}
