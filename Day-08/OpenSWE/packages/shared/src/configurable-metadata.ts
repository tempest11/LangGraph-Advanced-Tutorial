/**
 * @file configurable-metadata.ts
 * @description 이 파일은 에이전트 설정 필드의 UI 렌더링을 위한 타입과 인터페이스를 정의합니다.
 * UI 컴포넌트의 종류, 레이블, 기본값, 설명 등 동적으로 설정 가능한 필드를
 * 구성하는 데 필요한 메타데이터 구조를 제공합니다.
 */

// 설정 가능한 필드의 UI 컴포넌트 타입을 정의합니다.
export type ConfigurableFieldUIType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "slider"
  | "select"
  | "json";

/**
 * `select` 타입 필드의 옵션을 위한 인터페이스입니다.
 */
export interface ConfigurableFieldOption {
  label: string; // UI에 표시될 레이블
  value: string; // 실제 값
}

/**
 * 설정 가능한 객체의 필드에 대한 UI 구성 메타데이터입니다.
 */
export type ConfigurableFieldUIMetadata = {
  /**
   * 필드의 레이블입니다. UI에 렌더링될 이름입니다.
   */
  label: string;
  /**
   * UI 컴포넌트의 기본값입니다.
   *
   * @default undefined
   */
  default?: unknown;
  /**
   * 필드의 타입입니다.
   * @default "text"
   */
  type?: ConfigurableFieldUIType;
  /**
   * 필드에 대한 설명입니다. UI 컴포넌트 아래에 렌더링됩니다.
   */
  description?: string;
  /**
   * 필드의 플레이스홀더(placeholder)입니다. UI 컴포넌트 내부에 렌더링됩니다.
   * text, textarea, number, json, select 타입에만 적용됩니다.
   */
  placeholder?: string;
  /**
   * 필드의 옵션 목록입니다. select UI 컴포넌트에서 렌더링될 옵션들입니다.
   * select 타입에만 적용됩니다.
   */
  options?: ConfigurableFieldOption[];
  /**
   * 필드의 최솟값입니다.
   * number 타입에만 적용됩니다.
   */
  min?: number;
  /**
   * 필드의 최댓값입니다.
   * number 타입에만 적용됩니다.
   */
  max?: number;
  /**
   * 필드의 스텝(step) 값입니다. 예를 들어, 슬라이더에서 0.1씩 증가시키고 싶을 때
   * 이 필드를 0.1로 설정합니다.
   * number 타입에만 적용됩니다.
   */
  step?: number;
};