/**
 * @file gen-ui/task-review.tsx
 * @description
 * 작업 완료/미완료 리뷰를 표시하는 2가지 컴포넌트.
 * - MarkTaskCompleted: 작업 완료 표시 (녹색 테마)
 * - MarkTaskIncomplete: 작업 미완료 표시 (빨간색 테마)
 */

"use client";

import { useState } from "react";
import {
  CheckCircle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  FileText,
} from "lucide-react";
import { BasicMarkdownText } from "../thread/markdown-text";
import { cn } from "@/lib/utils";

/**
 * MarkTaskCompleted Props
 * @interface
 * @property {string} status - 상태 ("loading" | "generating" | "done")
 * @property {string} [review] - 최종 리뷰 내용
 * @property {string} [reasoningText] - AI reasoning (파란색)
 * @property {string} [summaryText] - 요약 (녹색)
 */
type MarkTaskCompletedProps = {
  status: "loading" | "generating" | "done";
  review?: string;
  reasoningText?: string;
  summaryText?: string;
};

/**
 * @component MarkTaskCompleted
 * @description
 * 작업이 성공적으로 완료됨을 표시하는 컴포넌트 (녹색 테마).
 *
 * **3가지 상태:**
 * 1. loading: 준비 중 - "Preparing task review..."
 * 2. generating: 리뷰 중 - "Reviewing task completion..."
 * 3. done: 완료 - "Task marked as completed"
 *
 * **UI 구성:**
 * 1. Reasoning 섹션 (파란색, 선택적)
 * 2. 메인 헤더 (녹색):
 *    - CheckCircle 아이콘
 *    - 상태 텍스트
 *    - 펼치기/접기 버튼
 * 3. Final Review (녹색 박스, 선택적)
 * 4. Summary 섹션 (녹색, 선택적)
 *
 * **상태 관리:**
 * - `expanded`: 리뷰 펼침/접힘
 * - `showReasoning`: reasoning 표시
 * - `showSummary`: summary 표시
 */
