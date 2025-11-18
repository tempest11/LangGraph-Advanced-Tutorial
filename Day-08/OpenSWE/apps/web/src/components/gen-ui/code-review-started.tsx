/**
 * @file gen-ui/code-review-started.tsx
 * @description
 * 코드 리뷰가 시작되었음을 알리는 상태 표시 컴포넌트.
 * 파란색 테마로 "In progress" 뱃지와 함께 코드 품질 분석 중임을 표시합니다.
 */

"use client";

import { FileSearch } from "lucide-react";
import { Badge } from "../ui/badge";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * CodeReviewStarted Props
 * @interface
 * @property {string} [status] - 리뷰 상태 ("generating" | "done") - 현재는 UI에 미반영
 */
type CodeReviewStartedProps = {
  status?: "generating" | "done";
};

/**
 * @component CodeReviewStarted
 * @description
 * 코드 리뷰 시작을 알리는 상태 카드 컴포넌트.
 *
 * **UI 구성:**
 * - 파란색 원형 아이콘: FileSearch (코드 검토)
 * - 제목: "Code review"
 * - 뱃지: "In progress" (Clock 아이콘)
 * - 설명: "Analyzing code quality"
 *
 * **색상 테마:**
 * - 파란색 계열 (blue-50, blue-500, blue-700)
 * - 다크모드 지원 (blue-600, blue-900)
 *
 * **사용 시점:**
 * - AI 에이전트가 코드 리뷰를 시작할 때
 * - Pull Request 생성 전 코드 품질 분석 단계
 *
 * @param {CodeReviewStartedProps} props
 *
 * @example
 * ```tsx
 * <CodeReviewStarted status="generating" />
 * ```
 */
export function CodeReviewStarted({ status = "done" }: CodeReviewStartedProps) {
  return (
    <div
      className={cn(
        "dark:border-muted-foreground/20 dark:bg-muted/30 rounded-lg border border-blue-200/60 bg-blue-50/30 shadow-sm transition-shadow",
        "shadow-sm hover:shadow-md",
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "dark:bg-muted/40 relative flex items-center bg-blue-50/50 p-3",
          "rounded-lg",
        )}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/90 dark:bg-blue-600">
          <FileSearch className="h-3.5 w-3.5 text-white" />
        </div>

        <div className="ml-3 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-foreground text-sm font-medium">Code review</h3>
            <Badge
              variant="secondary"
              className="border-blue-200/60 bg-blue-100/80 text-blue-700 dark:border-blue-700/40 dark:bg-blue-900/50 dark:text-blue-300"
            >
              <Clock className="h-3 w-3" />
              In progress
            </Badge>
          </div>
          <p className="text-muted-foreground/80 mt-1 text-xs">
            Analyzing code quality
          </p>
        </div>
      </div>
    </div>
  );
}
