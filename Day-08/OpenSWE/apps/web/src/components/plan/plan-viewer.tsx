/**
 * @file plan/plan-viewer.tsx
 * @description
 * AI 에이전트의 실행 계획을 시각화하고 관리하는 컴포넌트.
 * Proposed Plan(제안 단계)과 Execution Plan(실행 단계)을 구분하여 표시하며,
 * 편집, 추가, 삭제 기능을 제공합니다.
 */

import { Check, Clock, Pencil, Play, Trash } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlanItem } from "@openswe/shared/open-swe/types";
import { TooltipIconButton } from "../ui/tooltip-icon-button";
import { Dispatch, SetStateAction, useState } from "react";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { MarkdownText } from "../thread/markdown-text";

/**
 * PlanViewer Props
 * @interface
 * @property {PlanItem[]} planItems - 플랜 아이템 목록
 * @property {string} [className] - 추가 CSS 클래스
 * @property {boolean} [isProposedPlan] - Proposed Plan 여부 (true: 편집 가능, false: 실행 중)
 * @property {Function} [setPlanItems] - 플랜 아이템 업데이트 함수 (Proposed Plan에서만 사용)
 */
interface PlanViewerProps {
  planItems: PlanItem[];
  className?: string;
  isProposedPlan?: boolean;
  setPlanItems?: Dispatch<SetStateAction<PlanItem[]>>;
}

/**
 * @component PlanViewer
 * @description
 * AI 에이전트의 실행 계획을 단계별로 표시하는 컴포넌트.
 *
 * **2가지 모드:**
 * 1. **Proposed Plan (isProposedPlan=true)**:
 *    - 사용자가 승인하기 전 단계
 *    - 각 플랜 아이템 편집/삭제 가능
 *    - 새 플랜 아이템 추가 가능
 *    - 모든 아이템이 "Proposed" 상태
 *
 * 2. **Execution Plan (isProposedPlan=false)**:
 *    - 실행 중인 단계
 *    - 읽기 전용 (편집 불가)
 *    - 진행률 표시 ("X of Y completed")
 *    - 3가지 상태 표시: completed, current, remaining
 *
 * **플랜 아이템 상태:**
 * - **completed**: 완료된 단계 (녹색, Check 아이콘, "Done" 뱃지)
 * - **current**: 현재 진행 중 (파란색, Play 아이콘, "In Progress" 뱃지)
 * - **remaining**: 대기 중 (회색, Clock 아이콘)
 * - **proposed**: 제안 단계 (회색, Clock 아이콘, "Proposed" 뱃지)
 *
 * **현재 작업 결정 로직:**
 * ```typescript
 * currentTaskIndex = planItems
 *   .filter(item => !item.completed)  // 미완료 항목 중
 *   .reduce((min, item) =>
 *     item.index < min ? item.index : min, Infinity)  // 가장 작은 index
 * ```
 *
 * **Proposed Plan 기능:**
 * - ✏️ 편집: Textarea로 전환하여 플랜 내용 수정
 * - 🗑️ 삭제: 플랜 아이템 삭제 후 index 재정렬
 * - ➕ 추가: 하단 입력창에서 새 플랜 추가
 *
 * **완료된 작업 Summary:**
 * - completed 상태 아이템에 녹색 박스로 Summary 표시
 * - Markdown 형식으로 렌더링
 *
 * **UI 색상 체계:**
 * - 녹색 (completed): border-green-300, bg-green-100/30
 * - 파란색 (current): border-blue-300, bg-blue-100/30
 * - 회색 (remaining/proposed): border-border, bg-card
 */
