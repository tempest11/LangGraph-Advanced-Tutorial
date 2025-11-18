/**
 * @file useGitHubApp.ts
 * @description
 * GitHub App 통합을 종합적으로 관리하는 커스텀 훅.
 * GitHub 설치, 저장소 목록/선택, 브랜치 목록/선택을 통합 관리하며,
 * 페이지네이션, localStorage 지속성, URL 상태 동기화를 지원합니다.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQueryState } from "nuqs";
import {
  Repository,
  getRepositoryBranches,
  Branch,
  searchBranch,
} from "@/utils/github";
import { getRepository } from "@/utils/github";
import type { TargetRepository } from "@openswe/shared/open-swe/types";
import {
  useGitHubInstallations,
  type Installation,
} from "@/hooks/useGitHubInstallations";

/** localStorage에 저장할 저장소 키 */
const GITHUB_SELECTED_REPO_KEY = "selected-repository";

/**
 * 저장소를 localStorage에 저장
 */
const saveRepositoryToLocalStorage = (repo: TargetRepository | null) => {
  try {
    if (repo) {
      localStorage.setItem(GITHUB_SELECTED_REPO_KEY, JSON.stringify(repo));
    } else {
      localStorage.removeItem(GITHUB_SELECTED_REPO_KEY);
    }
  } catch (error) {
    console.warn("Failed to save repository to localStorage:", error);
  }
};

/**
 * localStorage에서 저장소 조회
 */
const getRepositoryFromLocalStorage = (): TargetRepository | null => {
  try {
    const stored = localStorage.getItem(GITHUB_SELECTED_REPO_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (
        parsed &&
        typeof parsed.owner === "string" &&
        typeof parsed.repo === "string"
      ) {
        return {
          owner: parsed.owner,
          repo: parsed.repo,
          // Don't restore branch from localStorage
        };
      }
    }
    return null;
  } catch (error) {
    console.warn("Failed to retrieve repository from localStorage:", error);
    return null;
  }
};

interface UseGitHubAppReturn {
  /** GitHub App 설치 여부 */
  isInstalled: boolean | null;
  /** 초기 로딩 상태 */
  isLoading: boolean;
  /** 에러 메시지 */
  error: string | null;

  /** 설치 목록 */
  installations: Installation[];
  /** 현재 선택된 설치 */
  currentInstallation: Installation | null;
  /** 설치 목록 로딩 상태 */
  installationsLoading: boolean;
  /** 설치 목록 에러 */
  installationsError: string | null;
  /** 설치 전환 */
  switchInstallation: (installationId: string) => Promise<void>;
  /** 설치 목록 새로고침 */
  refreshInstallations: () => Promise<void>;

  /** 저장소 목록 */
  repositories: Repository[];
  /** 저장소 페이지 번호 */
  repositoriesPage: number;
  /** 더 많은 저장소 존재 여부 */
  repositoriesHasMore: boolean;
  /** 저장소 추가 로딩 중 */
  repositoriesLoadingMore: boolean;
  /** 저장소 목록 새로고침 */
  refreshRepositories: () => Promise<void>;
  /** 저장소 더 불러오기 */
  loadMoreRepositories: () => Promise<void>;

  /** 선택된 저장소 */
  selectedRepository: TargetRepository | null;
  /** 저장소 선택 */
  setSelectedRepository: (repo: TargetRepository | null) => void;

  /** 브랜치 목록 */
  branches: Branch[];
  /** 브랜치 페이지 번호 */
  branchesPage: number;
  /** 더 많은 브랜치 존재 여부 */
  branchesHasMore: boolean;
  /** 브랜치 로딩 중 */
  branchesLoading: boolean;
  /** 브랜치 추가 로딩 중 */
  branchesLoadingMore: boolean;
  /** 브랜치 에러 */
  branchesError: string | null;
  /** 브랜치 더 불러오기 */
  loadMoreBranches: () => Promise<void>;
  /** 브랜치 목록 조회 */
  fetchBranches: () => Promise<void>;
  /** 브랜치 페이지 설정 */
  setBranchesPage: (page: number) => void;
  /** 브랜치 목록 설정 */
  setBranches: (branches: Branch[]) => void;

  /** 선택된 브랜치 */
  selectedBranch: string | null;
  /** 브랜치 선택 */
  setSelectedBranch: (branch: string | null) => void;
  /** 브랜치 목록 새로고침 */
  refreshBranches: () => Promise<void>;
  /** 특정 브랜치 검색 */
  searchForBranch: (branchName: string) => Promise<Branch | null>;

