/**
 * @file useGitHubInstallations.ts
 * @description
 * GitHub App 설치 목록을 관리하는 커스텀 훅.
 * 사용자가 설치한 GitHub App 계정 목록을 조회하고, 현재 선택된 설치를 추적하며,
 * 계정 전환 기능을 제공합니다.
 */

import { useState, useEffect, useCallback } from "react";
import { GITHUB_INSTALLATION_ID_COOKIE } from "@openswe/shared/constants";
import { getCookie } from "@/lib/utils";
import { Endpoints } from "@octokit/types";

/** GitHub API 설치 목록 응답 타입 */
type GitHubInstallationsResponse =
  Endpoints["GET /user/installations"]["response"]["data"];
/** GitHub API 단일 설치 타입 */
type GitHubInstallation = GitHubInstallationsResponse["installations"][0];

/** 간소화된 설치 정보 */
export interface Installation {
  /** 설치 ID */
  id: number;
  /** 계정 이름 (조직명 또는 사용자명) */
  accountName: string;
  /** 계정 타입 */
  accountType: "User" | "Organization";
  /** 아바타 이미지 URL */
  avatarUrl: string;
}

interface UseGitHubInstallationsReturn {
  /** 모든 설치 목록 */
  installations: Installation[];
  /** 현재 선택된 설치 ID */
  currentInstallationId: string | null;
  /** 현재 선택된 설치 정보 */
  currentInstallation: Installation | null;
  /** 로딩 상태 */
  isLoading: boolean;
  /** 에러 메시지 */
  error: string | null;
  /** 설치 목록 새로고침 */
  refreshInstallations: () => Promise<void>;
  /** 현재 설치 ID 새로고침 */
  refreshCurrentInstallation: () => void;
  /** 설치 계정 전환 */
  switchInstallation: (installationId: string) => Promise<void>;
}

/**
 * GitHub API 설치 데이터를 간소화된 형식으로 변환
 */
const transformInstallation = (
  installation: GitHubInstallation,
): Installation => {
  if (!installation.account) {
    throw new Error("Installation account is null");
  }

  // Handle both User and Organization account types
  let accountName: string;
  if ("login" in installation.account && installation.account.login) {
    accountName = installation.account.login;
  } else if ("slug" in installation.account && installation.account.slug) {
    accountName = installation.account.slug;
  } else if ("name" in installation.account && installation.account.name) {
    accountName = installation.account.name;
  } else {
    accountName = "Unknown";
  }

  const accountType = installation.target_type as "User" | "Organization";

  return {
    id: installation.id,
    accountName,
    accountType,
    avatarUrl: installation.account.avatar_url,
  };
};

/**
 * @hook useGitHubInstallations
 * @description
 * GitHub App 설치를 관리하는 커스텀 훅.
 * API 엔드포인트에서 설치 데이터를 가져오고 쿠키에서 현재 설치 ID를 읽어옵니다.
 * 설치 간 전환 기능을 제공하며, 유효하지 않은 설치는 자동으로 첫 번째 설치로 대체합니다.
 *
 * @features
 * - `/api/github/installations` 엔드포인트를 통한 설치 목록 조회
 * - 쿠키 기반 현재 설치 추적
 * - 설치 계정 전환 및 쿠키 자동 업데이트
 * - 유효하지 않은 설치 자동 복구
 * - 로딩/에러 상태 관리
 *
 * @example
 * ```tsx
 * const {
 *   installations,
 *   currentInstallation,
 *   switchInstallation,
 *   isLoading,
 * } = useGitHubInstallations();
 *
 * return (
 *   <select
 *     value={currentInstallation?.id}
 *     onChange={(e) => switchInstallation(e.target.value)}
 *   >
 *     {installations.map((inst) => (
 *       <option key={inst.id} value={inst.id}>
 *         {inst.accountName}
 *       </option>
 *     ))}
 *   </select>
 * );
 * ```
 */
export function useGitHubInstallations(): UseGitHubInstallationsReturn {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentInstallationId, setCurrentInstallationId] = useState<
    string | null
  >(null);

  /**
   * 쿠키에서 현재 설치 ID 조회
   */
  const getCurrentInstallationId = useCallback((): string | null => {
    return getCookie(GITHUB_INSTALLATION_ID_COOKIE);
  }, []);

  /**
   * API에서 설치 목록 조회
   */
  const fetchInstallations = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch("/api/github/installations");

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data: GitHubInstallationsResponse = await response.json();
      const transformedInstallations = data.installations.map(
        transformInstallation,
      );

      setInstallations(transformedInstallations);

      // Get the current installation ID from the cookie
      const currentId = getCurrentInstallationId();
      setCurrentInstallationId(currentId);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch installations";
      setError(errorMessage);
      setInstallations([]);
    } finally {
      setIsLoading(false);
    }
  }, [getCurrentInstallationId]);

  /**
   * 설치 계정 전환 (API 엔드포인트 사용)
   */
  const switchInstallation = useCallback(async (installationId: string) => {
    try {
      const response = await fetch("/api/github/switch-installation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ installationId }),
      });

      if (response.ok) {
        // Update local state immediately for responsive UI
        setCurrentInstallationId(installationId);
      } else {
        console.error("Failed to switch installation");
      }
    } catch (error) {
      console.error("Error switching installation:", error);
    }
  }, []);

  // Auto-select default installation when installations are loaded
  useEffect(() => {
    if (installations.length > 0 && !isLoading) {
      // Check if current installation ID is valid
      const isCurrentInstallationValid =
        currentInstallationId &&
        installations.some(
          (installation) =>
            installation.id.toString() === currentInstallationId,
        );

      if (!isCurrentInstallationValid) {
        // No valid installation selected, auto-select the first one
        const firstInstallation = installations[0];
        if (firstInstallation) {
          switchInstallation(firstInstallation.id.toString());
        }
      }
    }
  }, [installations, isLoading, currentInstallationId, switchInstallation]);

  // Initialize installation ID from cookie on mount
  useEffect(() => {
    const cookieInstallationId = getCurrentInstallationId();
    setCurrentInstallationId(cookieInstallationId);
  }, [getCurrentInstallationId]);

  // Initial fetch on mount
  useEffect(() => {
    fetchInstallations();
  }, [fetchInstallations]);

  // Refresh installations function
  const refreshInstallations = useCallback(async () => {
    await fetchInstallations();
  }, [fetchInstallations]);

  // Refresh current installation ID from cookie
  const refreshCurrentInstallation = useCallback(() => {
    const cookieInstallationId = getCurrentInstallationId();
    setCurrentInstallationId(cookieInstallationId);
  }, [getCurrentInstallationId]);

  // Find current installation object
  const currentInstallation = currentInstallationId
    ? installations.find(
        (installation) => installation.id.toString() === currentInstallationId,
      ) || null
    : null;

  return {
    // Installation data
    installations,
    currentInstallationId,
    currentInstallation,

    // State management
    isLoading,
    error,

    // Actions
    refreshInstallations,
    refreshCurrentInstallation,
    switchInstallation,
  };
}
