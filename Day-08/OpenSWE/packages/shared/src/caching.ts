/**
 * @file caching.ts
 * @description 이 파일은 캐싱과 관련된 비용 계산 및 데이터 집계를 위한 유틸리티 함수를 제공합니다.
 * 모델 토큰 사용량을 기반으로 캐싱으로 인한 비용 절감액을 계산하고, 여러 모델의 토큰 데이터를
 * 병합하는 리듀서(reducer) 함수를 포함합니다.
 */

import { CacheMetrics, ModelTokenData } from "./open-swe/types.js";

/**
 * 캐시 메트릭을 기반으로 비용 절감액을 계산합니다.
 * @param metrics 캐시 생성, 캐시 읽기, 일반 입출력 토큰 사용량에 대한 메트릭입니다.
 * @returns 총 절감액, 총비용, 총 토큰 수 등 계산된 비용 정보를 담은 객체를 반환합니다.
 */
export function calculateCostSavings(metrics: CacheMetrics): {
  totalSavings: number;
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalOutputTokensCost: number;
} {
  // 모델별 토큰 비용 정의 (백만 토큰당 달러 기준)
  const SONNET_4_BASE_RATE = 3.0 / 1_000_000; // $3 per MTok
  const SONNET_4_OUTPUT_RATE = 15.0 / 1_000_000; // $15 per MTok

  // 캐시 작업에 대한 비용 승수
  const CACHE_WRITE_MULTIPLIER = 1.25;
  const CACHE_READ_MULTIPLIER = 0.1;

  // 캐시 쓰기 비용 계산
  const cacheWriteCost =
    metrics.cacheCreationInputTokens *
    SONNET_4_BASE_RATE *
    CACHE_WRITE_MULTIPLIER;

  // 캐시 읽기 비용 계산
  const cacheReadCost =
    metrics.cacheReadInputTokens * SONNET_4_BASE_RATE * CACHE_READ_MULTIPLIER;

  // 일반 입력 비용 계산
  const regularInputCost = metrics.inputTokens * SONNET_4_BASE_RATE;

  // 총 출력 비용 계산
  const totalOutputTokensCost = metrics.outputTokens * SONNET_4_OUTPUT_RATE;

  // 캐싱을 사용하지 않았을 경우의 총 입력 토큰 및 비용 계산
  const totalInputTokens =
    metrics.cacheCreationInputTokens +
    metrics.cacheReadInputTokens +
    metrics.inputTokens;
  const totalTokens = totalInputTokens + metrics.outputTokens;
  const costWithoutCaching = totalInputTokens * SONNET_4_BASE_RATE;

  // 캐싱을 사용했을 때의 실제 총비용
  const actualCost = cacheWriteCost + cacheReadCost + regularInputCost;

  return {
    totalSavings: costWithoutCaching - actualCost, // 총 절감액
    totalCost: actualCost, // 실제 총비용
    totalTokens, // 총 사용 토큰
    totalInputTokens, // 총 입력 토큰
    totalOutputTokens: metrics.outputTokens, // 총 출력 토큰
    totalOutputTokensCost, // 총 출력 비용
  };
}

/**
 * 모델 토큰 데이터 배열을 병합하는 리듀서 함수입니다.
 * 동일한 모델에 대한 데이터를 합산하여 중복을 제거합니다.
 * @param state 현재 상태의 `ModelTokenData` 배열입니다.
 * @param update 새로 추가될 `ModelTokenData` 배열입니다.
 * @returns 병합된 `ModelTokenData` 배열을 반환합니다.
 */
export function tokenDataReducer(
  state: ModelTokenData[] | undefined,
  update: ModelTokenData[],
): ModelTokenData[] {
  if (!state) {
    return update;
  }

  // 모델별로 데이터를 병합하기 위해 Map을 생성합니다.
  const modelMap = new Map<string, ModelTokenData>();

  // 기존 상태 데이터를 Map에 추가합니다.
  for (const data of state) {
    modelMap.set(data.model, { ...data });
  }

  // 업데이트 데이터를 기존 데이터와 병합합니다.
  for (const data of update) {
    const existing = modelMap.get(data.model);
    if (existing) {
      // 동일한 모델에 대한 메트릭을 합산합니다.
      modelMap.set(data.model, {
        model: data.model,
        cacheCreationInputTokens:
          existing.cacheCreationInputTokens + data.cacheCreationInputTokens,
        cacheReadInputTokens:
          existing.cacheReadInputTokens + data.cacheReadInputTokens,
        inputTokens: existing.inputTokens + data.inputTokens,
        outputTokens: existing.outputTokens + data.outputTokens,
      });
    } else {
      // 새로운 모델 데이터를 Map에 추가합니다.
      modelMap.set(data.model, { ...data });
    }
  }

  // Map을 다시 배열로 변환하여 반환합니다.
  return Array.from(modelMap.values());
}