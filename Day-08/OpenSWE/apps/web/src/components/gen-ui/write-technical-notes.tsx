/**
 * @file gen-ui/write-technical-notes.tsx
 * @description
 * AI가 작성하는 기술 노트를 표시하는 컴포넌트.
 * 2가지 상태(generating, done)를 처리하며,
 * 노트 내용과 reasoning을 선택적으로 표시합니다.
 */

"use client";

import { useState } from "react";
import {
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * WriteTechnicalNotes Props
 * @interface
 * @property {string} status - 상태 ("generating" | "done")
 * @property {string} [notes] - 작성된 기술 노트 (펼치기/접기 가능)
 * @property {string} [reasoningText] - AI reasoning (파란색 박스)
 */
type WriteTechnicalNotesProps = {
  status: "generating" | "done";
  notes?: string;
  reasoningText?: string;
};

/**
 * @component WriteTechnicalNotes
 * @description
 * 기술 노트 작성 프로세스를 시각화하는 컴포넌트.
 *
 * **2가지 상태:**
 * 1. **generating**: 노트 작성 중
 *    - Loader2 애니메이션 (회색)
 *    - "Writing technical notes..."
 *
 * 2. **done**: 작성 완료
 *    - CheckCircle (녹색)
 *    - "Technical notes written"
 *
 * **UI 구조:**
 * 1. **헤더** (회색):
 *    - FileText 아이콘
 *    - "Technical Notes" 레이블
 *    - 상태 텍스트
 *    - 상태 아이콘
 *    - ChevronUp/Down 토글 (notes 있을 때)
 *
 * 2. **확장 콘텐츠** (펼치기/접기):
 *    - 노트 내용 (pre-wrap, overflow-x-auto)
 *    - done 상태에서만 표시
 *
 * 3. **Reasoning Footer** (파란색, 선택적):
 *    - done 상태에서만 표시
 *    - reasoningText 내용
 *
 * **상태 관리:**
 * - `expanded`: 노트 펼침/접힘 (기본: false)
 *
 * **Helper 함수:**
 * - `getStatusIcon()`: 상태별 아이콘 반환
 * - `getStatusText()`: 상태별 텍스트 반환
 * - `shouldShowToggle()`: 토글 버튼 표시 조건 (done && notes)
 */
export function WriteTechnicalNotes({
  status,
  notes,
  reasoningText,
}: WriteTechnicalNotesProps) {
  const [expanded, setExpanded] = useState(false);

  const getStatusIcon = () => {
    switch (status) {
      case "generating":
        return (
          <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
        );
      case "done":
        return <CheckCircle className="size-3.5 text-green-500" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "generating":
        return "Writing technical notes...";
      case "done":
        return "Technical notes written";
    }
  };

  const shouldShowToggle = () => {
    return status === "done" && notes;
  };

  return (
    <div className="border-border overflow-hidden rounded-md border">
      <div className="border-border flex items-center border-b bg-gray-50 p-2 dark:bg-gray-800">
        <FileText className="text-muted-foreground mr-2 size-3.5" />
        <span className="text-foreground/80 flex-1 text-xs font-normal">
          Technical Notes
        </span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-normal">
            {getStatusText()}
          </span>
          {getStatusIcon()}
          {shouldShowToggle() && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {expanded && notes && status === "done" && (
        <div className="bg-muted overflow-x-auto p-2 dark:bg-gray-900">
          <pre className="text-foreground/90 text-xs font-normal whitespace-pre-wrap">
            {notes}
          </pre>
        </div>
      )}

      {reasoningText && status === "done" && (
        <div className="border-t border-blue-300 bg-blue-100/50 p-2 dark:border-blue-800 dark:bg-blue-900/50">
          <p className="text-xs font-normal text-blue-700 dark:text-blue-300">
            {reasoningText}
          </p>
        </div>
      )}
    </div>
  );
}
