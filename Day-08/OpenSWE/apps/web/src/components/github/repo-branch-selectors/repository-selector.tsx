/**
 * @file repo-branch-selectors/repository-selector.tsx
 * @description
 * GitHub 저장소 선택 드롭다운 컴포넌트.
 * Command 패턴 기반의 검색 가능한 드롭다운으로, 5가지 상태를 처리하며 페이지네이션을 지원합니다.
 * 채팅이 시작되면 읽기 전용 모드로 전환되어 저장소 변경을 방지합니다.
 */

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { TargetRepository } from "@openswe/shared/open-swe/types";
import { GitHubSVG } from "@/components/icons/github";
import { Repository } from "@/utils/github";
import { useGitHubAppProvider } from "@/providers/GitHubApp";

/**
 * RepositorySelector Props
 * @interface
 * @property {boolean} [disabled] - 셀렉터 비활성화 여부
 * @property {string} [placeholder] - 플레이스홀더 텍스트
 * @property {string} [buttonClassName] - 버튼 커스텀 CSS 클래스
 * @property {boolean} [chatStarted] - 채팅 시작 여부 (true일 경우 읽기 전용)
 * @property {TargetRepository} [streamTargetRepository] - 스트리밍 중인 저장소 정보
 */
interface RepositorySelectorProps {
  disabled?: boolean;
  placeholder?: string;
  buttonClassName?: string;
  chatStarted?: boolean;
  streamTargetRepository?: TargetRepository;
}

/**
 * GitHub Repository를 TargetRepository 형식으로 변환
 * @param repo - GitHub Repository 객체
 * @returns TargetRepository 형식 (owner, repo)
 * @todo open-swe 패키지의 TargetRepository 타입으로 통일 필요
 */
const repositoryToTarget = (repo: Repository): TargetRepository => {
  const [owner, repoName] = repo.full_name.split("/");
  return { owner, repo: repoName };
};

/**
 * @component RepositorySelector
 * @description
 * GitHub 저장소를 선택하는 드롭다운 컴포넌트.
 *
 * **5가지 상태 처리:**
 * 1. **로딩 중**: "Loading repositories..." 버튼 (비활성)
 * 2. **에러 발생**: "Error loading repositories" 버튼 (비활성)
 * 3. **App 미설치**: "GitHub App not installed" 버튼 (비활성)
 * 4. **빈 목록**: "No repositories available" 버튼 (비활성)
 * 5. **정상**: 검색 가능한 드롭다운 + 페이지네이션
 *
 * **동작 모드:**
 * - **채팅 전 (chatStarted=false)**: 클릭 가능한 드롭다운
 * - **채팅 중 (chatStarted=true)**: 읽기 전용 버튼 (저장소 고정)
 *
 * **주요 기능:**
 * - Command 기반 검색 (실시간 필터링)
 * - "Load more repositories" 페이지네이션
 * - 선택된 저장소 체크 표시
 * - owner/repo 형식 표시
 *
 * **데이터 흐름:**
 * 1. 사용자가 드롭다운 열기
 * 2. Command Input으로 검색
 * 3. 저장소 선택 → `repositoryToTarget()` 변환
 * 4. `setSelectedRepository()` 호출
 * 5. localStorage에 저장 (Provider)
 *
 * @todo 스레드 조회 시 nuqs 파라미터에서 저장소 정보 가져와 disabled=true 설정
 */
export function RepositorySelector({
  disabled = false,
  placeholder = "Select a repository...",
  buttonClassName,
  chatStarted = false,
  streamTargetRepository,
}: RepositorySelectorProps) {
  const [open, setOpen] = useState(false);
  const {
    repositories,
    selectedRepository,
    setSelectedRepository,
    isLoading,
    error,
    isInstalled,
    repositoriesHasMore,
    repositoriesLoadingMore,
    loadMoreRepositories,
  } = useGitHubAppProvider();

  const handleSelect = (repositoryKey: string) => {
    const repository = repositories.find(
      (repo) => repo.full_name === repositoryKey,
    );
    if (repository) {
      setSelectedRepository(repositoryToTarget(repository));
      setOpen(false);
    }
  };

  const selectedValue = selectedRepository
    ? `${selectedRepository.owner}/${selectedRepository.repo}`
    : undefined;

  // When chatStarted and streamTargetRepository is available, use it for display
  const displayValue =
    chatStarted && streamTargetRepository
      ? `${streamTargetRepository.owner}/${streamTargetRepository.repo}`
      : selectedValue;

  if (isLoading) {
    return (
      <Button
        variant="outline"
        disabled
        className={cn(buttonClassName)}
        size="sm"
      >
        <div className="flex items-center gap-2">
          <GitHubSVG
            width="16"
            height="16"
          />
          <span>Loading repositories...</span>
        </div>
      </Button>
    );
  }

  if (error) {
    return (
      <Button
        variant="outline"
        disabled
        className={cn(buttonClassName)}
        size="sm"
      >
        <div className="flex items-center gap-2">
          <GitHubSVG
            width="16"
            height="16"
          />
          <span>Error loading repositories</span>
        </div>
      </Button>
    );
  }

  if (isInstalled === false) {
    return (
      <Button
        variant="outline"
        disabled
        className={cn(buttonClassName)}
        size="sm"
      >
        <div className="flex items-center gap-2">
          <GitHubSVG
            width="16"
            height="16"
          />
          <span>GitHub App not installed</span>
        </div>
      </Button>
    );
  }

  if (repositories.length === 0) {
    return (
      <Button
        variant="outline"
        disabled
        className={cn(buttonClassName)}
        size="sm"
      >
        <div className="flex items-center gap-2">
          <GitHubSVG
            width="16"
            height="16"
          />
          <span>No repositories available</span>
        </div>
      </Button>
    );
  }

  if (chatStarted) {
    return (
      <Button
        variant="outline"
        className={cn(buttonClassName)}
        size="sm"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <GitHubSVG />
          <span className="truncate text-left">
            {displayValue || placeholder}
          </span>
        </div>
      </Button>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(buttonClassName)}
          disabled={disabled}
          size="sm"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <GitHubSVG />
            <span className="truncate text-left">
              {selectedValue || placeholder}
            </span>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0">
        <Command>
          <CommandInput placeholder="Search repositories..." />
          <CommandList>
            <CommandEmpty>No repositories found.</CommandEmpty>
            <CommandGroup>
              {repositories.map((repo) => {
                const key = repo.full_name;
                const isSelected = selectedValue === key;
                return (
                  <CommandItem
                    key={repo.id}
                    value={key}
                    onSelect={() => handleSelect(key)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{repo.full_name}</span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {repositoriesHasMore && (
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    loadMoreRepositories();
                  }}
                  disabled={repositoriesLoadingMore}
                  className="justify-center"
                >
                  {repositoriesLoadingMore
                    ? "Loading more..."
                    : "Load more repositories"}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
