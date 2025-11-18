/**
 * @file settings-page/index.tsx
 * @description
 * 설정 페이지 메인 컴포넌트.
 * GitHub 통합, API 키 관리, 에이전트 구성 등을 관리하는 탭 인터페이스를 제공합니다.
 */

"use client";

import { useQueryState } from "nuqs";
import { useRouter } from "next/navigation";
import { Key, Settings, ArrowLeft } from "lucide-react";
import { GitHubManager } from "./github-manager";
import { APIKeysTab } from "./api-keys";
import { ConfigManager } from "./config-manager";
import { GitHubSVG } from "@/components/icons/github";
import { GitHubAppProvider } from "@/providers/GitHubApp";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * @component SettingsPage
 * @description
 * 설정 페이지 메인 컴포넌트.
 * GitHub, API Keys, Configuration 탭을 제공하며, URL 쿼리 파라미터로 탭 상태를 관리합니다.
 *
 * @features
 * - GitHub 통합 관리 (저장소, 브랜치 선택)
 * - API 키 관리 (Anthropic, OpenAI, Google)
 * - 에이전트 구성 설정
 * - URL 쿼리 기반 탭 상태 관리
 * - 테마 토글
 */
export default function SettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useQueryState("tab", {
    defaultValue: "github" as "github" | "api-keys" | "configuration",
    parse: (value: string) => {
      if (["github", "api-keys", "configuration"].includes(value)) {
        return value as "github" | "api-keys" | "configuration";
      }
      return "github";
    },
    serialize: (value) => value,
  });

  const getTabClassName = (isActive: boolean) =>
    cn(
      "relative border-b-2 px-4 py-3 text-sm font-medium transition-colors",
      isActive
        ? "border-primary bg-background text-primary"
        : "text-muted-foreground hover:bg-muted hover:text-foreground border-transparent",
    );

  return (
    <GitHubAppProvider>
      <div className="mx-auto max-w-6xl p-6">
        {/* Header with back button and theme toggle */}
        <div className="mb-6 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/chat")}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="size-4" />
            Back to Chat
          </Button>
          <ThemeToggle />
        </div>

        <div className="mb-8">
          <h1 className="text-foreground mb-2 text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Manage your integrations and API configurations
          </p>
        </div>

        <div className="mb-6">
          <div className="border-border bg-muted/50 flex rounded-t-lg border-b">
            <button
              onClick={() => setActiveTab("github")}
              className={getTabClassName(activeTab === "github")}
            >
              <span className="flex items-center gap-2 font-mono">
                <GitHubSVG
                  height="16"
                  width="16"
                />
                GitHub
              </span>
            </button>
            <button
              onClick={() => setActiveTab("api-keys")}
              className={getTabClassName(activeTab === "api-keys")}
            >
              <span className="flex items-center gap-2 font-mono">
                <Key className="size-4" />
                API Keys
              </span>
            </button>
            <button
              onClick={() => setActiveTab("configuration")}
              className={getTabClassName(activeTab === "configuration")}
            >
              <span className="flex items-center gap-2 font-mono">
                <Settings className="size-4" />
                Configuration
              </span>
            </button>
          </div>
        </div>

        <div className="border-border bg-background rounded-b-lg border border-t-0 p-6">
          {activeTab === "github" && <GitHubManager />}
          {activeTab === "api-keys" && <APIKeysTab />}
          {activeTab === "configuration" && <ConfigManager />}
        </div>
      </div>
    </GitHubAppProvider>
  );
}
