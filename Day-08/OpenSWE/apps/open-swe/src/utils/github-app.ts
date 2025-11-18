/**
 * @file github-app.ts
 * @description
 * GitHub App 인증 및 설치 토큰 관리 클래스를 제공합니다.
 * GitHub App API와의 상호작용을 담당합니다.
 */

import { App } from "@octokit/app";
import { Octokit } from "@octokit/core";

/**
 * 문자열의 개행 문자를 `\\n`으로 바꿉니다.
 * @param str - 변환할 문자열
 * @returns 변환된 문자열
 */
const replaceNewlinesWithBackslashN = (str: string) =>
  str.replace(/\n/g, "\\n");

/**
 * GitHub 앱과의 상호 작용을 관리하는 클래스입니다.
 * 앱 인증, 설치 토큰 가져오기 등의 기능을 제공합니다.
 */
export class GitHubApp {
  app: App;

  constructor() {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
      ? replaceNewlinesWithBackslashN(process.env.GITHUB_APP_PRIVATE_KEY)
      : undefined;
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!appId || !privateKey || !webhookSecret) {
      throw new Error(
        "GitHub 앱 ID, 개인 키 또는 웹훅 시크릿이 구성되지 않았습니다.",
      );
    }

    this.app = new App({
      appId,
      privateKey,
      webhooks: {
        secret: webhookSecret,
      },
    });
  }

  /**
   * 특정 설치에 대한 Octokit 인스턴스를 가져옵니다.
   * @param installationId - GitHub 앱 설치 ID.
   * @returns Octokit 인스턴스.
   */
  async getInstallationOctokit(installationId: number): Promise<Octokit> {
    return await this.app.getInstallationOctokit(installationId);
  }

  /**
   * 특정 설치에 대한 액세스 토큰을 가져옵니다.
   * @param installationId - GitHub 앱 설치 ID.
   * @returns 토큰과 만료 시간을 포함하는 객체.
   */
  async getInstallationAccessToken(installationId: number): Promise<{
    token: string;
    expiresAt: string;
  }> {
    const octokit = await this.app.getInstallationOctokit(installationId);

    // 설치 액세스 토큰은 auth 속성에서 사용할 수 있습니다.
    const auth = (await octokit.auth({
      type: "installation",
    })) as any;

    return {
      token: auth.token,
      expiresAt: auth.expiresAt,
    };
  }
}
