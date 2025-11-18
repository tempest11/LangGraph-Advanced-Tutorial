/**
 * @file repo-branch-selectors/index.tsx
 * @description
 * 저장소와 브랜치 선택기를 결합한 통합 컴포넌트.
 * "owner/repo:branch" 형식으로 표시하며, 채팅 시작 여부에 따라 UI 상태가 변경됩니다.
 * 채팅이 시작되면 선택기가 읽기 전용으로 변경되어 저장소/브랜치 변경을 방지합니다.
 */

import { BranchSelector } from "./branch-selector";
import { RepositorySelector } from "./repository-selector";
import { useQueryState } from "nuqs";

/**
 * @component RepositoryBranchSelectors
 * @description
 * 저장소와 브랜치를 함께 선택하는 통합 UI 컴포넌트.
 *
 * **UI 구조:**
 * ```
 * [ owner/repo ] : [ branch ]
 * ```
 *
 * **동작 모드:**
 * 1. **채팅 전 (threadId 없음):**
 *    - 클릭 가능한 선택기
 *    - 호버 효과 활성화
 *    - 저장소/브랜치 자유롭게 변경 가능
 *
 * 2. **채팅 시작 후 (threadId 있음):**
 *    - 읽기 전용 표시
 *    - 클릭 불가 (cursor-default)
 *    - 호버 효과 비활성화
 *    - 현재 선택된 저장소/브랜치 고정
 *
 * **주의사항:**
 * 채팅이 시작되면 저장소/브랜치 변경이 불가능합니다.
 * 이는 대화 컨텍스트를 유지하기 위한 의도적인 동작입니다.
 */
export function RepositoryBranchSelectors() {
  const [threadId] = useQueryState("threadId");
  const chatStarted = !!threadId;
  const defaultButtonStyles =
    "bg-inherit border-none text-foreground hover:text-foreground/80 text-xs p-0 px-0 py-0 !p-0 !px-0 !py-0 h-fit hover:bg-inherit shadow-none";
  const defaultStylesChatStarted =
    "hover:bg-inherit cursor-default hover:cursor-default text-foreground hover:border-gray-300 hover:ring-inherit shadow-none p-0 px-0 py-0 !p-0 !px-0 !py-0";

  return (
    <div className="flex items-center gap-1 rounded-md border border-gray-200 p-1 dark:border-gray-700">
      <div className="flex items-center gap-0">
        <RepositorySelector
          chatStarted={chatStarted}
          buttonClassName={
            defaultButtonStyles +
            (chatStarted ? " " + defaultStylesChatStarted : "")
          }
        />
      </div>
      <span className="text-muted-foreground/70">:</span>
      <div className="flex items-center gap-0">
        <BranchSelector
          chatStarted={chatStarted}
          buttonClassName={
            defaultButtonStyles +
            (chatStarted ? " " + defaultStylesChatStarted : "")
          }
        />
      </div>
    </div>
  );
}
