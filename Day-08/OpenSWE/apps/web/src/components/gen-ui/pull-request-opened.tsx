/**
 * @file gen-ui/pull-request-opened.tsx
 * @description
 * Pull Request 생성 상태를 표시하는 복잡한 UI 컴포넌트.
 * 3가지 상태(loading, generating, done)와 Draft/Open PR을 구분하여 표시하며,
 * Framer Motion 애니메이션으로 부드러운 expand/collapse를 제공합니다.
 */

"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  GitPullRequest,
  Loader2,
  ChevronDown,
  ExternalLink,
  GitPullRequestDraft,
  Clock,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";

/**
 * PullRequestOpened Props
 * @interface
 * @property {string} status - PR 생성 단계 ("loading" | "generating" | "done")
 * @property {string} [title] - PR 제목 (없으면 자동 생성)
 * @property {string} [description] - PR 설명 (펼치기/접기 가능)
 * @property {string} [url] - GitHub PR URL (외부 링크)
 * @property {number} [prNumber] - PR 번호 (#123)
 * @property {string} [branch] - 소스 브랜치명
 * @property {string} [targetBranch] - 타겟 브랜치명 (기본: "main")
 * @property {boolean} [isDraft] - Draft PR 여부
 */
type PullRequestOpenedProps = {
  status: "loading" | "generating" | "done";
  title?: string;
  description?: string;
  url?: string;
  prNumber?: number;
  branch?: string;
  targetBranch?: string;
  isDraft?: boolean;
};

/**
 * @component PullRequestOpened
 * @description
 * Pull Request 생성 프로세스를 시각화하는 상태 표시 컴포넌트.
 *
 * **3가지 상태:**
 * 1. **loading**: PR 생성 준비 중
 *    - 뱃지: "Preparing" (Clock 아이콘)
 *    - 서브타이틀: "Preparing to open pull request..."
 *
 * 2. **generating**: PR 생성 진행 중
 *    - 뱃지: "Opening" (Loader2 애니메이션)
 *    - 서브타이틀: "Opening pull request on GitHub..."
 *
 * 3. **done**: PR 생성 완료
 *    - Draft: "Draft" 뱃지 (슬레이트 색상)
 *    - Open: "Opened" 뱃지 (에메랄드 색상)
 *    - 서브타이틀: "branch → targetBranch"
 *
 * **UI 구성:**
 * - 헤더:
 *   - 회색 원형 아이콘 (GitPullRequest or GitPullRequestDraft)
 *   - 제목 (PR 제목 또는 자동 생성)
 *   - 상태 뱃지 (동적)
 *   - GitHub 링크 버튼 (done 상태에서만)
 *   - 펼치기/접기 버튼 (description 있을 때만)
 * - 본문 (접기/펼치기):
 *   - PR 설명 (pre-wrap으로 표시)
 *
 * **동적 텍스트 생성:**
 * - `getStatusBadge()`: 상태별 뱃지 컴포넌트
 * - `getStatusText()`: PR 번호 포함 제목
 * - `getSubtitleText()`: 상태별 설명 텍스트
 * - `shouldShowToggle()`: 펼치기 버튼 표시 조건
 *
 * **애니메이션:**
 * - Framer Motion의 AnimatePresence
 * - height: 0 ↔ auto, opacity: 0 ↔ 1
 * - duration: 0.2초, easing: easeInOut
 *
 * @param {PullRequestOpenedProps} props
 *
 * @example
 * ```tsx
 * <PullRequestOpened
 *   status="done"
 *   title="Fix: Update API endpoint"
 *   prNumber={42}
 *   branch="feature/api-update"
 *   targetBranch="main"
 *   url="https://github.com/owner/repo/pull/42"
 *   description="This PR updates the API endpoint..."
 * />
 * ```
 */
export function PullRequestOpened({
  status,
  title,
  description,
  url,
  prNumber,
  branch,
  targetBranch = "main",
  isDraft = false,
}: PullRequestOpenedProps) {
  const [expanded, setExpanded] = useState(false);

  const getStatusBadge = () => {
    switch (status) {
      case "loading":
        return (
          <Badge
            variant="secondary"
            className="border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300"
          >
            <Clock className="h-3 w-3" />
            Preparing
          </Badge>
        );
      case "generating":
        return (
          <Badge
            variant="secondary"
            className="border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            Opening
          </Badge>
        );
      case "done":
        if (isDraft) {
          return (
            <Badge
              variant="secondary"
              className="border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300"
            >
              <GitPullRequestDraft className="h-3 w-3" />
              Draft
            </Badge>
          );
        }
        return (
          <Badge
            variant="secondary"
            className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-800/50 dark:text-emerald-300"
          >
            <Check className="h-3 w-3" />
            Opened
          </Badge>
        );
    }
  };

  const getStatusText = () => {
    if (status === "done" && prNumber && !isDraft) {
      return `Pull request #${prNumber}`;
    }
    return isDraft
      ? `Draft pull request${prNumber ? ` #${prNumber}` : ""}`
      : `Pull request${prNumber ? ` #${prNumber}` : ""}`;
  };

  const getSubtitleText = () => {
    switch (status) {
      case "loading":
        return "Preparing to open pull request...";
      case "generating":
        return "Opening pull request on GitHub...";
      case "done":
        return branch ? `${branch} → ${targetBranch}` : "Successfully opened";
    }
  };

  const shouldShowToggle = () => {
    return status === "done" && description;
  };

  return (
    <div
      className={cn(
        "group via-background to-background dark:via-background dark:to-background rounded-xl border bg-gradient-to-br from-gray-50/50 transition-shadow dark:from-gray-900/20",
        "shadow-sm hover:shadow-md",
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "relative flex items-center bg-gradient-to-r from-gray-50 to-gray-50/50 p-4 backdrop-blur-sm dark:from-gray-900/20 dark:to-gray-900/10",
          "rounded-xl",
        )}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-500 shadow-md dark:bg-gray-600">
          {isDraft ? (
            <GitPullRequestDraft className="h-4 w-4 text-white" />
          ) : (
            <GitPullRequest className="h-4 w-4 text-white" />
          )}
        </div>

        <div className="ml-3 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-foreground text-sm font-semibold">
              {title || getStatusText()}
            </h3>
            {getStatusBadge()}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {getSubtitleText()}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {url && status === "done" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              asChild
            >
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title="Open pull request on GitHub"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          {shouldShowToggle() && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="h-8 px-2"
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  !expanded && "-rotate-90",
                )}
              />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence>
        {expanded && description && status === "done" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="border-t p-4">
              <div className="rounded-lg bg-gray-50/50 p-3 dark:bg-gray-800/30">
                <h4 className="text-muted-foreground mb-2 text-xs font-medium">
                  Description
                </h4>
                <pre className="text-foreground text-sm whitespace-pre-wrap">
                  {description}
                </pre>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
