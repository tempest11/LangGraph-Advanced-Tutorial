/**
 * @file verify-user.ts
 * @description GitHub 사용자 인증 토큰 또는 ID의 유효성을 검증하는 함수들을 제공합니다.
 */

import { Octokit } from "@octokit/rest";
import { Endpoints } from "@octokit/types";

// GitHub 사용자 객체의 타입을 정의합니다.
export type GithubUser = Endpoints["GET /user"]["response"]["data"];

/**
 * GitHub 사용자 접근 토큰을 검증합니다.
 * @param accessToken - 검증할 GitHub 사용자 접근 토큰입니다.
 * @returns {Promise<GithubUser | undefined>} 토큰이 유효하면 사용자 객체를, 그렇지 않으면 undefined를 반환하는 프로미스.
 */
export async function verifyGithubUser(
  accessToken: string,
): Promise<GithubUser | undefined> {
  if (!accessToken) {
    return undefined;
  }

  try {
    // Octokit 클라이언트를 토큰으로 인증합니다.
    const octokit = new Octokit({ auth: accessToken });
    // 인증된 사용자 정보를 가져옵니다.
    const { data: user } = await octokit.users.getAuthenticated();
    if (!user || !user.login) {
      return undefined;
    }
    return user;
  } catch {
    // 오류 발생 시 (예: 토큰 만료) undefined를 반환합니다.
    return undefined;
  }
}

/**
 * 앱 설치 토큰을 사용하여 GitHub 사용자 ID를 검증합니다.
 * 제공된 사용자 ID가 유효하고, 제공된 로그인 이름이 실제 사용자의 로그인 이름과 일치하는지 확인합니다.
 * @param installationToken - GitHub 설치 토큰입니다.
 * @param userId - 검증할 GitHub 사용자 ID입니다.
 * @param userLogin - 검증할 GitHub 사용자 로그인 이름입니다.
 * @returns {Promise<GithubUser | undefined>} 사용자가 유효하면 사용자 객체를, 그렇지 않으면 undefined를 반환하는 프로미스.
 */
export async function verifyGithubUserId(
  installationToken: string,
  userId: number,
  userLogin: string,
): Promise<GithubUser | undefined> {
  try {
    const octokit = new Octokit({ auth: installationToken });
    // ID로 사용자 정보를 가져옵니다.
    const { data: user } = await octokit.users.getById({ account_id: userId });
    if (!user || !user.login) {
      return undefined;
    }
    // 가져온 사용자의 로그인 이름이 제공된 이름과 일치하는지 확인합니다.
    if (user.login !== userLogin) {
      return undefined;
    }
    return user;
  } catch {
    return undefined;
  }
}