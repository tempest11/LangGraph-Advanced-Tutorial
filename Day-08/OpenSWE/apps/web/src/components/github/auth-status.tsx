/**
 * @file github/auth-status.tsx
 * @description
 * GitHub 인증 상태 관리 및 온보딩 플로우 컴포넌트.
 * 사용자의 GitHub 로그인 및 GitHub App 설치 상태를 확인하여,
 * 3단계 온보딩 플로우를 제공합니다.
 *
 * **온보딩 3단계:**
 * 1. GitHub 로그인 (Get Started)
 * 2. GitHub App 설치 (One More Step)
 * 3. 토큰 확보 후 채팅 페이지로 이동
 */

"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { GitHubSVG } from "@/components/icons/github";
import { ArrowRight } from "lucide-react";
import { LangGraphLogoSVG } from "../icons/langgraph";
import { useGitHubToken } from "@/hooks/useGitHubToken";
import { useGitHubAppProvider } from "@/providers/GitHubApp";
import { GitHubAppProvider } from "@/providers/GitHubApp";
import { useRouter } from "next/navigation";

/**
 * @component AuthStatusContent
 * @description
 * GitHub 인증 상태를 관리하는 내부 컴포넌트.
 *
 * **상태 관리 로직:**
 * 1. 인증 상태 확인 (`/api/auth/status`)
 * 2. GitHub App 설치 여부 확인
 * 3. GitHub 토큰 확보 여부 확인
 * 4. 상태에 따라 3가지 UI 중 하나 표시
 *
 * **표시 조건:**
 * - `showGetStarted`: 미인증 상태 → GitHub 로그인 버튼
 * - `showInstallApp`: 인증됨, App 미설치 → GitHub App 설치 버튼
 * - `showLoading`: 인증됨, App 설치됨, 토큰 확보 중 → 로딩 화면
 * - 모두 완료 → `/chat` 으로 자동 리다이렉트
 */
function AuthStatusContent() {
  const router = useRouter();
  const [isAuth, setIsAuth] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    token: githubToken,
    fetchToken: fetchGitHubToken,
    isLoading: isTokenLoading,
  } = useGitHubToken();

  const {
    isInstalled: hasGitHubAppInstalled,
    isLoading: isCheckingAppInstallation,
  } = useGitHubAppProvider();

  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    if (isAuth && hasGitHubAppInstalled && !githubToken && !isTokenLoading) {
      // Fetch token when app is installed but we don't have a token yet
      fetchGitHubToken();
    }
  }, [
    isAuth,
    hasGitHubAppInstalled,
    githubToken,
    isTokenLoading,
    fetchGitHubToken,
  ]);

  useEffect(() => {
    if (githubToken) {
      console.log("redirecting to chat");
      router.push("/chat");
    }
  }, [githubToken]);

  const checkAuthStatus = async () => {
    try {
      const response = await fetch("/api/auth/status");
      const data = await response.json();
      setIsAuth(data.authenticated);
    } catch (error) {
      console.error("Error checking auth status:", error);
      setIsAuth(false);
    }
  };

  const handleLogin = () => {
    setIsLoading(true);
    window.location.href = "/api/auth/github/login";
  };

  const handleInstallGitHubApp = () => {
    setIsLoading(true);
    window.location.href = "/api/github/installation";
  };

  const showGetStarted = !isAuth;
  const showInstallApp =
    !showGetStarted && !hasGitHubAppInstalled && !isTokenLoading;
  const showLoading = !showGetStarted && !showInstallApp && !githubToken;

  useEffect(() => {
    if (!showGetStarted && !showInstallApp && !showLoading) {
      router.push("/chat");
    }
  }, [showGetStarted, showInstallApp, showLoading, router]);

  if (showGetStarted) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center p-4">
        <div className="animate-in fade-in-0 zoom-in-95 flex w-full max-w-3xl flex-col rounded-lg border shadow-lg">
          <div className="flex flex-col gap-4 border-b p-6">
            <div className="flex flex-col items-start gap-2">
              <LangGraphLogoSVG className="h-7" />
              <h1 className="text-xl font-semibold tracking-tight">
                Get started
              </h1>
            </div>
            <p className="text-muted-foreground">
              Connect your GitHub account to get started with Open SWE.
            </p>
            <Button
              onClick={handleLogin}
              disabled={isLoading}
            >
              <GitHubSVG
                width="16"
                height="16"
              />
              {isLoading ? "Connecting..." : "Connect GitHub"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (showInstallApp) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center p-4">
        <div className="animate-in fade-in-0 zoom-in-95 flex w-full max-w-3xl flex-col rounded-lg border shadow-lg">
          <div className="flex flex-col gap-4 border-b p-6">
            <div className="flex flex-col items-start gap-2">
              <LangGraphLogoSVG className="h-7" />
              <h1 className="text-xl font-semibold tracking-tight">
                One more step
              </h1>
            </div>
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                1. GitHub Login ✓
              </span>
              <ArrowRight className="h-3 w-3" />
              <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">
                2. Repository Access
              </span>
            </div>
            <p className="text-muted-foreground">
              Great! Now we need access to your GitHub repositories. Install our
              GitHub App to grant access to specific repositories.
            </p>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p>
                You'll be redirected to GitHub where you can select which
                repositories to grant access to.
              </p>
            </div>
            <Button
              onClick={handleInstallGitHubApp}
              disabled={isLoading || isCheckingAppInstallation}
              className="bg-black hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-200"
            >
              <GitHubSVG
                width="16"
                height="16"
              />
              {isLoading || isCheckingAppInstallation
                ? "Loading..."
                : "Install GitHub App"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (showLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center p-4">
        <div className="animate-in fade-in-0 zoom-in-95 flex w-full max-w-3xl flex-col rounded-lg border shadow-lg">
          <div className="flex flex-col gap-4 border-b p-6">
            <div className="flex flex-col items-start gap-2">
              <LangGraphLogoSVG className="h-7" />
              <h1 className="text-xl font-semibold tracking-tight">
                Loading...
              </h1>
            </div>
            <p className="text-muted-foreground">
              Setting up your GitHub integration...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default function AuthStatus() {
  return (
    <GitHubAppProvider>
      <AuthStatusContent />
    </GitHubAppProvider>
  );
}
