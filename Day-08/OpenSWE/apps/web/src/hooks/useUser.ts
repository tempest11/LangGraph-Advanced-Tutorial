/**
 * @file useUser.ts
 * @description
 * 현재 로그인한 사용자 정보를 관리하는 커스텀 훅.
 * SWR을 사용하여 사용자 데이터를 캐싱하고 자동 갱신합니다.
 */

import useSWR from "swr";

/** GitHub 사용자 데이터 */
interface UserData {
  /** GitHub 사용자명 */
  login: string;
  /** 아바타 이미지 URL */
  avatar_url: string;
  /** GitHub 프로필 URL */
  html_url: string;
  /** 사용자 이름 (선택사항) */
  name: string | null;
  /** 이메일 주소 (선택사항) */
  email: string | null;
}

/** API 응답 형식 */
interface UserResponse {
  user: UserData;
}

interface UseUserResult {
  /** 사용자 데이터 */
  user: UserData | null;
  /** 로딩 상태 */
  isLoading: boolean;
  /** 에러 */
  error: Error | null;
  /** 데이터 재조회 함수 */
  mutate: () => void;
}

/**
 * 사용자 정보를 API에서 조회
 */
async function fetchUser(): Promise<UserData> {
  const response = await fetch("/api/auth/user");
  if (!response.ok) {
    throw new Error("Failed to fetch user data");
  }
  const data: UserResponse = await response.json();
  return data.user;
}

/**
 * @hook useUser
 * @description
 * 현재 인증된 사용자의 GitHub 정보를 가져오고 관리하는 커스텀 훅.
 * SWR을 사용하여 자동으로 캐싱 및 재검증을 수행합니다.
 *
 * @features
 * - `/api/auth/user` 엔드포인트를 통한 사용자 정보 조회
 * - SWR 기반 자동 캐싱 및 재검증
 * - 로딩/에러 상태 관리
 *
 * @example
 * ```tsx
 * const { user, isLoading, error } = useUser();
 *
 * if (isLoading) return <div>Loading...</div>;
 * if (error) return <div>Error loading user</div>;
 * if (!user) return null;
 *
 * return <div>{user.login}</div>;
 * ```
 */
export function useUser(): UseUserResult {
  const { data, error, isLoading, mutate } = useSWR<UserData>(
    "user",
    fetchUser,
  );

  return { user: data || null, isLoading, error, mutate };
}
