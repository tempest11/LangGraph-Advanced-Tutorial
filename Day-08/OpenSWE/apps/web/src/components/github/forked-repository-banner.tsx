/**
 * @file github/forked-repository-banner.tsx
 * @description
 * GitHub Issues 필수 경고 배너 컴포넌트.
 * 선택된 저장소에 Issues가 활성화되어 있지 않을 경우, 사용자에게 경고 메시지를 표시합니다.
 * Open SWE는 Issues를 통해 작업을 추적하므로, Issues 활성화가 필수입니다.
 */

"use client";

import { AlertTriangle } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useGitHubAppProvider } from "@/providers/GitHubApp";
import { repoHasIssuesEnabled } from "@/lib/repo-has-issues";

/** GitHub 공식 문서: Issues 활성화/비활성화 가이드 */
const GITHUB_DOCS_LINK_ENABLING_ISSUES =
  "https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/disabling-issues";

/**
 * @component IssuesRequiredBanner
 * @description
 * GitHub Issues 필수 경고 배너.
 *
 * **표시 조건:**
 * - 선택된 저장소가 있음
 * - 해당 저장소에 Issues가 **비활성화**되어 있음
 *
 * **동작 로직:**
 * 1. 현재 선택된 저장소 찾기
 * 2. `repoHasIssuesEnabled()` 함수로 Issues 활성화 여부 확인
 * 3. Issues가 비활성화되어 있으면 경고 배너 표시
 *
 * **주의사항:**
 * - Open SWE는 Issues를 통해 작업 추적을 하므로 Issues가 필수입니다
 * - Forked 저장소는 기본적으로 Issues가 비활성화되어 있을 수 있습니다
 */
export function IssuesRequiredBanner() {
  const { selectedRepository, repositories } = useGitHubAppProvider();

  const currentRepo = repositories.find(
    (repo) =>
      selectedRepository &&
      repo.full_name ===
        `${selectedRepository.owner}/${selectedRepository.repo}`,
  );

  // If the repo has issues enabled, we support it.
  if (
    !selectedRepository ||
    !currentRepo ||
    repoHasIssuesEnabled(currentRepo)
  ) {
    return null;
  }

  return (
    <Alert
      variant="warning"
      className="relative"
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Issues Must Be Enabled</AlertTitle>
      <AlertDescription>
        <p>
          Open SWE requires issues to be enabled on the repository. Please
          enable issues on the repository to use Open SWE.
        </p>
        <p>
          See{" "}
          <a
            className="font-semibold underline underline-offset-2"
            href={GITHUB_DOCS_LINK_ENABLING_ISSUES}
            target="_blank"
          >
            here
          </a>{" "}
          for how to enable issues (docs show how to disable them, but the
          process is the same).
        </p>
      </AlertDescription>
    </Alert>
  );
}