export function MarkTaskCompleted({
  status,
  review,
  reasoningText,
  summaryText,
}: MarkTaskCompletedProps) {
  const [expanded, setExpanded] = useState(!!(status === "done" && review));
  const [showReasoning, setShowReasoning] = useState(true);
  const [showSummary, setShowSummary] = useState(true);

  const getStatusIcon = () => {
    switch (status) {
      case "loading":
        return (
          <div className="h-3.5 w-3.5 rounded-full border border-gray-300 dark:border-gray-800" />
        );
      case "generating":
        return (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-500 dark:text-gray-400" />
        );
      case "done":
        return (
          <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
        );
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "loading":
        return "Preparing task review...";
      case "generating":
        return "Reviewing task completion...";
      case "done":
        return "Task marked as completed";
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
      {reasoningText && (
        <div className="border-b border-blue-200 bg-blue-50 p-2 dark:border-blue-800/50 dark:bg-blue-950/20">
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="flex items-center gap-1 text-xs font-normal text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
          >
            <MessageSquare className="h-3 w-3" />
            {showReasoning ? "Hide reasoning" : "Show reasoning"}
          </button>
          {showReasoning && (
            <BasicMarkdownText className="mt-1 text-xs font-normal text-blue-800 dark:text-blue-200">
              {reasoningText}
            </BasicMarkdownText>
          )}
        </div>
      )}

      <div
        className={cn(
          "flex items-center border-b border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-900/50",
          status === "done" && review ? "cursor-pointer" : "",
        )}
        onClick={
          status === "done" && review
            ? () => setExpanded((prev) => !prev)
            : undefined
        }
      >
        <CheckCircle className="mr-2 h-3.5 w-3.5 text-green-600 dark:text-green-400" />
        <span className="flex-1 text-xs font-normal text-green-800 dark:text-green-400">
          {getStatusText()}
        </span>
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          {status === "done" && review && (
            <button className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300">
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {expanded && review && status === "done" && (
        <div className="border-t border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-900/50">
          <h3 className="mb-1 text-xs font-normal text-green-600 dark:text-green-400">
            Final Review
          </h3>
          <BasicMarkdownText className="text-xs font-normal text-green-800 dark:text-green-400">
            {review}
          </BasicMarkdownText>
        </div>
      )}

      {summaryText && status === "done" && (
        <div className="border-t border-green-100 bg-green-50 p-2 dark:border-green-800 dark:bg-green-900/50">
          <button
            onClick={() => setShowSummary(!showSummary)}
            className="flex items-center gap-1 text-xs font-normal text-green-700 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
          >
            <FileText className="h-3 w-3" />
            {showSummary ? "Hide summary" : "Show summary"}
          </button>
          {showSummary && (
            <BasicMarkdownText className="mt-1 text-xs text-green-800 dark:text-green-400">
              {summaryText}
            </BasicMarkdownText>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * MarkTaskIncomplete Props
 * @interface
 * @property {string} status - 상태 ("loading" | "generating" | "done")
 * @property {string} [review] - 최종 리뷰 내용
 * @property {string[]} [additionalActions] - 추가 조치 목록
 * @property {string} [reasoningText] - AI reasoning (파란색)
 * @property {string} [summaryText] - 요약 (빨간색)
 */
type MarkTaskIncompleteProps = {
  status: "loading" | "generating" | "done";
  review?: string;
  additionalActions?: string[];
  reasoningText?: string;
  summaryText?: string;
};

/**
 * @component MarkTaskIncomplete
 * @description
 * 작업이 아직 미완료 상태임을 표시하는 컴폭넌트 (빨간색 테마).
 *
 * **3가지 상태:**
 * 1. loading: 준비 중 - "Preparing task review..."
 * 2. generating: 리뷰 중 - "Reviewing task completion..."
 * 3. done: 완료 - "Task marked as incomplete"
 *
 * **UI 구성:**
 * 1. Reasoning 섹션 (파란색, 선택적)
 * 2. 메인 헤더 (빨간색):
 *    - XCircle 아이콘
 *    - 상태 텍스트
 *    - 펼치기/접기 버튼
 * 3. Final Review (빨간색 박스, 선택적)
 * 4. Additional Actions Required (번호부여 목록)
 * 5. Summary 섹션 (빨간색, 선택적)
 *
 * **상태 관리:**
 * - `expanded`: 리뷰 펼침/접힘
 * - `showReasoning`: reasoning 표시
 * - `showSummary`: summary 표시
 */
export function MarkTaskIncomplete({
  status,
  review,
  additionalActions,
  reasoningText,
  summaryText,
}: MarkTaskIncompleteProps) {
  const [expanded, setExpanded] = useState(
    !!(status === "done" && (review || additionalActions)),
  );
  const [showReasoning, setShowReasoning] = useState(true);
  const [showSummary, setShowSummary] = useState(true);

  const getStatusIcon = () => {
    switch (status) {
      case "loading":
        return (
          <div className="h-3.5 w-3.5 rounded-full border border-gray-300" />
        );
      case "generating":
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-500" />;
      case "done":
        return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "loading":
        return "Preparing task review...";
      case "generating":
        return "Reviewing task completion...";
      case "done":
        return "Task marked as incomplete";
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
      {reasoningText && (
        <div className="border-b border-blue-200 bg-blue-50 p-2 dark:border-blue-800/50 dark:bg-blue-950/20">
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="flex items-center gap-1 text-xs font-normal text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
          >
            <MessageSquare className="h-3 w-3" />
            {showReasoning ? "Hide reasoning" : "Show reasoning"}
          </button>
          {showReasoning && (
            <BasicMarkdownText className="mt-1 text-xs font-normal text-blue-800">
              {reasoningText}
            </BasicMarkdownText>
          )}
        </div>
      )}

      <div
        className={cn(
          "flex items-center border-b border-red-200 bg-red-50 p-2 dark:border-red-800 dark:bg-red-900/50",
          status === "done" && (review || additionalActions)
            ? "cursor-pointer"
            : "",
        )}
        onClick={
          status === "done" && (review || additionalActions)
            ? () => setExpanded((prev) => !prev)
            : undefined
        }
      >
        <XCircle className="mr-2 h-3.5 w-3.5 text-red-600 dark:text-red-400" />
        <span className="flex-1 text-xs font-normal text-red-800 dark:text-red-400">
          {getStatusText()}
        </span>
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          {status === "done" && (review || additionalActions) && (
            <button className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {expanded && status === "done" && (review || additionalActions) && (
        <div className="space-y-3 bg-red-50 p-2 dark:bg-red-900/50">
          {review && (
            <div>
              <h3 className="mb-1 text-xs font-normal text-red-600 dark:text-red-400">
                Final Review
              </h3>
              <BasicMarkdownText className="text-xs font-normal text-red-800 dark:text-red-400">
                {review}
              </BasicMarkdownText>
            </div>
          )}

          {additionalActions && additionalActions.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-normal text-red-600 dark:text-red-400">
                Additional Actions Required ({additionalActions.length})
              </h3>
              <ol className="space-y-1">
                {additionalActions.map((action, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2"
                  >
                    <div className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-red-200 dark:bg-red-800">
                      <span className="text-xs font-normal text-red-700 dark:text-red-400">
                        {index + 1}
                      </span>
                    </div>
                    <span className="flex-1 text-xs font-normal text-red-800 dark:text-red-400">
                      {action}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {summaryText && status === "done" && (
        <div className="border-t border-red-100 bg-red-50 p-2 dark:border-red-800 dark:bg-red-900/50">
          <button
            onClick={() => setShowSummary(!showSummary)}
            className="flex items-center gap-1 text-xs font-normal text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
          >
            <FileText className="h-3 w-3" />
            {showSummary ? "Hide summary" : "Show summary"}
          </button>
          {showSummary && (
            <BasicMarkdownText className="mt-1 text-xs text-red-800 dark:text-red-400">
              {summaryText}
            </BasicMarkdownText>
          )}
        </div>
      )}
    </div>
  );
}
