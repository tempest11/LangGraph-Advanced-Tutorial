/**
 * @file github/install-app-button.tsx
 * @description
 * GitHub App 설치 버튼 컴포넌트.
 * 사용자를 GitHub OAuth 페이지로 리다이렉트하여 저장소 접근 권한을 부여합니다.
 * 클릭 시 `/api/github/installation` 엔드포인트로 이동하며, 로딩 상태를 표시합니다.
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { GitHubSVG } from "@/components/icons/github";

/**
 * InstallAppButton 컴포넌트 Props
 * @interface
 * @property {string} [variant] - 버튼 스타일 (default, outline, secondary, ghost, link, destructive)
 * @property {string} [size] - 버튼 크기 (default, sm, lg, icon)
 * @property {string} [className] - 추가 CSS 클래스
 * @property {React.ReactNode} [children] - 버튼 내부 컨텐츠 (기본값: "Install GitHub App")
 */
interface InstallAppButtonProps {
  variant?:
    | "default"
    | "outline"
    | "secondary"
    | "ghost"
    | "link"
    | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  children?: React.ReactNode;
}

/**
 * @component InstallAppButton
 * @description
 * GitHub App 설치를 시작하는 버튼 컴포넌트.
 *
 * **동작 흐름:**
 * 1. 사용자가 버튼 클릭
 * 2. 로딩 상태로 전환 ("Installing..." 표시)
 * 3. `/api/github/installation` 로 리다이렉트
 * 4. GitHub OAuth 페이지에서 저장소 선택
 * 5. 설치 완료 후 애플리케이션으로 돌아오기
 *
 * @param {InstallAppButtonProps} props - 컴포넌트 Props
 *
 * @example
 * ```tsx
 * // 기본 사용
 * <InstallAppButton />
 *
 * // 커스텀 스타일
 * <InstallAppButton variant="outline" size="sm">
 *   Connect Repository
 * </InstallAppButton>
 * ```
 */
export function InstallAppButton({
  variant = "default",
  size = "default",
  className = "",
  children,
}: InstallAppButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleInstall = () => {
    setIsLoading(true);
    window.location.href = "/api/github/installation";
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleInstall}
      disabled={isLoading}
    >
      {isLoading ? (
        "Installing..."
      ) : (
        <>
          <GitHubSVG
            width="16"
            height="16"
          />
          {children || "Install GitHub App"}
        </>
      )}
    </Button>
  );
}
