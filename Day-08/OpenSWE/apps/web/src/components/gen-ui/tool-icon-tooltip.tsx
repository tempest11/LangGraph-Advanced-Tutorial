/**
 * @file gen-ui/tool-icon-tooltip.tsx
 * @description
 * 툴 아이콘에 hover tooltip을 추가하는 간단한 래퍼 컴포넌트.
 * Shadcn UI의 Tooltip 컴포넌트를 사용하여 툴 이름을 표시합니다.
 */

import { JSX } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

/**
 * @component ToolIconWithTooltip
 * @description
 * 툴 아이콘 위에 마우스를 올리면 툴 이름을 보여주는 tooltip 래퍼.
 *
 * **사용 목적:**
 * - ActionStep 등에서 도구 아이콘에 이름 표시
 * - 사용자가 어떤 도구가 사용되었는지 쉽게 파악
 *
 * **UI 구조:**
 * ```
 * [아이콘]
 *   ↓ hover
 * [툴 이름 tooltip]
 * ```
 *
 * @param {string} toolNamePretty - 표시할 툴 이름 (예: "Read File", "Run Command")
 * @param {JSX.Element} icon - 표시할 아이콘 JSX 엘리먼트
 *
 * @example
 * ```tsx
 * <ToolIconWithTooltip
 *   toolNamePretty="Read File"
 *   icon={<FileIcon className="h-4 w-4" />}
 * />
 * ```
 */
export function ToolIconWithTooltip({
  toolNamePretty,
  icon,
}: {
  toolNamePretty: string;
  icon: JSX.Element;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{icon}</TooltipTrigger>
        <TooltipContent>{toolNamePretty}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
