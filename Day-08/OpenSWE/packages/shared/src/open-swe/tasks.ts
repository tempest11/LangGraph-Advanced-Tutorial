/**
 * @file tasks.ts
 * @description 이 파일은 에이전트의 작업(Task) 및 계획(Plan)을 관리하기 위한 유틸리티 함수들을 제공합니다.
 * 새로운 작업을 생성하고, 기존 작업의 계획을 수정하며, 작업 항목을 완료 처리하는 등의
 * 핵심 로직을 포함합니다. `TaskPlan` 객체는 불변(immutable)하게 관리됩니다.
 */

import { v4 as uuidv4 } from "uuid";
import { PlanItem, Task, TaskPlan, PlanRevision } from "./types.js";

/**
 * 제공된 계획 항목들로 새로운 작업을 생성합니다.
 * 기존 TaskPlan에 추가하거나 새로운 TaskPlan을 생성할 수 있습니다.
 *
 * @param request 이 작업을 시작하게 한 원본 사용자 요청 텍스트입니다.
 * @param title 작업의 제목입니다.
 * @param planItems 새 작업에 포함될 계획 항목들입니다.
 * @param options 선택적 옵션 객체입니다.
 * @param options.parentTaskId 이 작업이 다른 작업에서 파생된 경우 부모 작업의 ID입니다.
 * @param options.existingTaskPlan 새 작업을 추가할 기존 TaskPlan입니다.
 * @returns {TaskPlan} 새 작업이 추가된 업데이트된 TaskPlan을 반환합니다.
 */
export function createNewTask(
  request: string,
  title: string,
  planItems: PlanItem[],
  options?: {
    existingTaskPlan?: TaskPlan;
    parentTaskId?: string;
  },
): TaskPlan {
  const { existingTaskPlan, parentTaskId } = options ?? {};

  // 초기 계획 리비전(revision)을 생성합니다.
  const initialRevision: PlanRevision = {
    revisionIndex: 0,
    plans: planItems,
    createdAt: Date.now(),
    createdBy: "agent",
  };

  // 새로운 작업을 생성합니다.
  const newTask: Task = {
    id: uuidv4(),
    taskIndex: existingTaskPlan ? existingTaskPlan.tasks.length : 0,
    request,
    title,
    createdAt: Date.now(),
    completed: false,
    planRevisions: [initialRevision],
    activeRevisionIndex: 0,
    parentTaskId,
  };

  // 기존 작업 계획이 있으면 새 작업을 추가합니다.
  if (existingTaskPlan) {
    return {
      tasks: [...existingTaskPlan.tasks, newTask],
      activeTaskIndex: existingTaskPlan.tasks.length, // 새 작업을 활성 작업으로 설정합니다.
    };
  }

  // 그렇지 않으면 이 작업만 포함하는 새로운 작업 계획을 생성합니다.
  return {
    tasks: [newTask],
    activeTaskIndex: 0,
  };
}

/**
 * 새로운 리비전을 생성하여 기존 작업의 계획 항목들을 업데이트합니다.
 *
 * @param taskPlan 현재 작업 계획입니다.
 * @param taskId 업데이트할 작업의 ID입니다.
 * @param planItems 새로운 계획 항목들입니다.
 * @param createdBy 이 리비전을 생성한 주체입니다 ('agent' 또는 'user').
 * @returns {TaskPlan} 새 리비전이 포함된 업데이트된 TaskPlan을 반환합니다.
 * @throws {Error} 작업 ID가 존재하지 않을 경우 에러를 발생시킵니다.
 */
export function updateTaskPlanItems(
  taskPlan: TaskPlan,
  taskId: string,
  planItems: PlanItem[],
  createdBy: "agent" | "user" = "agent",
): TaskPlan {
  // 업데이트할 작업을 찾습니다.
  const taskIndex = taskPlan.tasks.findIndex((task) => task.id === taskId);

  if (taskIndex === -1) {
    throw new Error(`ID가 ${taskId}인 작업을 찾을 수 없습니다.`);
  }

  const task = taskPlan.tasks[taskIndex];

  // 업데이트된 계획 항목들로 새로운 리비전을 생성합니다.
  const newRevision: PlanRevision = {
    revisionIndex: task.planRevisions.length,
    plans: planItems,
    createdAt: Date.now(),
    createdBy,
  };

  // 새 리비전으로 업데이트된 작업을 생성합니다.
  const updatedTask: Task = {
    ...task,
    planRevisions: [...task.planRevisions, newRevision],
    activeRevisionIndex: task.planRevisions.length, // 새 리비전을 활성 상태로 설정합니다.
  };

  // 업데이트된 작업으로 새로운 작업 배열을 생성합니다.
  const updatedTasks = [...taskPlan.tasks];
  updatedTasks[taskIndex] = updatedTask;

  // 업데이트된 작업 계획을 반환합니다.
  return {
    ...taskPlan,
    tasks: updatedTasks,
  };
}

