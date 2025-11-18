/**
 * @file thread-store.ts
 * @description
 * 스레드 UI 상태를 관리하는 간소화된 Zustand 스토어.
 * 데이터 캐싱은 SWR 훅에서 직접 처리하며, 이 스토어는 UI 상태만 관리합니다.
 */

import { create } from "zustand";

/**
 * 스레드 스토어 상태 인터페이스
 * @description UI 상태만 관리 (데이터 캐싱은 SWR에서 처리)
 */
export interface ThreadStoreState {
  /** 현재 활성 스레드 ID (UI 전용) */
  activeThreadId: string | null;
  /** 전역 폴링 활성화 여부 (UI 전용) */
  isGlobalPollingEnabled: boolean;
  /** 활성 스레드 설정 */
  setActiveThread: (threadId: string | null) => void;
  /** 전역 폴링 설정 */
  setGlobalPolling: (enabled: boolean) => void;
}

/**
 * @store useThreadStore
 * @description
 * 스레드 UI 상태 관리를 위한 최소한의 Zustand 스토어.
 * 모든 데이터 캐싱은 성능과 일관성을 위해 SWR로 이동되었습니다.
 *
 * @features
 * - 활성 스레드 ID 추적
 * - 전역 폴링 컨트롤
 * - 최소한의 UI 상태만 관리
 *
 * @example
 * ```tsx
 * const { activeThreadId, setActiveThread } = useThreadStore();
 * setActiveThread('thread-123');
 * ```
 */
export const useThreadStore = create<ThreadStoreState>((set) => ({
  activeThreadId: null,
  isGlobalPollingEnabled: true,

  setActiveThread: (threadId) => {
    set({ activeThreadId: threadId });
  },

  setGlobalPolling: (enabled) => {
    set({ isGlobalPollingEnabled: enabled });
  },
}));

/** 활성 스레드 ID를 선택하는 훅 */
export const useActiveThreadId = () =>
  useThreadStore((state) => state.activeThreadId);

/** 전역 폴링 활성화 여부를 선택하는 훅 */
export const useGlobalPollingEnabled = () =>
  useThreadStore((state) => state.isGlobalPollingEnabled);
