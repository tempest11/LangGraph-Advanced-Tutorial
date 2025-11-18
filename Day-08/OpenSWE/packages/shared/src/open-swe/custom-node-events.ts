/**
 * @file custom-node-events.ts
 * @description 이 파일은 에이전트 실행 중 발생하는 커스텀 노드 이벤트를 정의하고 처리하는 데 사용됩니다.
 * 특히 초기화 단계(샌드박스 생성, 저장소 클론 등)의 상태를 UI에 표시하기 위한 타입과 헬퍼 함수를 제공합니다.
 */

// 커스텀 노드 이벤트의 타입을 정의합니다.
export type CustomNodeEvent = {
  /**
   * 이벤트가 발생한 노드의 UUID입니다.
   */
  nodeId: string;
  /**
   * 이벤트와 관련된 액션의 UUID입니다.
   */
  actionId: string;
  /**
   * 액션의 이름입니다. (예: "Cloning repository")
   */
  action: string;
  /**
   * 이벤트 생성 시간입니다.
   */
  createdAt: string;
  /**
   * 이벤트의 상세 데이터입니다.
   */
  data: {
    status: "pending" | "success" | "error" | "skipped";
    [key: string]: unknown;
  };
};

/**
 * 주어진 객체가 `CustomNodeEvent` 타입인지 확인하는 타입 가드 함수입니다.
 * @param event - 검사할 객체입니다.
 * @returns {boolean} `CustomNodeEvent` 타입이면 true를 반환합니다.
 */
export function isCustomNodeEvent(event: unknown): event is CustomNodeEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "nodeId" in event &&
    "actionId" in event &&
    "action" in event &&
    "data" in event &&
    "createdAt" in event
  );
}

// 초기화 및 주요 단계에 대한 노드 ID 상수입니다.
export const INITIALIZE_NODE_ID = "initialize";
export const ACCEPTED_PLAN_NODE_ID = "accepted-plan";
export const REQUEST_HELP_NODE_ID = "request-help";

// 에이전트 초기화 과정의 단계들을 정의한 배열입니다.
export const INIT_STEPS = [
  "Resuming sandbox",
  "Creating sandbox",
  "Cloning repository",
  "Pulling latest changes",
  "Configuring git user",
  "Checking out branch",
  "Generating codebase tree",
];

// UI에 표시될 각 단계의 상태를 정의하는 타입입니다.
export type Step = {
  name: string;
  status: "waiting" | "generating" | "success" | "error" | "skipped";
  error?: string;
};

/**
 * `CustomNodeEvent` 배열을 UI에 렌더링하기 위한 `Step` 객체 배열로 매핑합니다.
 * 건너뛴(skipped) 단계는 결과에서 필터링됩니다.
 * @param events - 변환할 `CustomNodeEvent`의 배열입니다.
 * @returns {Step[]} UI 렌더링에 적합한 `Step` 객체의 배열입니다.
 */
export function mapCustomEventsToSteps(events: CustomNodeEvent[]) {
  return INIT_STEPS.flatMap((stepName) => {
    // 각 단계 이름에 해당하는 가장 최신 이벤트를 찾습니다.
    const event = [...events]
      .filter((e) => e.action === stepName)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];
    if (!event) return [];

    // 이벤트 상태에 따라 UI 상태를 매핑합니다.
    if (event.data.status === "skipped")
      return { name: stepName, status: "skipped" as const };
    if (event.data.status === "pending")
      return { name: stepName, status: "generating" as const };
    if (event.data.status === "success")
      return { name: stepName, status: "success" as const };
    if (event.data.status === "error")
      return {
        name: stepName,
        status: "error" as const,
        error:
          typeof event.data.error === "string" ? event.data.error : undefined,
      };
    return [];
  }).filter((step) => step.status !== "skipped"); // 건너뛴 단계는 UI에 표시하지 않습니다.
}