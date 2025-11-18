/**
 * @file allowed-users.ts
 * @description 이 파일은 특정 사용자가 애플리케이션을 사용할 수 있는지 여부를 확인하는
 * 허용 목록(allowlist) 기반의 접근 제어 로직을 구현합니다.
 */

// HACK: API 크레딧에 대한 적절한 지원이 설정될 때까지, 사용자는 Open SWE를 자체 호스팅해야만 합니다.

/**
 * 주어진 사용자 이름이 허용된 사용자인지 확인합니다.
 * @param username - 확인할 GitHub 사용자 이름입니다.
 * @returns {boolean} 사용자가 허용 목록에 있으면 true, 그렇지 않으면 false를 반환합니다.
 */
export function isAllowedUser(username: string): boolean {
  const nodeEnv = process.env.NODE_ENV;
  // 프로덕션 환경이 아닌 경우 모든 사용자를 허용합니다.
  if (nodeEnv !== "production") {
    return true;
  }

  // LangChain 인증으로 제한하는 환경 변수가 설정되었는지 확인합니다.
  const restrictToLangChainAuth =
    process.env.RESTRICT_TO_LANGCHAIN_AUTH === "true" ||
    process.env.NEXT_PUBLIC_RESTRICT_TO_LANGCHAIN_AUTH === "true";
  if (!restrictToLangChainAuth) {
    return true;
  }

  let allowedUsers: string[] = [];
  try {
    // 환경 변수에서 허용된 사용자 목록을 파싱합니다.
    allowedUsers = process.env.NEXT_PUBLIC_ALLOWED_USERS_LIST
      ? JSON.parse(process.env.NEXT_PUBLIC_ALLOWED_USERS_LIST)
      : [];
    if (!allowedUsers.length) {
      return false;
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("허용된 사용자 목록 파싱 실패", error);
    return false;
  }

  // 사용자 이름이 허용 목록에 있는지 확인합니다.
  return allowedUsers.some((u) => u === username);
}