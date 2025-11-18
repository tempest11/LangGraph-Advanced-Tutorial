import { STUDIO_USER_ID } from "./utils.js";
import { LANGGRAPH_USER_PERMISSIONS } from "../constants.js";
import * as bcrypt from "bcrypt";

/**
 * bcrypt를 사용하여 값을 해시합니다.
 * @param value - 해시할 문자열 값.
 * @returns 해시된 문자열.
 */
function bcryptHash(value: string): string {
  // 적절한 보안을 위해 12번의 솔트 라운드를 사용합니다.
  return bcrypt.hashSync(value, 12);
}

/**
 * 환경 변수에서 API 토큰을 가져옵니다.
 * @returns API 토큰 배열.
 */
function getConfiguredApiTokens(): string[] {
  const single = process.env.API_BEARER_TOKEN || "";
  const many = process.env.API_BEARER_TOKENS || ""; // 쉼표로 구분

  const tokens: string[] = [];

  if (single.trim()) {
    tokens.push(single.trim());
  }

  if (many.trim()) {
    for (const t of many.split(",")) {
      const v = t.trim();
      if (v) tokens.push(v);
    }
  }

  return tokens;
}

// 일정한 길이 비교를 위해 미리 구성된 토큰을 해시합니다.
let cachedAllowedTokenHashes: string[] | null = null;

/**
 * 허용된 토큰 해시 배열을 가져옵니다.
 * @returns 허용된 토큰 해시 배열.
 */
function getAllowedTokenHashes(): string[] {
  if (cachedAllowedTokenHashes) {
    return cachedAllowedTokenHashes;
  }

  const tokens = getConfiguredApiTokens();
  cachedAllowedTokenHashes = tokens.map((t) => bcryptHash(t));
  return cachedAllowedTokenHashes;
}

/**
 * API Bearer 토큰의 유효성을 검사합니다.
 * @param token - 유효성을 검사할 토큰.
 * @returns 유효한 경우 사용자 정보 객체, 그렇지 않으면 null.
 */
export function validateApiBearerToken(token: string) {
  const allowed = getAllowedTokenHashes();
  if (allowed.length === 0) {
    // 구성되지 않음; 유효하지 않은 것으로 처리합니다.
    return null;
  }

  // bcrypt를 사용하여 각 허용된 해시와 토큰을 비교합니다.
  const isValid = allowed.some((h) => bcrypt.compareSync(token, h));
  if (isValid) {
    return {
      identity: STUDIO_USER_ID,
      is_authenticated: true,
      display_name: STUDIO_USER_ID,
      metadata: {
        installation_name: "api-key-auth",
      },
      permissions: LANGGRAPH_USER_PERMISSIONS,
    };
  }
  return null;
}
