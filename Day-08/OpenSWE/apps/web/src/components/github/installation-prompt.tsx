/**
 * @file github/installation-prompt.tsx
 * @description
 * GitHub App 설치 프롬프트 UI 컴포넌트.
 * 2가지 variant (default, banner)를 제공하며, dismiss 기능을 선택적으로 포함할 수 있습니다.
 */

"use client";

import { InstallAppButton } from "./install-app-button";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * InstallationPrompt 컴포넌트 Props
 * @interface
 * @property {string} [title] - 프롬프트 제목 (기본값: "GitHub App Not Installed")
 * @property {string} [description] - 설명 텍스트
 * @property {boolean} [showDismiss] - dismiss 버튼 표시 여부
 * @property {Function} [onDismiss] - dismiss 버튼 클릭 핸들러
 * @property {string} [className] - 추가 CSS 클래스
 * @property {string} [variant] - UI 변형 (default: 수직 레이아웃, banner: 수평 레이아웃)
 */
interface InstallationPromptProps {
  title?: string;
  description?: string;
  showDismiss?: boolean;
  onDismiss?: () => void;
  className?: string;
  variant?: "default" | "banner";
}

/**
 * @component InstallationPrompt
 * @description
 * GitHub App 설치를 유도하는 프롬프트 컴포넌트.
 *
 * **2가지 Variant:**
 * 1. `default`: 수직 레이아웃 (제목, 설명, 버튼이 세로 배치)
 * 2. `banner`: 수평 레이아웃 (제목/설명과 버튼이 가로 배치)
 *
 * **사용 예시:**
 * ```tsx
 * // 기본 변형
 * <InstallationPrompt />
 *
 * // 배너 변형 (dismiss 기능 포함)
 * <InstallationPrompt
 *   variant="banner"
 *   showDismiss={true}
 *   onDismiss={() => console.log('Dismissed')}
 * />
 *
 * // 커스텀 메시지
 * <InstallationPrompt
 *   title="Welcome! 🎉"
 *   description="Install our app to get started"
 * />
 * ```
 */
export function InstallationPrompt({
  title = "GitHub App Not Installed",
  description = "You need to install our GitHub App to grant access to your repositories.",
  showDismiss = false,
  onDismiss,
  className = "",
  variant = "default",
}: InstallationPromptProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20",
        variant === "banner" && "flex items-center justify-between",
        className,
      )}
    >
      {variant === "banner" ? (
        <>
          <div>
            <h3 className="mb-1 font-medium text-amber-800 dark:text-amber-200">
              {title}
            </h3>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {description}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <InstallAppButton
              variant="default"
              size="sm"
              className="border-amber-600 bg-amber-600 text-white hover:bg-amber-700"
            >
              Install GitHub App
            </InstallAppButton>
            {showDismiss && onDismiss && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDismiss}
                className="h-8 w-8 p-0 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <h3 className="mb-2 font-medium text-amber-800 dark:text-amber-200">
            {title}
          </h3>
          <p className="mb-4 text-sm text-amber-700 dark:text-amber-300">
            {description}
          </p>
          <InstallAppButton>Install GitHub App</InstallAppButton>
        </>
      )}
    </div>
  );
}
