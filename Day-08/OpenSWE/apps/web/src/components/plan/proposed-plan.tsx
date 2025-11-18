/**
 * @file plan/proposed-plan.tsx
 * @description
 * AI 에이전트가 제안한 플랜을 표시하고 사용자 승인/거부를 처리하는 컴포넌트.
 * PlanViewer를 래핑하여 편집 가능한 UI와 Reject/Continue 버튼을 제공합니다.
 * 사용자가 플랜을 수정한 경우 "Submit changes" 버튼으로 변경됩니다.
 */

import { PlanViewer } from "./plan-viewer";
import { useProposedPlan } from "../thread/agent-inbox/hooks/useProposedPlan";
import { PlanItem } from "@openswe/shared/open-swe/types";
import { useStream } from "@langchain/langgraph-sdk/react";
import { X, ArrowRight } from "lucide-react";

/**
 * @component ProposedPlan
 * @description
 * 제안된 플랜을 표시하고 사용자 상호작용을 처리하는 컴포넌트.
 *
 * **주요 기능:**
 * 1. **플랜 표시**: PlanViewer로 편집 가능한 플랜 표시
 * 2. **플랜 수정**: 사용자가 각 단계를 편집/추가/삭제 가능
 * 3. **승인/거부**: Reject 또는 Continue 버튼으로 응답
 *
 * **2가지 버튼 상태:**
 * - **Continue**: 플랜을 수정하지 않고 그대로 승인
 * - **Submit changes**: 플랜을 수정한 경우 변경사항과 함께 제출
 *
 * **동작 흐름:**
 * 1. AI가 플랜 제안 → ProposedPlan 렌더링
 * 2. 사용자가 플랜 검토 (필요시 수정)
 * 3. Reject → 플랜 거부, 새 플랜 요청
 * 4. Continue/Submit changes → 플랜 승인, 실행 시작
 *
 * **UI 특징:**
 * - Reject: 빨간색 X 아이콘, hover 시 배경 변경
 * - Continue: 녹색 화살표 아이콘, hover 시 배경 변경
 * - 버튼 사이 간격 8 (gap-8)
 * - 점선 테두리 → hover 시 실선으로 변경
 *
 * @param {PlanItem[]} originalPlanItems - AI가 제안한 원본 플랜 아이템
 * @param {ReturnType<typeof useStream>} stream - LangGraph 스트림 객체
 */
export function ProposedPlan({
  originalPlanItems,
  stream,
}: {
  originalPlanItems: PlanItem[];
  stream: ReturnType<typeof useStream>;
}) {
  const {
    planItems,
    setPlanItems,
    changesMade,
    handleResumePlan,
    handleRejectPlan,
  } = useProposedPlan(originalPlanItems, stream);

  if (!planItems.length) return null;

  return (
    <div className="my-4 flex flex-col gap-4">
      <PlanViewer
        planItems={planItems}
        setPlanItems={setPlanItems}
        isProposedPlan={true}
      />
      <div className="py-8">
        <div className="flex items-center justify-center gap-8">
          <button
            onClick={handleRejectPlan}
            className="group flex cursor-pointer flex-col items-center gap-2 transition-all"
          >
            <div className="rounded-full border-2 border-dashed border-red-500 p-3 transition-all group-hover:border-solid group-hover:bg-red-50 dark:group-hover:bg-red-950/50">
              <X className="h-5 w-5 text-red-500" />
            </div>
            <span className="text-muted-foreground text-xs group-hover:text-red-600 dark:group-hover:text-red-400">
              Reject
            </span>
          </button>

          <button
            onClick={handleResumePlan}
            className="group flex cursor-pointer flex-col items-center gap-2 transition-all"
          >
            <div className="rounded-full border-2 border-dashed border-green-500 p-3 transition-all group-hover:border-solid group-hover:bg-green-50 dark:group-hover:bg-green-950/50">
              <ArrowRight className="h-5 w-5 text-green-500" />
            </div>
            <span className="text-muted-foreground text-xs group-hover:text-green-600 dark:group-hover:text-green-400">
              {changesMade ? "Submit changes" : "Continue"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
