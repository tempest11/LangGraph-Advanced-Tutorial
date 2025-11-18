/**
 * @file gen-ui/conversation-summary.tsx
 * @description
 * 대화 히스토리 요약을 표시하는 컴포넌트.
 * Framer Motion을 사용한 부드러운 접기/펼치기 애니메이션과 Markdown 렌더링을 지원합니다.
 * ActionItem과 유사한 스타일로 UI 일관성을 유지합니다.
 */

import { FileText, ChevronDown, Check } from "lucide-react";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MarkdownText } from "../thread/markdown-text";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";

/**
 * @component ConversationHistorySummary
 * @description
 * 대화 히스토리 요약을 접기/펼치기 가능한 카드로 표시하는 컴포넌트.
 *
 * **UI 구성:**
 * - 헤더:
 *   - 회색 원형 아이콘: FileText
 *   - 제목: "Conversation Summary"
 *   - 뱃지: "Complete" (Check 아이콘)
 *   - 펼치기/접기 버튼: ChevronDown (90도 회전 애니메이션)
 * - 본문: Markdown 형식의 요약 내용
 *
 * **애니메이션:**
 * - Framer Motion의 AnimatePresence 사용
 * - 펼칠 때: height 0 → auto, opacity 0 → 1
 * - 접을 때: height auto → 0, opacity 1 → 0
 * - duration: 0.2초, easing: easeInOut
 *
 * **색상 테마:**
 * - 회색 계열 (gray-50, gray-500, gray-700)
 * - 다크모드 지원 (gray-900, gray-800)
 *
 * **상태 관리:**
 * - `expanded`: 펼침/접힘 상태 (기본값: true)
 * - 버튼 클릭 시 토글
 *
 * @param {string} summary - Markdown 형식의 대화 요약 텍스트
 *
 * @example
 * ```tsx
 * <ConversationHistorySummary
 *   summary="## Overview\n\nThis conversation covered..."
 * />
 * ```
 */
export function ConversationHistorySummary({ summary }: { summary: string }) {
  const [expanded, setExpanded] = useState(true);

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
          <FileText className="h-4 w-4 text-white" />
        </div>

        <div className="ml-3 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-foreground text-sm font-semibold">
              Conversation Summary
            </h3>
            <Badge
              variant="secondary"
              className="border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300"
            >
              <Check className="h-3 w-3" />
              Complete
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            Summary of the conversation history
          </p>
        </div>

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
      </div>

      {/* Content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="p-4">
              <div className="text-sm">
                <MarkdownText>{summary}</MarkdownText>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