/**
 * 작업 계획의 활성 작업에 풀 리퀘스트(PR) 번호를 추가합니다.
 *
 * @param taskPlan 업데이트할 작업 계획입니다.
 * @param pullRequestNumber 추가할 풀 리퀘스트 번호입니다.
 * @returns {TaskPlan} 업데이트된 작업 계획을 반환합니다.
 * @throws {Error} 작업 ID를 찾을 수 없는 경우 에러를 발생시킵니다.
 */
export function addPullRequestNumberToActiveTask(
  taskPlan: TaskPlan,
  pullRequestNumber: number,
): TaskPlan {
  const activeTaskIndex = taskPlan.activeTaskIndex;
  const activeTask = taskPlan.tasks[activeTaskIndex];

  if (!activeTask) {
    throw new Error(`인덱스 ${activeTaskIndex}의 작업을 찾을 수 없습니다.`);
  }

  // 완료로 표시된 업데이트된 작업을 생성합니다.
  const updatedTask: Task = {
    ...activeTask,
    pullRequestNumber,
  };

  // 업데이트된 작업으로 새로운 작업 배열을 생성합니다.
  const updatedTasks = [...taskPlan.tasks];
  updatedTasks[activeTaskIndex] = updatedTask;

  // 업데이트된 작업 계획을 반환합니다.
  return {
    ...taskPlan,
    tasks: updatedTasks,
  };
}

/**
 * 작업 계획의 활성 작업에서 풀 리퀘스트 번호를 가져옵니다.
 *
 * @param taskPlan 작업 계획입니다.
 * @returns {number | undefined} 활성 작업의 풀 리퀘스트 번호, 또는 활성 작업에 풀 리퀘스트 번호가 없으면 undefined를 반환합니다.
 */
export function getPullRequestNumberFromActiveTask(
  taskPlan: TaskPlan,
): number | undefined {
  const activeTask = getActiveTask(taskPlan);
  return activeTask.pullRequestNumber;
}

/**
 * TaskPlan에서 활성 작업을 가져오는 헬퍼 함수입니다.
 *
 * @param taskPlan 작업 계획입니다.
 * @returns {Task} 현재 활성 상태인 작업.
 * @throws {Error} 작업이 없을 경우 에러를 발생시킵니다.
 */
export function getActiveTask(taskPlan: TaskPlan): Task {
  if (taskPlan.tasks.length === 0) {
    throw new Error("사용 가능한 작업이 없습니다.");
  }

  return taskPlan.tasks[taskPlan.activeTaskIndex];
}

/**
 * 활성 작업에 대한 활성 계획 항목들을 가져오는 헬퍼 함수입니다.
 *
 * @param taskPlan 작업 계획입니다.
 * @returns {PlanItem[]} 현재 활성 상태인 계획 항목들의 배열.
 * @throws {Error} 작업이나 계획 리비전이 없을 경우 에러를 발생시킵니다.
 */
export function getActivePlanItems(taskPlan: TaskPlan): PlanItem[] {
  const activeTask = getActiveTask(taskPlan);

  if (activeTask.planRevisions.length === 0) {
    throw new Error("활성 작업에 대한 계획 리비전이 없습니다.");
  }

  return activeTask.planRevisions[activeTask.activeRevisionIndex].plans;
}

/**
 * 특정 계획 항목을 완료로 표시하고 요약을 추가합니다.
 * 이 작업은 현재 활성 리비전을 직접 수정하며 새로운 리비전을 생성하지 않습니다.
 *
 * @param taskPlan 현재 작업 계획입니다.
 * @param taskId 계획 항목을 포함하는 작업의 ID입니다.
 * @param planItemIndex 완료로 표시할 계획 항목의 `index` 속성입니다.
 * @param summary 완료된 계획 항목의 선택적 요약입니다. undefined인 경우 기존 요약이 유지됩니다.
 * @returns {TaskPlan} 업데이트된 TaskPlan.
 * @throws {Error} 작업이나 계획 항목을 찾을 수 없거나 활성 리비전이 없는 경우 에러를 발생시킵니다.
 */