export function PlanViewer({
  planItems,
  className,
  isProposedPlan,
  setPlanItems,
}: PlanViewerProps) {
  const [isEditing, setIsEditing] = useState<Record<number, boolean>>({});
  const [newPlanItem, setNewPlanItem] = useState("");
  const currentTaskIndex = planItems
    .filter((item) => !item.completed)
    .reduce(
      (minIndex, item) => (item.index < minIndex ? item.index : minIndex),
      Infinity,
    );

  const getTaskStatus = (item: PlanItem) => {
    if (isProposedPlan) return "proposed";
    if (item.completed) return "completed";
    if (item.index === currentTaskIndex) return "current";
    return "remaining";
  };

  return (
    <div className={cn("w-full space-y-3", className)}>
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-foreground text-sm font-medium">
          {isProposedPlan ? "Proposed" : "Execution"} Plan
        </h3>
        {!isProposedPlan && (
          <span className="text-muted-foreground text-xs">
            {planItems.filter((item) => item.completed).length} of{" "}
            {planItems.length} completed
          </span>
        )}
      </div>

      <div className="space-y-2">
        {planItems
          .sort((a, b) => a.index - b.index)
          .map((item) => {
            const status = getTaskStatus(item);

            return (
              <div
                key={`plan-item-${item.index}`}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                  {
                    "border-green-300 bg-green-100/30 dark:border-green-800 dark:bg-green-900/30":
                      status === "completed",
                    "border-blue-300 bg-blue-100/30 dark:border-blue-800 dark:bg-blue-900/30":
                      status === "current",
                    "border-border bg-card": ["remaining", "proposed"].includes(
                      status,
                    ),
                  },
                )}
              >
                {/* Status Icon */}
                <div className="mt-0.5 flex-shrink-0">
                  {status === "completed" && (
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                  )}
                  {status === "current" && (
                    <Play className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  )}
                  {["remaining", "proposed"].includes(status) && (
                    <Clock className="text-muted-foreground h-4 w-4" />
                  )}
                </div>

                {/* Task Content */}
                <div className="min-w-0 flex-1">
                  <div className="text-muted-foreground mb-1 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">
                        Step {item.index + 1}
                      </span>
                      {status === "current" && (
                        <span className="rounded-full bg-blue-100/50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                          In Progress
                        </span>
                      )}
                      {status === "completed" && (
                        <span className="rounded-full bg-green-100/50 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/50 dark:text-green-300">
                          Done
                        </span>
                      )}
                      {status === "proposed" && (
                        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                          Proposed
                        </span>
                      )}
                    </div>
                    {isProposedPlan && (
                      <div className="flex items-center gap-2">
                        <TooltipIconButton
                          onClick={() =>
                            setIsEditing((p) => ({
                              ...p,
                              [item.index]: !p[item.index],
                            }))
                          }
                          tooltip={
                            isEditing[item.index] ? `Save Plan` : `Edit Plan`
                          }
                        >
                          {isEditing[item.index] ? (
                            <Check className="size-4" />
                          ) : (
                            <Pencil className="size-4" />
                          )}
                        </TooltipIconButton>
                        <TooltipIconButton
                          onClick={() =>
                            setPlanItems?.((prev) => {
                              const newArr = prev.filter(
                                (i) => i.index !== item.index,
                              );
                              return newArr.map((i, index) => ({
                                ...i,
                                index,
                              }));
                            })
                          }
                          tooltip="Delete Plan"
                          className="transition-colors hover:text-red-500"
                        >
                          <Trash className="size-4" />
                        </TooltipIconButton>
                      </div>
                    )}
                  </div>

                  {isEditing[item.index] ? (
                    <Textarea
                      value={planItems[item.index].plan}
                      onChange={(e) => {
                        setPlanItems?.((prev) => {
                          return prev.map((i) => {
                            if (i.index === item.index) {
                              return {
                                ...i,
                                plan: e.target.value,
                              };
                            }
                            return i;
                          });
                        });
                      }}
                      className="text-foreground"
                    />
                  ) : (
                    <MarkdownText
                      className={cn("text-sm leading-relaxed", {
                        "text-foreground": status === "current",
                        "text-foreground/80":
                          status === "completed" ||
                          ["remaining", "proposed"].includes(status),
                      })}
                    >
                      {planItems[item.index].plan}
                    </MarkdownText>
                  )}

                  {/* Summary for completed tasks */}
                  {item.summary && status === "completed" && (
                    <div className="mt-2 rounded border border-green-300 bg-green-100/30 p-2 dark:border-green-800 dark:bg-green-900/30">
                      <p className="mb-1 text-xs font-medium text-green-700 dark:text-green-300">
                        Summary:
                      </p>
                      <MarkdownText className="text-xs text-green-600 dark:text-green-400">
                        {item.summary}
                      </MarkdownText>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        {isProposedPlan && (
          <div
            key="add-new-plan-item"
            className="border-border bg-card/50 hover:bg-card flex items-start gap-4 rounded-lg border border-dashed p-4 transition-colors"
          >
            <Textarea
              placeholder="Add new plan item"
              value={newPlanItem}
              onChange={(e) => setNewPlanItem(e.target.value)}
              className="text-foreground placeholder:text-muted-foreground"
            />
            <Button
              onClick={() => {
                setPlanItems?.((prev) => [
                  ...prev,
                  {
                    index: prev.length,
                    plan: newPlanItem,
                    completed: false,
                    summary: undefined,
                  },
                ]);
                setNewPlanItem("");
              }}
              disabled={!newPlanItem.trim()}
              className="mt-auto"
              variant="default"
            >
              Add
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