  /** 기본 브랜치명 */
  defaultBranch: string | null;
}

/**
 * @hook useGitHubApp
 * @description
 * GitHub App 통합을 종합적으로 관리하는 메인 커스텀 훅.
 * 설치 관리, 저장소 선택, 브랜치 선택 등 GitHub App의 모든 기능을 통합하며,
 * 복잡한 상태 관리, URL 동기화, localStorage 지속성, 자동 복구 등을 처리합니다.
 *
 * @features
 * - GitHub 설치 관리 (다중 조직/계정 지원)
 * - 저장소 목록 조회 및 페이지네이션
 * - 브랜치 목록 조회 및 페이지네이션
 * - URL 쿼리 파라미터와 상태 동기화
 * - localStorage를 통한 선택 상태 지속성
 * - 설치 전환 시 자동 상태 초기화
 * - 유효하지 않은 저장소 자동 복구
 * - 브랜치 검색 기능
 *
 * @returns GitHub App 통합에 필요한 모든 상태 및 함수
 *
 * @example
 * ```tsx
 * const {
 *   isInstalled,
 *   installations,
 *   currentInstallation,
 *   repositories,
 *   selectedRepository,
 *   setSelectedRepository,
 *   branches,
 *   selectedBranch,
 *   setSelectedBranch,
 * } = useGitHubApp();
 *
 * if (!isInstalled) {
 *   return <InstallGitHubApp />;
 * }
 *
 * return (
 *   <div>
 *     <RepositorySelector
 *       repositories={repositories}
 *       selected={selectedRepository}
 *       onSelect={setSelectedRepository}
 *     />
 *     <BranchSelector
 *       branches={branches}
 *       selected={selectedBranch}
 *       onSelect={setSelectedBranch}
 *     />
 *   </div>
 * );
 * ```
 *
 * @note
 * 이 훅은 매우 복잡한 상태를 관리하므로, 필요한 부분만 구독하여 사용하는 것이 좋습니다.
 * 단일 기능만 필요하다면 useGitHubInstallations 또는 개별 훅을 고려하세요.
 */
