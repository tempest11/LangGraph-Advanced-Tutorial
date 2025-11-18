/**
 * @file settings-page/config-manager.tsx
 * @description
 * 에이전트 구성 관리 컴포넌트.
 * GraphConfiguration Zod 스키마에서 구성 메타데이터를 추출하고,
 * 사용자가 LLM 모델, 온도, 토큰 수, MCP 서버 등을 설정할 수 있도록 합니다.
 */

"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Settings, AlertTriangle, CircleAlert } from "lucide-react";
import { ConfigField } from "@/components/configuration/config-field";
import { useConfigStore, DEFAULT_CONFIG_KEY } from "@/hooks/useConfigStore";
import { Skeleton } from "@/components/ui/skeleton";
import type { ConfigurableFieldUIMetadata } from "@openswe/shared/configurable-metadata";
import { GraphConfigurationMetadata } from "@openswe/shared/open-swe/types";
import { cn } from "@/lib/utils";

/**
 * GraphConfiguration Zod 스키마에서 구성 메타데이터 추출
 * @param configurable - 현재 구성 값
 * @returns 구성 필드 메타데이터 배열
 */
function extractConfigurationsFromSchema(
  configurable: Record<string, any>,
): ConfigurableFieldUIMetadata[] {
  const configurations: ConfigurableFieldUIMetadata[] = [];

  for (const [label, { x_open_swe_ui_config: metadata }] of Object.entries(
    GraphConfigurationMetadata,
  )) {
    if (metadata.type === "hidden") {
      continue;
    }
    configurations.push({
      label,
      type: metadata.type,
      default: configurable[label] || metadata.default,
      description: metadata.description,
      placeholder: metadata.placeholder,
      options: metadata.options,
      min: metadata.min,
      max: metadata.max,
      step: metadata.step,
    });
  }

  return configurations;
}

/**
 * @component ConfigManager
 * @description
 * 에이전트 구성 관리 컴포넌트.
 * LLM 모델 선택, 온도, 토큰 수, MCP 서버 등의 에이전트 파라미터를 설정합니다.
 *
 * @features
 * - GraphConfiguration 스키마 기반 동적 폼 생성
 * - 기본값과 사용자 설정값 비교
 * - 수정된 필드 시각적 표시 (Modified 뱃지)
 * - 자동 저장 (localStorage 기반)
 * - 경고 메시지 (기본값 변경 시)
 * - 다양한 필드 타입 지원 (text, number, select, switch, textarea)
 *
 * @warning
 * 기본 구성값은 최적 성능을 위해 신중하게 선택되었습니다.
 * 이러한 설정을 변경하면 에이전트 성능과 동작에 부정적인 영향을 미칠 수 있습니다.
 */
export function ConfigManager() {
  const { configs, updateConfig, getConfig } = useConfigStore();
  const [defaultConfig, setDefaultConfig] = useState<
    ConfigurableFieldUIMetadata[]
  >([]);
  const [configurations, setConfigurations] = useState<
    ConfigurableFieldUIMetadata[]
  >([]);
  const [loading, setLoading] = useState(false);

  const loadConfigurations = async () => {
    // TODO: If we implement a concept of users and start storing config on assistants,
    // we will need to update this to fetch configs from the assistant first.
    setLoading(true);

    // Extract default configurations from schema
    const defaultConfigs = extractConfigurationsFromSchema({});
    setDefaultConfig(defaultConfigs);

    // Get existing user configurations (if any)
    const existingConfig = getConfig(DEFAULT_CONFIG_KEY) || {};

    // Create configurations array with user values where they exist, defaults otherwise
    const actualConfigs = defaultConfigs.map((config) => ({
      ...config,
      // Use existing user value if it exists, otherwise keep the default for display
      default:
        existingConfig[config.label] !== undefined
          ? existingConfig[config.label]
          : config.default,
    }));

    setConfigurations(actualConfigs);
    setLoading(false);
  };

  useEffect(() => {
    loadConfigurations();
  }, []);

  const hasConfiguredValues = configurations.some((config) => {
    const currentValue = configs[DEFAULT_CONFIG_KEY]?.[config.label];
    const defaultValue = defaultConfig.find(
      (c) => c.label === config.label,
    )?.default;
    // Only consider it configured if the user has explicitly set a value
    return currentValue !== undefined && currentValue !== defaultValue;
  });

  return (
    <div className="space-y-8">
      <Alert className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>Warning:</strong> The default configuration values have been
          carefully selected for optimal performance. Modifying these settings
          may negatively impact the agent's performance and behavior. Only
          change these values if you understand their implications.
        </AlertDescription>
      </Alert>
      <Card className="bg-card border-border shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Settings className="h-5 w-5" />
                Agent Configuration
              </CardTitle>
              <CardDescription>
                Configure agent behavior and model parameters. Will auto-save
                changes.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {hasConfiguredValues && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs",
                    "border-blue-200 bg-blue-50 text-blue-700",
                    "dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
                  )}
                >
                  Customized
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : configurations.length > 0 ? (
            configurations.map(
              (config: ConfigurableFieldUIMetadata, index: number) => (
                <div
                  key={`${config.label}-${index}`}
                  className="border-border rounded-md border-[1px] p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const currentValue =
                          configs[DEFAULT_CONFIG_KEY]?.[config.label];
                        const defaultValue = defaultConfig.find(
                          (c) => c.label === config.label,
                        )?.default;
                        const isModified =
                          currentValue !== undefined &&
                          currentValue !== defaultValue;

                        return (
                          isModified && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-xs",
                                "border-orange-200 bg-orange-50 text-orange-700",
                                "dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-400",
                              )}
                            >
                              Modified
                            </Badge>
                          )
                        );
                      })()}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {config.label === "mcpServers" && (
                      <Alert className="border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400">
                        <CircleAlert className="h-4 w-4" />
                        <AlertDescription>
                          <p>
                            <strong>Notice:</strong> Open SWE{" "}
                            <i className="underline underline-offset-2">only</i>{" "}
                            supports MCP servers with <strong>HTTP</strong> or{" "}
                            <strong>SSE</strong> transports (with the exception
                            of the default LangGraph documentation MCP server).
                            Other transports will be <strong>ignored</strong>.
                          </p>
                        </AlertDescription>
                      </Alert>
                    )}
                    <ConfigField
                      id={config.label}
                      label={config.label}
                      type={
                        config.type === "boolean"
                          ? "switch"
                          : (config.type ?? "text")
                      }
                      description={config.description}
                      placeholder={config.placeholder}
                      options={config.options}
                      min={config.min}
                      max={config.max}
                      step={config.step}
                      value={
                        configs[DEFAULT_CONFIG_KEY]?.[config.label] !==
                        undefined
                          ? configs[DEFAULT_CONFIG_KEY][config.label]
                          : config.default
                      }
                      setValue={(value) => {
                        // Only store in config when user actually changes a value
                        updateConfig(DEFAULT_CONFIG_KEY, config.label, value);
                      }}
                    />
                  </div>
                </div>
              ),
            )
          ) : (
            <div className="py-8 text-center">
              <Settings className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
              <h3 className="mb-2 text-lg font-semibold">
                No Configuration Available
              </h3>
              <p className="text-muted-foreground">
                No configurable parameters found for the current context.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
