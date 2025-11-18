/**
 * @file gen-ui/initialize-step.tsx
 * @description
 * AI 에이전트의 환경 초기화 단계를 표시하는 컴포넌트.
 * Git 브랜치 생성, 의존성 확인 등의 초기화 과정을 단계별로 시각화합니다.
 */

"use client";

import {
  Loader2,
  CheckCircle,
  XCircle,
  GitBranch,
  ChevronDown,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Step } from "@openswe/shared/open-swe/custom-node-events";

/**
 * InitializeStep Props
 * @interface
 * @property {string} status - 초기화 상태 ("loading" | "generating" | "done")
 * @property {boolean} [success] - 초기화 성공 여부
 * @property {Step[]} [steps] - 초기화 단계 목록
 */
type InitializeStepProps = {
  status: "loading" | "generating" | "done";
  success?: boolean;
  steps?: Step[];
};

/**
 * @component InitializeStep
 * @description
 * 환경 초기화 프로세스를 단계별로 표시하는 컴포넌트.
 *
 * **3가지 상태:**
 * 1. **loading**: 준비 중
 *    - 회색 빈 원 아이콘
 *    - "Preparing environment..."
 *
 * 2. **generating**: 초기화 진행 중
 *    - Loader2 애니메이션
 *    - "Initializing environment..."
 *
 * 3. **done**: 초기화 완료
 *    - 성공: CheckCircle (녹색)
 *    - 실패: XCircle (빨간색)
 *    - "Environment ready" / "Initialization failed"
 *
 * **UI 구성:**
 * - 헤더:
 *   - GitBranch 아이콘
 *   - 상태 텍스트
 *   - 상태 아이콘
 *   - 펼치기/접기 버튼
 * - 본문 (접기/펼치기):
 *   - 단계별 목록 (skipped 제외)
 *   - 각 단계의 상태 아이콘 + 이름
 *   - 에러 메시지 (있을 경우)
 *
 * **상태 관리:**
 * - `collapsed`: 접힘/펼침 (기본: false)
 *
 * **Helper:**
 * - `stepStatusIcon`: 단계별 아이콘 매핑
 * - `getStatusIcon()`: 전체 상태 아이콘
 * - `getStatusText()`: 전체 상태 텍스트
 */
export function InitializeStep({
  status,
  success,
  steps,
}: InitializeStepProps) {
  const [collapsed, setCollapsed] = useState(false);

  const stepStatusIcon = {
    waiting: (
      <div
        className={cn(
          "h-3.5 w-3.5 rounded-full border border-gray-300 dark:border-gray-600",
        )}
      />
    ),
    generating: (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-500 dark:text-gray-400" />
    ),
    success: <CheckCircle className="h-3.5 w-3.5 text-green-500" />,
    error: <XCircle className="h-3.5 w-3.5 text-red-500" />,
  };

  const getStatusIcon = () => {
    switch (status) {
      case "loading":
        return (
          <div
            className={cn(
              "h-3.5 w-3.5 rounded-full border border-gray-300 dark:border-gray-600",
            )}
          />
        );
      case "generating":
        return (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-500 dark:text-gray-400" />
        );
      case "done":
        return success ? (
          <CheckCircle className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-500" />
        );
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "loading":
        return "Preparing environment...";
      case "generating":
        return "Initializing environment...";
      case "done":
        return success ? "Environment ready" : "Initialization failed";
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
      {/* Collapse/Expand Icon */}
      <div className="relative flex items-center border-b border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800">
        <GitBranch className="mr-2 h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
        <span className="flex-1 text-xs font-normal text-gray-800 dark:text-gray-200">
          {getStatusText()}
        </span>
        {getStatusIcon()}
        <button
          aria-label={collapsed ? "Expand" : "Collapse"}
          onClick={() => setCollapsed((c) => !c)}
          className="text-muted-foreground hover:text-foreground ml-2 cursor-pointer"
        >
          <ChevronDown
            className={cn(
              "size-4 transition-transform",
              collapsed ? "rotate-0" : "rotate-180",
            )}
          />
        </button>
      </div>
      {/* Only render the rest if not collapsed */}
      {!collapsed && steps && steps.length > 0 && (
        <div className="p-2">
          <ul className="space-y-2">
            {steps
              .filter((step) => step.status !== "skipped")
              .map((step, index) => (
                <li
                  key={index}
                  className="flex items-center text-xs"
                >
                  <span className="mr-2">
                    {stepStatusIcon[
                      step.status as keyof typeof stepStatusIcon
                    ] ?? (
                      <div
                        className={cn(
                          "h-3.5 w-3.5 rounded-full border border-gray-300 dark:border-gray-600",
                        )}
                      />
                    )}
                  </span>
                  <span
                    className={cn(
                      "font-normal",
                      step.status === "error"
                        ? "text-red-500"
                        : "text-gray-800 dark:text-gray-200",
                    )}
                  >
                    {step.name}
                  </span>
                  {step.error && (
                    <span className="ml-2 text-xs text-red-500">
                      ({step.error})
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
