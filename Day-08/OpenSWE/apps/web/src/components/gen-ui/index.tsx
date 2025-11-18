/**
 * @file gen-ui/index.tsx
 * @description
 * AI 에이전트가 생성하는 UI 컴포넌트들의 중앙 export 파일.
 * 각 컴포넌트는 특정 에이전트 단계(step)와 매핑되어 있으며,
 * 동적으로 렌더링하기 위한 키-값 맵 구조를 제공합니다.
 *
 * **매핑 구조:**
 * - "action-step": 에이전트가 도구를 실행하는 단계
 * - "initialize-step": 작업 초기화 단계
 * - "push-changes": Git push 단계
 * - "replanning-step": 계획 재수립 단계
 * - "task-summary": 작업 완료 요약 단계
 *
 * **사용 방법:**
 * ```tsx
 * import genUiComponents from '@/components/gen-ui';
 * const Component = genUiComponents[stepType];
 * return <Component {...props} />;
 * ```
 */

import { ActionStep } from "./action-step";
import { InitializeStep } from "./initialize-step";
import { PushChanges } from "./push-changes";
import { ReplanningStep } from "./replanning-step";
import { TaskSummary } from "./task-summary";

export default {
  "action-step": ActionStep,
  "initialize-step": InitializeStep,
  "push-changes": PushChanges,
  "replanning-step": ReplanningStep,
  "task-summary": TaskSummary,
};
