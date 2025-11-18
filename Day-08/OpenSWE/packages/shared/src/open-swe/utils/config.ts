/**
 * @file config.ts
 * @description 이 파일은 그래프 설정(GraphConfig)과 관련된 유틸리티 함수를 제공합니다.
 * 특히, UI에 표시되어야 하는 사용자 정의 설정 필드를 추출하는 로직을 포함합니다.
 */

import {
  GraphConfig,
  GraphConfigurationMetadata,
} from "@openswe/shared/open-swe/types";

/**
 * 주어진 `GraphConfig`에서 사용자 정의 가능한 필드들만 추출하여 반환합니다.
 * `GraphConfigurationMetadata`를 참조하여 `type`이 'hidden'이 아닌 필드나
 * 명시적으로 포함해야 하는 특정 필드들(apiKeys, reviewPullNumber, customFramework)을 선택합니다.
 *
 * @param config - 전체 그래프 설정 객체입니다.
 * @returns {Partial<GraphConfig["configurable"]>} UI에 표시될 수 있는 설정 필드들의 부분 집합입니다.
 */
export function getCustomConfigurableFields(
  config: GraphConfig,
): Partial<GraphConfig["configurable"]> {
  if (!config.configurable) return {};

  const result: Partial<GraphConfig["configurable"]> = {};

  for (const [key, metadataValue] of Object.entries(
    GraphConfigurationMetadata,
  )) {
    if (key in config.configurable) {
      // 메타데이터에서 'hidden'이 아니거나, 명시적으로 포함해야 하는 필드만 결과에 추가합니다.
      if (
        metadataValue.x_open_swe_ui_config.type !== "hidden" ||
        ["apiKeys", "reviewPullNumber", "customFramework"].includes(key)
      ) {
        result[key as keyof GraphConfig["configurable"]] =
          config.configurable[key as keyof GraphConfig["configurable"]];
      }
    }
  }

  return result;
}