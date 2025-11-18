/**
 * @file github/installation-banner.tsx
 * @description
 * GitHub App 설치 안내 배너 컴포넌트.
 * 사용자가 GitHub App을 설치하지 않은 경우, 온보딩 배너를 표시합니다.
 * 신규 사용자에게는 특별한 환영 메시지를 보여줍니다.
 */

"use client";

import { useGitHubAppProvider } from "@/providers/GitHubApp";
import { InstallationPrompt } from "./installation-prompt";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

/** localStorage 키: 설치 페이지를 봤는지 추적 */
const GITHUB_INSTALLATION_SEEN_KEY = "github_installation_seen";

/**
 * @component GitHubInstallationBanner
 * @description
 * GitHub App 설치를 유도하는 배너 컴포넌트.
 *
 * **동작 로직:**
 * 1. localStorage에서 설치 페이지 방문 기록 확인
 * 2. 첫 방문 사용자에게는 특별한 환영 메시지 표시
 * 3. 사용자가 배너를 dismiss할 수 있음
 *
 * **표시 조건:**
 * - 로딩 중이 아님
 * - App이 설치되지 않음
 * - 사용자가 dismiss하지 않음
 *
 * **신규 사용자 감지:**
 * - localStorage에 키가 없으면 신규 사용자로 간주
 * - 환영 메시지 + 강조된 스타일 (amber border)
 */
export function GitHubInstallationBanner() {
  const { isInstalled, isLoading } = useGitHubAppProvider();
  const [dismissed, setDismissed] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);

  useEffect(() => {
    // Check if this might be a new user (no installation history in localStorage)
    const hasSeenInstallation = localStorage.getItem(
      GITHUB_INSTALLATION_SEEN_KEY,
    );
    if (!hasSeenInstallation && !isInstalled && !isLoading) {
      setIsNewUser(true);
      localStorage.setItem(GITHUB_INSTALLATION_SEEN_KEY, "true");
    }
  }, [isInstalled, isLoading]);

  // Don't show banner if:
  // - Still loading installation status
  // - App is already installed
  // - User has dismissed the banner
  if (isLoading || isInstalled || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    setIsNewUser(false);
  };

  // Enhanced messaging for new users
  const title = isNewUser
    ? "🎉 Welcome to Open SWE! Complete your setup"
    : "Complete your setup to start coding";

  const description = isNewUser
    ? "You're just one step away from AI-powered development! Install our GitHub App to connect your repositories and start coding with AI assistance."
    : "Install our GitHub App to grant access to your repositories and enable AI-powered development.";

  return (
    <InstallationPrompt
      title={title}
      description={description}
      variant="banner"
      showDismiss={true}
      onDismiss={handleDismiss}
      className={cn(isNewUser && "border-2 border-amber-300 shadow-lg")}
    />
  );
}