export function useGitHubApp(): UseGitHubAppReturn {
  // 중앙 집중식 설치 상태 사용
  const {
    currentInstallationId,
    installations,
    currentInstallation,
    isLoading: installationsLoading,
    error: installationsError,
    switchInstallation,
    refreshInstallations,
  } = useGitHubInstallations();

  // Installation and general state
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Repository state and pagination
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repositoriesPage, setRepositoriesPage] = useState(1);
  const [repositoriesHasMore, setRepositoriesHasMore] = useState(false);
  const [repositoriesLoadingMore, setRepositoriesLoadingMore] = useState(false);

  // Branch state and pagination
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesPage, setBranchesPage] = useState(1);
  const [branchesHasMore, setBranchesHasMore] = useState(false);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesLoadingMore, setBranchesLoadingMore] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  // URL state management
  const [selectedRepositoryParam, setSelectedRepositoryParam] =
    useQueryState("repo");
  const [selectedBranchParam, setSelectedBranchParam] = useQueryState("branch");

  // Track if auto-selection has been attempted to prevent re-triggering
  const hasAutoSelectedRef = useRef(false);

  // Track if we've attempted to load from localStorage
  const hasCheckedLocalStorageRef = useRef(false);

  // Track previous installation ID to detect actual changes
  const previousInstallationIdRef = useRef<string | null>(null);

  const selectedRepository = useMemo(() => {
    if (!selectedRepositoryParam) return null;
    try {
      // Parse "owner/repo" format instead of JSON
      const parts = selectedRepositoryParam.split("/");
      if (parts.length === 2) {
        return {
          owner: parts[0],
          repo: parts[1],
          branch: selectedBranchParam || undefined,
        } as TargetRepository;
      }
      return null;
    } catch {
      return null;
    }
  }, [selectedRepositoryParam, selectedBranchParam]);

  useEffect(() => {
    if (selectedRepository && !branchesLoading) {
      setBranches([]);
      setBranchesPage(1);
      fetchBranches();
    } else if (!selectedRepository) {
      setBranches([]);
      setSelectedBranchParam(null);
    }
  }, [selectedRepository]);

  const selectedBranch = selectedBranchParam;

  const setSelectedRepository = useCallback(
    (repo: TargetRepository | null) => {
      setSelectedRepositoryParam(repo ? `${repo.owner}/${repo.repo}` : null);
      // Persist to localStorage whenever repository is selected
      saveRepositoryToLocalStorage(repo);

      setSelectedBranchParam(null);
      setBranches([]);
      setBranchesPage(1);
      setBranchesHasMore(false);
    },
    [setSelectedRepositoryParam, setSelectedBranchParam],
  );

  const setSelectedBranch = (branch: string | null) => {
    setSelectedBranchParam(branch);
  };

  const checkInstallation = async (
    page: number = 1,
    append: boolean = false,
  ) => {
    if (!append) setIsLoading(true);
    if (append) setRepositoriesLoadingMore(true);
    setError(null);

    try {
      const response = await fetch(`/api/github/repositories?page=${page}`);

      if (response.ok) {
        const data = await response.json();
        const newRepositories = data.repositories || [];

        if (append) {
          setRepositories((prev) => [...prev, ...newRepositories]);
        } else {
          setRepositories(newRepositories);
        }

        setRepositoriesPage(data.pagination?.page || page);
        setRepositoriesHasMore(data.pagination?.hasMore || false);
        setIsInstalled(true);
      } else {
        const errorData = await response.json();
        if (errorData.error.includes("installation")) {
          setIsInstalled(false);
        } else {
          setError(errorData.error);
          setIsInstalled(false);
        }
      }
    } catch {
      setError("Failed to check GitHub App installation status");
      setIsInstalled(false);
    } finally {
      setIsLoading(false);
      setRepositoriesLoadingMore(false);
    }
  };

  const fetchBranches = useCallback(
    async (page: number = 1, append: boolean = false) => {
      if (!selectedRepository) {
        setBranches([]);
        setBranchesPage(1);
        setBranchesHasMore(false);
        return;
      }

      if (!append) setBranchesLoading(true);
      if (append) setBranchesLoadingMore(true);
      setBranchesError(null);

      try {
        const branchData = await getRepositoryBranches(
          selectedRepository.owner,
          selectedRepository.repo,
          page,
        );

        if (append) {
          setBranches((prev) => {
            // Avoid adding duplicates
            const newBranches = branchData.branches.filter(
              (branch) => !prev.some((b) => b.name === branch.name),
            );
            return [...prev, ...newBranches];
          });
        } else {
          setBranches(branchData.branches);
        }

        setBranchesPage(page);
        setBranchesHasMore(branchData.hasMore);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to fetch branches";
        console.error(
          `Error fetching branches for ${selectedRepository.owner}/${selectedRepository.repo}:`,
          err,
        );
        setBranchesError(errorMessage);
      } finally {
        if (!append) setBranchesLoading(false);
        if (append) setBranchesLoadingMore(false);
      }
    },
    [selectedRepository?.owner, selectedRepository?.repo],
  );

  // Load more functions
  const loadMoreRepositories = useCallback(async () => {
    if (repositoriesHasMore && !repositoriesLoadingMore) {
      await checkInstallation(repositoriesPage + 1, true);
    }
  }, [repositoriesHasMore, repositoriesLoadingMore, repositoriesPage]);

  const loadMoreBranches = useCallback(async () => {
    if (branchesHasMore && !branchesLoadingMore) {
      await fetchBranches(branchesPage + 1, true);
    }
  }, [branchesHasMore, branchesLoadingMore, branchesPage, fetchBranches]);

  const searchForBranch = useCallback(
    async (branchName: string): Promise<Branch | null> => {
      if (!selectedRepository) {
        return null;
      }

      try {
        const branch = await searchBranch(
          selectedRepository.owner,
          selectedRepository.repo,
          branchName,
        );

        if (branch) {
          setBranches((prev) => {
            const exists = prev.some((b) => b.name === branch.name);
            if (!exists) {
              return [...prev, branch];
            }
            return prev;
          });
        }

        return branch;
      } catch (error) {
        console.error(`Error searching for branch ${branchName}:`, error);
        return null;
      }
    },
    [selectedRepository?.owner, selectedRepository?.repo],
  );

  // Refresh repositories when installation changes
  useEffect(() => {
    if (currentInstallationId) {
      const previousInstallationId = previousInstallationIdRef.current;

      // Only clear repository if installation actually changed to a different value
      if (
        previousInstallationId !== null &&
        previousInstallationId !== currentInstallationId
      ) {
        // Clear selected repository and branches when installation changes
        setSelectedRepository(null);
        setBranches([]);
        setRepositoriesPage(1);
        setRepositoriesHasMore(false);

        // Reset auto-selection flags so they can run again for the new installation
        hasAutoSelectedRef.current = false;
        hasCheckedLocalStorageRef.current = false;
      }

      previousInstallationIdRef.current = currentInstallationId;
    }

    checkInstallation();
  }, [currentInstallationId]);

  useEffect(() => {
    if (
      !hasCheckedLocalStorageRef.current &&
      !selectedRepository &&
      !isLoading &&
      !error &&
      isInstalled === true &&
      repositories.length > 0
    ) {
      hasCheckedLocalStorageRef.current = true;

      const storedRepo = getRepositoryFromLocalStorage();
      if (storedRepo) {
        const existsInResponse = repositories.some(
          (repo) => repo.full_name === `${storedRepo.owner}/${storedRepo.repo}`,
        );

        if (existsInResponse) {
          setSelectedRepository(storedRepo);
          hasAutoSelectedRef.current = true;
        } else {
          const fetchSpecificRepo = async () => {
            try {
              const specificRepo = await getRepository(
                storedRepo.owner,
                storedRepo.repo,
              );
              if (specificRepo) {
                setSelectedRepository(storedRepo);
                hasAutoSelectedRef.current = true;
              } else {
                const firstRepo = repositories[0];
                const targetRepo = {
                  owner: firstRepo.full_name.split("/")[0],
                  repo: firstRepo.full_name.split("/")[1],
                };
                setSelectedRepository(targetRepo);
                saveRepositoryToLocalStorage(targetRepo);
                hasAutoSelectedRef.current = true;
              }
            } catch (error) {
              console.warn("Failed to fetch specific repository:", error);
              const firstRepo = repositories[0];
              const targetRepo = {
                owner: firstRepo.full_name.split("/")[0],
                repo: firstRepo.full_name.split("/")[1],
              };
              setSelectedRepository(targetRepo);
              saveRepositoryToLocalStorage(targetRepo);
              hasAutoSelectedRef.current = true;
            }
          };

          fetchSpecificRepo();
        }
      }
    }
  }, [
    repositories,
    selectedRepository,
    isLoading,
    error,
    isInstalled,
    setSelectedRepository,
  ]);

  // Auto-select first repository on initial page load
  useEffect(() => {
    if (
      !hasAutoSelectedRef.current &&
      !selectedRepository &&
      !isLoading &&
      !error &&
      isInstalled === true &&
      repositories.length > 0 &&
      hasCheckedLocalStorageRef.current
    ) {
      const firstRepo = repositories[0];
      const targetRepo = {
        owner: firstRepo.full_name.split("/")[0],
        repo: firstRepo.full_name.split("/")[1],
      };
      setSelectedRepository(targetRepo);
      saveRepositoryToLocalStorage(targetRepo);
      hasAutoSelectedRef.current = true;
    }
  }, [
    repositories,
    selectedRepository,
    isLoading,
    error,
    isInstalled,
    setSelectedRepository,
    hasCheckedLocalStorageRef.current,
  ]);

  const refreshRepositories = async () => {
    // Reset pagination state on refresh
    setRepositoriesPage(1);
    setRepositoriesHasMore(false);
    await checkInstallation();
  };

  const refreshBranches = async () => {
    // Reset pagination state on refresh
    setBranchesPage(1);
    setBranchesHasMore(false);
    await fetchBranches();
  };

  // Get the default branch for the currently selected repository
  const defaultBranch = selectedRepository
    ? repositories.find(
        (repo) =>
          repo.full_name ===
          `${selectedRepository.owner}/${selectedRepository.repo}`,
      )?.default_branch || null
    : null;

  return {
    // Installation and general state
    isInstalled,
    isLoading,
    error,

    // Installation management
    installations,
    currentInstallation,
    installationsLoading,
    installationsError,
    switchInstallation,
    refreshInstallations,

    // Repository state and pagination
    repositories,
    repositoriesPage,
    repositoriesHasMore,
    repositoriesLoadingMore,
    refreshRepositories,
    loadMoreRepositories,

    // Repository selection
    selectedRepository,
    setSelectedRepository,

    // Branch state and pagination
    branches,
    branchesPage,
    branchesHasMore,
    branchesLoading,
    branchesLoadingMore,
    branchesError,
    loadMoreBranches,
    fetchBranches,

    // Branch selection
    selectedBranch,
    setSelectedBranch,
    refreshBranches,
    searchForBranch,
    setBranchesPage,
    setBranches,

    // Repository metadata
    defaultBranch,
  };
}
