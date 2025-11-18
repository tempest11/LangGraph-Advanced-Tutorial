/**
 * LangGraph Studio 사용자의 ID입니다.
 */
export const STUDIO_USER_ID = "langgraph-studio-user";

/**
 * 사용자가 Studio 사용자인지 확인하는 헬퍼 함수입니다.
 * @param userIdentity - 확인할 사용자 ID.
 * @returns 사용자가 Studio 사용자인 경우 true, 그렇지 않으면 false.
 */
export function isStudioUser(userIdentity: string): boolean {
  return userIdentity === STUDIO_USER_ID;
}

/**
 * 소유자 필터링만 필요한 작업을 위한 헬퍼 함수입니다.
 * @param user - 사용자 정보 객체.
 * @returns 소유자 필터 객체 또는 undefined.
 */
export function createOwnerFilter(user: { identity: string }) {
  if (isStudioUser(user.identity)) {
    return;
  }
  return { owner: user.identity };
}

/**
 * 메타데이터를 설정하는 생성 작업을 위한 헬퍼 함수입니다.
 * @param value - 메타데이터를 추가할 값.
 * @param user - 사용자 정보 객체.
 * @returns 소유자 필터 객체 또는 undefined.
 */
export function createWithOwnerMetadata(
  value: any,
  user: { identity: string; metadata: { installation_name: string } },
) {
  if (isStudioUser(user.identity)) {
    return;
  }

  value.metadata ??= {};
  value.metadata.owner = user.identity;
  value.metadata.installation_name = user.metadata.installation_name;
  return { owner: user.identity };
}