export function completePlanItem(
  taskPlan: TaskPlan,
  taskId: string,
  planItemIndex: number,
  summary?: string,
): TaskPlan {
  const taskIndexInPlan = taskPlan.tasks.findIndex(
    (task) => task.id === taskId,
  );

  if (taskIndexInPlan === -1) {
    throw new Error(`작업 계획에서 ID가 ${taskId}인 작업을 찾을 수 없습니다.`);
  }

  const originalTask = taskPlan.tasks[taskIndexInPlan];

  const activeRevisionIndex = originalTask.activeRevisionIndex;

  if (
    !originalTask.planRevisions ||
    activeRevisionIndex < 0 ||
    activeRevisionIndex >= originalTask.planRevisions.length
  ) {
    throw new Error(
      `작업 ${taskId}에 대한 활성 리비전 인덱스(${activeRevisionIndex})가 유효하지 않습니다.`,
    );
  }

  const originalActiveRevision =
    originalTask.planRevisions[activeRevisionIndex];

  if (!originalActiveRevision) {
    throw new Error(
      `작업 ${taskId}에 대한 활성 리비전(인덱스 ${activeRevisionIndex})을 찾을 수 없습니다.`,
    );
  }

  const planItemToUpdateActualIndexInPlansArray =
    originalActiveRevision.plans.findIndex(
      (item) => item.index === planItemIndex,
    );

  if (planItemToUpdateActualIndexInPlansArray === -1) {
    throw new Error(
      `작업 ${taskId}의 활성 리비전(인덱스 ${activeRevisionIndex})에서 .index가 ${planItemIndex}인 계획 항목을 찾을 수 없습니다.`,
    );
  }

  // 특정 항목이 업데이트된 새로운 'plans' 배열을 생성합니다.
  const updatedPlansForRevision = originalActiveRevision.plans.map((item) => {
    if (item.index === planItemIndex) {
      const newSummary = summary !== undefined ? summary : item.summary;
      return { ...item, completed: true, summary: newSummary };
    }
    return item;
  });

  // 업데이트된 'plans'를 포함하는 새로운 'PlanRevision' 객체를 생성합니다.
  const updatedActiveRevision: PlanRevision = {
    ...originalActiveRevision,
    plans: updatedPlansForRevision,
  };

  // 활성 리비전을 업데이트된 것으로 교체한 새로운 'planRevisions' 배열을 생성합니다.
  const updatedPlanRevisions = [...originalTask.planRevisions];
  updatedPlanRevisions[activeRevisionIndex] = updatedActiveRevision;

  // 업데이트된 'planRevisions'를 포함하는 새로운 'Task' 객체를 생성합니다.
  const updatedTask: Task = {
    ...originalTask,
    planRevisions: updatedPlanRevisions,
  };

  // 업데이트된 작업으로 TaskPlan의 새로운 'tasks' 배열을 생성합니다.
  const updatedTasksArray = [...taskPlan.tasks];
  updatedTasksArray[taskIndexInPlan] = updatedTask;

  // 새로운 TaskPlan 객체를 반환합니다.
  return {
    ...taskPlan,
    tasks: updatedTasksArray,
  };
}

/**
 * 작업을 완료로 표시합니다.
 *
 * @param taskPlan 현재 작업 계획입니다.
 * @param taskId 완료로 표시할 작업의 ID입니다.
 * @param summary 완료된 작업의 선택적 요약입니다.
 * @returns {TaskPlan} 업데이트된 TaskPlan.
 */
export function completeTask(
  taskPlan: TaskPlan,
  taskId: string,
  summary?: string,
): TaskPlan {
  const taskIndex = taskPlan.tasks.findIndex((task) => task.id === taskId);

  if (taskIndex === -1) {
    throw new Error(`ID가 ${taskId}인 작업을 찾을 수 없습니다.`);
  }

  const task = taskPlan.tasks[taskIndex];

  // 완료로 표시된 업데이트된 작업을 생성합니다.
  const updatedTask: Task = {
    ...task,
    completed: true,
    completedAt: Date.now(),
    summary,
  };

  // 업데이트된 작업으로 새로운 작업 배열을 생성합니다.
  const updatedTasks = [...taskPlan.tasks];
  updatedTasks[taskIndex] = updatedTask;

  // 업데이트된 작업 계획을 반환합니다.
  return {
    ...taskPlan,
    tasks: updatedTasks,
  };
}