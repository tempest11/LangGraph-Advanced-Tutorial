/**
 * @file gen-ui/accepted-plan-step.tsx
 * @description
 * 사용자가 승인한 Plan을 표시하는 컴포넌트.
 * Plan 제목, 실행 단계 목록, 완료 여부를 시각화하며,
 * 에메랄드 테마로 승인 상태를 강조합니다.
 */

"use client";

import {
  CheckCircle,
  ChevronDown,
  Sparkles,
  Circle,
  Check,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { HumanResponse } from "@langchain/langgraph/prebuilt";
import { TaskPlan } from "@openswe/shared/open-swe/types";
import { getActivePlanItems } from "@openswe/shared/open-swe/tasks";
import { InlineMarkdownText } from "../thread/markdown-text";

/**
 * PlanItem 타입
 * @interface
 * @property {number} index - 단계 인덱스
 * @property {string} plan - 단계 설명
 * @property {boolean} completed - 완료 여부
 */
type PlanItem = {
  index: number;
  plan: string;
  completed: boolean;
};

/**
 * AcceptedPlanStep Props
 * @interface
 * @property {TaskPlan} [taskPlan] - 전체 작업 계획 (우선순위 높음)
 * @property {string} [planTitle] - Plan 개요 제목
 * @property {PlanItem[]} [planItems] - 단계 목록 (fallback)
 * @property {string} [interruptType] - 인터럽트 타입 ("edit" | "approve")
 * @property {boolean} [collapse] - 초기 접힘 상태 (기본: true)
 */
type AcceptedPlanStepProps = {
  taskPlan?: TaskPlan;
  planTitle?: string;
  planItems?: PlanItem[];
  interruptType?: HumanResponse["type"];
  collapse?: boolean;
};

/**
 * @component AcceptedPlanStep
 * @description
 * 승인된 Plan을 단계별로 시각화하는 컴포넌트.
 *
 * **UI 구성:**
 * 1. **헤더** (에메랄드 그라데이션):
 *    - Sparkles 아이콘 (에메랄드 원형 배경)
 *    - 상태 텍스트 ("Plan approved and ready" / "Plan revised and approved")
 *    - "Approved" 뱃지 (Check 아이콘)
 *    - 단계 수 ("N steps")
 *    - 펼치기/접기 버튼
 *
 * 2. **본문** (접기/펼치기):
 *    - **Plan Overview**: planTitle 표시 (회색 박스)
 *    - **Execution Steps**: 단계별 체크리스트
 *      - 완료: CheckCircle (에메랄드)
 *      - 미완료: Circle (회색)
 *      - Markdown 렌더링 지원
 *      - 단계 번호 뱃지
 *
 * **데이터 우선순위:**
 * - taskPlan이 있으면 getActivePlanItems() 사용
 * - 없으면 planItems 사용
 *
 * **상태 관리:**
 * - `collapsed`: 접힘/펼침 상태 (기본: true)
 *
 * **Helper 함수:**
 * - `getStatusText()`: interruptType에 따른 헤더 텍스트
 * - `getStatusBadge()`: "Approved" 뱃지 컴포넌트
 * - `getPlanItemIcon()`: 단계별 아이콘 (완료/미완료)
 *
 * **색상 테마:**
 * - 에메랄드 (emerald-50 ~ emerald-950)
 * - 완료 단계: 에메랄드 배경
 * - 미완료 단계: 회색 배경
 */
export function AcceptedPlanStep({
  taskPlan,
  planTitle,
  planItems = [],
  interruptType,
  collapse: collapseProp = true,
}: AcceptedPlanStepProps) {
  const [collapsed, setCollapsed] = useState(collapseProp);
  const activeTaskPlan = taskPlan ? getActivePlanItems(taskPlan) : planItems;

  const getStatusText = () => {
    if (interruptType === "edit") {
      return "Plan revised and approved";
    }
    return "Plan approved and ready";
  };

  const getStatusBadge = () => {
    return (
      <Badge
        variant="secondary"
        className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      >
        <Check className="h-3 w-3" />
        Approved
      </Badge>
    );
  };

  const getPlanItemIcon = (item: PlanItem) => {
    if (item.completed) {
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
          <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        </div>
      );
    }
    return (
      <div className="bg-muted flex h-6 w-6 items-center justify-center rounded-full">
        <Circle className="text-muted-foreground h-3.5 w-3.5" />
      </div>
    );
  };

  const totalCount = activeTaskPlan.length;

  return (
    <div
      className={cn(
        "group via-background to-background dark:via-background dark:to-background rounded-xl border bg-gradient-to-br from-emerald-50/50 transition-shadow dark:from-emerald-950/20",
        !collapsed ? "shadow-sm hover:shadow-md" : "",
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "relative flex items-center border-b bg-gradient-to-r from-emerald-50 to-emerald-50/50 p-4 backdrop-blur-sm dark:from-emerald-950/30 dark:to-emerald-950/10",
          !collapsed ? "rounded-t-xl rounded-b-none" : "rounded-xl",
        )}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 shadow-md dark:bg-emerald-600">
          <Sparkles className="h-4 w-4 text-white" />
        </div>

        <div className="ml-3 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-foreground text-sm font-semibold">
              {getStatusText()}
            </h3>
            {getStatusBadge()}
          </div>
          {totalCount > 0 && (
            <p className="text-muted-foreground mt-1 text-xs">
              {totalCount} step{totalCount === 1 ? "" : "s"}
            </p>
          )}
        </div>

        <Button
          aria-label={
            collapsed ? "Expand plan details" : "Collapse plan details"
          }
          onClick={() => setCollapsed((c) => !c)}
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform duration-200",
              collapsed ? "rotate-0" : "rotate-180",
            )}
          />
        </Button>
      </div>

      {/* Content */}
      <div
        className={cn(
          "transition-all duration-300 ease-in-out",
          collapsed ? "hidden" : "flex",
        )}
      >
        <div className="space-y-4 p-4">
          {planTitle && (
            <div className="bg-card/50 rounded-lg border p-3">
              <h4 className="text-foreground mb-1 text-sm font-medium">
                Plan Overview
              </h4>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {planTitle}
              </p>
            </div>
          )}

          {activeTaskPlan.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-foreground flex items-center gap-2 text-sm font-medium">
                Execution Steps
                <Badge
                  variant="outline"
                  className="text-xs"
                >
                  {totalCount}
                </Badge>
              </h4>

              <div className="space-y-3">
                {activeTaskPlan
                  .sort((a, b) => a.index - b.index)
                  .map((item, idx) => (
                    <div
                      key={item.index}
                      className={cn(
                        "group/item flex items-start gap-3 rounded-lg p-3 transition-colors duration-200",
                        item.completed
                          ? "bg-emerald-50/50 dark:bg-emerald-950/20"
                          : "bg-muted/30 hover:bg-muted/50",
                      )}
                    >
                      <div className="mt-0.5 flex-shrink-0">
                        {getPlanItemIcon(item)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <InlineMarkdownText
                            className={cn(
                              "text-sm leading-relaxed",
                              item.completed
                                ? "text-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {item.plan}
                          </InlineMarkdownText>
                          <Badge
                            variant="outline"
                            className={cn(
                              "flex-shrink-0 text-xs",
                              item.completed &&
                                "border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400",
                            )}
                          >
                            {idx + 1}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
