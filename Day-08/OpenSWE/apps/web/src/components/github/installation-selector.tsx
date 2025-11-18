/**
 * @file github/installation-selector.tsx
 * @description
 * GitHub 조직/사용자 선택 드롭다운 컴포넌트.
 * 여러 GitHub 조직/개인 계정 간 전환을 위한 셀렉터로, 아바타와 계정명을 표시합니다.
 * 로딩, 에러, 빈 상태를 각각 처리하며, 선택 시 자동으로 저장소 목록이 업데이트됩니다.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { GitHubSVG } from "@/components/icons/github";
import { useGitHubAppProvider } from "@/providers/GitHubApp";
import { cn } from "@/lib/utils";
import { Building2, User } from "lucide-react";
import type { Installation } from "@/hooks/useGitHubInstallations";

/**
 * InstallationSelector Props
 * @interface
 * @property {boolean} [disabled] - 셀렉터 비활성화 여부
 * @property {string} [placeholder] - 플레이스홀더 텍스트
 * @property {string} [className] - 추가 CSS 클래스
 * @property {string} [size] - 버튼 크기 (sm, default)
 */
interface InstallationSelectorProps {
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  size?: "sm" | "default";
}

/**
 * @component InstallationSelector
 * @description
 * GitHub App이 설치된 조직/사용자 계정을 선택하는 드롭다운.
 *
 * **4가지 상태 처리:**
 * 1. **로딩**: 회색 버튼 + "Loading..." 표시
 * 2. **에러**: 빨간색 버튼 + "Error loading installations" 표시
 * 3. **빈 목록**: 회색 버튼 + "No installations found" 표시
 * 4. **정상**: 드롭다운 + 아바타 이미지 + 계정명 표시
 *
 * **동작 흐름:**
 * 1. 사용자가 드롭다운에서 조직/계정 선택
 * 2. `switchInstallation()` 호출
 * 3. 선택된 계정의 저장소 목록 자동 로드
 * 4. localStorage에 선택 상태 저장
 *
 * **UI 특징:**
 * - 각 항목에 아바타 이미지 표시
 * - Organization은 빌딩 아이콘, User는 사람 아이콘
 * - 최소 너비 200px 유지
 */
export function InstallationSelector({
  disabled = false,
  placeholder = "Select organization/user...",
  className,
  size = "sm",
}: InstallationSelectorProps) {
  const {
    installations,
    currentInstallation,
    installationsLoading: isLoading,
    installationsError: error,
    switchInstallation,
  } = useGitHubAppProvider();

  const handleValueChange = async (value: string) => {
    await switchInstallation(value);
  };

  const getAccountIcon = (accountType: "User" | "Organization") => {
    return accountType === "Organization" ? (
      <Building2 className="h-4 w-4" />
    ) : (
      <User className="h-4 w-4" />
    );
  };

  if (isLoading) {
    return (
      <Button
        variant="outline"
        disabled
        size={size}
        className={cn("min-w-[200px]", className)}
      >
        <div className="flex items-center gap-2">
          <GitHubSVG />
          <span>Loading...</span>
        </div>
      </Button>
    );
  }

  if (error) {
    return (
      <Button
        variant="outline"
        disabled
        size={size}
        className={cn("text-destructive min-w-[200px]", className)}
      >
        <div className="flex items-center gap-2">
          <GitHubSVG />
          <span>Error loading installations</span>
        </div>
      </Button>
    );
  }

  if (installations.length === 0) {
    return (
      <Button
        variant="outline"
        disabled
        size={size}
        className={cn("text-muted-foreground min-w-[200px]", className)}
      >
        <div className="flex items-center gap-2">
          <GitHubSVG />
          <span>No installations found</span>
        </div>
      </Button>
    );
  }

  return (
    <Select
      value={currentInstallation?.id.toString() || ""}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectTrigger
        size={size}
        className={cn("min-w-[200px]", className)}
      >
        <div className="flex items-center gap-2">
          {currentInstallation ? (
            <div className="flex items-center gap-2">
              <img
                src={currentInstallation.avatarUrl}
                alt={`${currentInstallation.accountName} avatar`}
                className="h-4 w-4 rounded-full"
              />
              <span className="truncate">
                {currentInstallation.accountName}
              </span>
            </div>
          ) : (
            <SelectValue placeholder={placeholder} />
          )}
        </div>
      </SelectTrigger>
      <SelectContent>
        {installations.map((installation) => (
          <SelectItem
            key={installation.id}
            value={installation.id.toString()}
          >
            <div className="flex items-center gap-2">
              <img
                src={installation.avatarUrl}
                alt={`${installation.accountName} avatar`}
                className="h-4 w-4 rounded-full"
              />
              <span>{installation.accountName}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
