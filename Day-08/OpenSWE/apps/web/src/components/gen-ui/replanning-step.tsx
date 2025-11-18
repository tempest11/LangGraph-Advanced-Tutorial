/**
 * @file gen-ui/replanning-step.tsx
 * @description
 * AI 에이전트가 작업 계획을 재수립하는 과정을 표시하는 컴포넌트.
 * Reasoning과 Summary를 토글 가능하게 표시합니다.
 */

"use client";

import "../app/globals.css";
import {
  RefreshCw,
  Loader2,
  CheckCircle,
  MessageSquare,
  FileText,
} from "lucide-react";
import { useState } from "react";
import { BasicMarkdownText } from "../thread/markdown-text";

/**
 * ReplanningStep Props
 * @interface
 * @property {string} status - 상태 ("loading" | "generating" | "done")
 * @property {string} [reasoningText] - AI reasoning (파란색 박스)
 * @property {string} [summaryText] - 요약 텍스트 (녹색 박스)
 */
type ReplanningStepProps = {
  status: "loading" | "generating" | "done";
  reasoningText?: string;
  summaryText?: string;
};

/**
 * @component ReplanningStep
 * @description
 * 계획 재수립 프로세스를 표시하는 컴포넌트.
 *
 * **3가지 상태:**
 * 1. **loading**: 준비 중
 *    - 회색 빈 원
 *    - "Preparing to update plan..."
 *
 * 2. **generating**: 재수립 진행 중
 *    - Loader2 애니메이션
 *    - "Updating plan..."
 *
 * 3. **done**: 재수립 완료
 *    - CheckCircle (녹색)
 *    - "Plan updated"
 *
 * **UI 구성:**
 * 1. **Reasoning 섹션** (파란색, 선택적):
 *    - MessageSquare 아이콘
 *    - "Show/Hide reasoning" 토글
 *    - Markdown 렌더링
 *
 * 2. **메인 헤더** (회색):
 *    - RefreshCw 아이콘 (파란색)
 *    - 상태 텍스트
 *    - 상태 아이콘
 *
 * 3. **Summary 섹션** (녹색, 선택적):
 *    - FileText 아이콘
 *    - "Show/Hide summary" 토글
 *    - done 상태에서만 표시
 *
 * **상태 관리:**
 * - `showReasoning`: reasoning 표시 여부 (기본: true)
 * - `showSummary`: summary 표시 여부 (기본: true)
 *
 * **Helper:**
 * - `getStatusIcon()`: 상태별 아이콘
 * - `getStatusText()`: 상태별 텍스트
 */
export function ReplanningStep({
  status,
  reasoningText,
  summaryText,
}: ReplanningStepProps) {
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
        return (
          <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
        );
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "loading":
        return "Preparing to update plan...";
      case "generating":
        return "Updating plan...";
      case "done":
        return "Plan updated";
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-gray-200">
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

      <div className="flex items-center bg-gray-50 p-2">
        <RefreshCw className="mr-2 h-3.5 w-3.5 text-blue-500" />
        <span className="flex-1 text-xs font-normal text-gray-800">
          {getStatusText()}
        </span>
        {getStatusIcon()}
      </div>

      {summaryText && status === "done" && (
        <div className="border-t border-green-100 bg-green-50 p-2">
          <button
            onClick={() => setShowSummary(!showSummary)}
            className="flex items-center gap-1 text-xs font-normal text-green-700 hover:text-green-800"
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
