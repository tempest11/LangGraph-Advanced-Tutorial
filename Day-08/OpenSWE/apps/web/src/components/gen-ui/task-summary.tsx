/**
 * @file gen-ui/task-summary.tsx
 * @description
 * 작업 요약을 표시하는 컴포넌트.
 * 작업 완료 여부에 따라 녹색/호박색 테마로 구분하여 표시합니다.
 */

"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, Loader2, ChevronDown, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { BasicMarkdownText } from "../thread/markdown-text";

/**
 * TaskSummary Props
 * @interface
 * @property {string} status - 상태 ("loading" | "generating" | "done")
 * @property {boolean} [completed] - 작업 완료 여부
 * @property {string} [summaryText] - 요약 텍스트 (Markdown)
 */
type TaskSummaryProps = {
  status: "loading" | "generating" | "done";
  completed?: boolean;
  summaryText?: string;
};

/**
 * @component TaskSummary
 * @description
 * 작업 요약을 표시하는 컴포넌트.
 *
 * **3가지 상태:**
 * 1. **loading**: 준비 중
 *    - 회색 빈 원
 *    - "Preparing action reflection..."
 *
 * 2. **generating**: 요약 생성 중
 *    - Loader2 애니메이션
 *    - "Generating action reflection..."
 *
 * 3. **done**: 요약 완료
 *    - completed=true: CheckCircle (녹색) - "Task completed"
 *    - completed=false: MinusCircle (호박색) - "Task not completed"
 *
 * **UI 구성:**
 * 1. **헤더**:
 *    - 상태 아이콘
 *    - 상태 텍스트
 *    - 클릭 가능 (done && summaryText)
 *
 * 2. **Reflection 섹션** (선택적):
 *    - 왕졸 4px 선 (completed 여부에 따라 색상)
 *    - "Show/Hide reflection" 토글
 *    - Markdown 렌더링
 *    - Framer Motion 애니메이션
 *
 * **색상 테마:**
 * - completed=true: 녹색 (green-50 ~ green-950)
 * - completed=false: 호박색 (amber-50 ~ amber-900)
 *
 * **상태 관리:**
 * - `expanded`: 확장 여부 (기본: false)
 * - `showSummary`: reflection 표시 여부 (기본: true)
 *
 * **Helper:**
 * - `getStatusIcon()`: 상태별 아이콘
 * - `getStatusText()`: 상태별 텍스트
 */
export function TaskSummary({
  status,
  completed,
  summaryText,
}: TaskSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  const [showSummary, setShowSummary] = useState(true);

  const getStatusIcon = () => {
    switch (status) {
      case "loading":
        return <div className="border-border size-3.5 rounded-full border" />;
      case "generating":
        return (
          <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
        );
      case "done":
        if (completed === false) {
          return (
            <MinusCircle className="size-3.5 text-amber-500 dark:text-amber-400" />
          );
        }
        return (
          <CheckCircle className="size-3.5 text-green-600 dark:text-green-400" />
        );
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "loading":
        return "Preparing action reflection...";
      case "generating":
        return "Generating action reflection...";
      case "done":
        if (completed === false) {
          return "Task not completed";
        }
        return "Task completed";
    }
  };

  return (
    <div className="border-border overflow-hidden rounded-md border">
      <div
        className={"bg-muted/50 flex items-center border-b p-2"}
        onClick={
          status === "done" && summaryText
            ? () => setExpanded(!expanded)
            : undefined
        }
      >
        {getStatusIcon()}
        <span className="text-foreground/80 ml-2 flex-1 text-xs font-normal">
          {getStatusText()}
        </span>
      </div>

      {summaryText && (
        <div
          className={cn(
            "border-t border-l-4 p-2",
            completed === false
              ? "border-amber-300 border-l-amber-500 bg-amber-100/50 dark:border-amber-700/50 dark:border-l-amber-400/70 dark:bg-amber-900/30"
              : "border-green-200/80 border-l-green-500/80 bg-green-50/60 dark:border-green-800/30 dark:border-l-green-400/70 dark:bg-green-950/10",
          )}
        >
          <button
            onClick={() => setShowSummary(!showSummary)}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 text-xs font-medium transition-colors duration-200",
              completed === false
                ? "text-amber-600 hover:text-amber-700 dark:text-amber-400/90 dark:hover:text-amber-300"
                : "text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300",
            )}
          >
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform duration-200",
                showSummary && "rotate-180",
              )}
            />
            <span>{showSummary ? "Hide reflection" : "Show reflection"}</span>
          </button>
          <AnimatePresence>
            {showSummary && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div
                  className={cn(
                    "mt-3 rounded-md px-3 py-2",
                    completed === false
                      ? "bg-amber-50/50 dark:bg-amber-900/20"
                      : "bg-green-50/50 dark:bg-green-900/20",
                  )}
                >
                  <BasicMarkdownText
                    className={cn(
                      "text-xs leading-relaxed",
                      completed === false
                        ? "text-amber-700 dark:text-amber-300/90"
                        : "text-green-700 dark:text-green-300",
                    )}
                  >
                    {summaryText}
                  </BasicMarkdownText>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
