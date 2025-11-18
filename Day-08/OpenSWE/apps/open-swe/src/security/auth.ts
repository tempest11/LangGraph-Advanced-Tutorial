import { Auth, HTTPException } from "@langchain/langgraph-sdk/auth";
import {
  verifyGithubUser,
  GithubUser,
  verifyGithubUserId,
} from "@openswe/shared/github/verify-user";
import {
  GITHUB_INSTALLATION_ID,
  GITHUB_INSTALLATION_NAME,
  GITHUB_INSTALLATION_TOKEN_COOKIE,
  GITHUB_TOKEN_COOKIE,
  GITHUB_USER_ID_HEADER,
  GITHUB_USER_LOGIN_HEADER,
  LOCAL_MODE_HEADER,
} from "@openswe/shared/constants";
import { decryptSecret } from "@openswe/shared/crypto";
import { verifyGitHubWebhookOrThrow } from "./github.js";
import { createWithOwnerMetadata, createOwnerFilter } from "./utils.js";
import { LANGGRAPH_USER_PERMISSIONS } from "../constants.js";
import { getGitHubPatFromRequest } from "../utils/github-pat.js";
import { validateApiBearerToken } from "./custom.js";

// TODO: LangGraph SDK에서 내보내기
/**
 * 기본 인증 반환 인터페이스입니다.
 */
export interface BaseAuthReturn {
  is_authenticated?: boolean;
  display_name?: string;
  identity: string;
  permissions: string[];
}

/**
 * 인증 반환 인터페이스입니다.
 */
interface AuthenticateReturn extends BaseAuthReturn {
  metadata: {
    installation_name: string;
  };
}

/**
 * 인증 및 권한 부여를 처리하는 Auth 인스턴스입니다.
 * 로컬 모드, Bearer 토큰, GitHub 웹훅, GitHub PAT, GitHub 앱 등 다양한 인증 방법을 지원합니다.
 */
export const auth = new Auth()
  .authenticate<AuthenticateReturn>(async (request: Request) => {
    const isProd = process.env.NODE_ENV === "production";

    if (request.method === "OPTIONS") {
      return {
        identity: "anonymous",
        permissions: [],
        is_authenticated: false,
        display_name: "CORS Preflight",
        metadata: {
          installation_name: "n/a",
        },
      };
    }

    // 먼저 로컬 모드 확인
    const localModeHeader = request.headers.get(LOCAL_MODE_HEADER);
    const isRunningLocalModeEnv = process.env.OPEN_SWE_LOCAL_MODE === "true";
    if (localModeHeader === "true" && isRunningLocalModeEnv) {
      return {
        identity: "local-user",
        is_authenticated: true,
        display_name: "로컬 사용자",
        metadata: {
          installation_name: "local-mode",
        },
        permissions: LANGGRAPH_USER_PERMISSIONS,
      };
    }

    // Bearer 토큰 인증 (간단한 API 키) — 헤더가 있을 때만
    const authorizationHeader = request.headers.get("authorization");
    if (
      authorizationHeader &&
      authorizationHeader.toLowerCase().startsWith("bearer ")
    ) {
      const token = authorizationHeader.slice(7).trim();
      if (!token) {
        throw new HTTPException(401, { message: "Bearer 토큰이 없습니다." });
      }

      const user = validateApiBearerToken(token);
      if (user) {
        return user;
      }
      throw new HTTPException(401, { message: "잘못된 API 토큰입니다." });
    }

    const encryptionKey = process.env.SECRETS_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error("SECRETS_ENCRYPTION_KEY 환경 변수가 필요합니다.");
    }

    const ghSecretHashHeader = request.headers.get("X-Hub-Signature-256");
    if (ghSecretHashHeader) {
      // 유효한 사용자를 반환하거나 오류를 발생시킵니다.
      return await verifyGitHubWebhookOrThrow(request);
    }

    // GitHub PAT 인증 확인 (평가 등을 위한 간단한 모드)
    const githubPat = getGitHubPatFromRequest(request, encryptionKey);
    if (githubPat && !isProd) {
      const user = await verifyGithubUser(githubPat);
      if (!user) {
        throw new HTTPException(401, {
          message: "잘못된 GitHub PAT입니다.",
        });
      }

      return {
        identity: user.id.toString(),
        is_authenticated: true,
        display_name: user.login,
        metadata: {
          installation_name: "pat-auth",
        },
        permissions: LANGGRAPH_USER_PERMISSIONS,
      };
    }

    // GitHub 앱 인증 모드 (기존 로직)
    const installationNameHeader = request.headers.get(
      GITHUB_INSTALLATION_NAME,
    );
    if (!installationNameHeader) {
      throw new HTTPException(401, {
        message: "GitHub 설치 이름 헤더가 없습니다.",
      });
    }
    const installationIdHeader = request.headers.get(GITHUB_INSTALLATION_ID);
    if (!installationIdHeader) {
      throw new HTTPException(401, {
        message: "GitHub 설치 ID 헤더가 없습니다.",
      });
    }

    // 현재 이 토큰으로 아무것도 하지 않지만, 나중에 문제가 발생할 수 있으므로 존재 여부를 확인합니다.
    const encryptedInstallationToken = request.headers.get(
      GITHUB_INSTALLATION_TOKEN_COOKIE,
    );
    if (!encryptedInstallationToken) {
      throw new HTTPException(401, {
        message: "GitHub 설치 토큰 헤더가 없습니다.",
      });
    }

    const encryptedAccessToken = request.headers.get(GITHUB_TOKEN_COOKIE);
    const decryptedAccessToken = encryptedAccessToken
      ? decryptSecret(encryptedAccessToken, encryptionKey)
      : undefined;
    const decryptedInstallationToken = decryptSecret(
      encryptedInstallationToken,
      encryptionKey,
    );

    let user: GithubUser | undefined;

    if (!decryptedAccessToken) {
      // 사용자 액세스 토큰이 없는 경우 헤더에 사용자 정보가 있는지 확인합니다.
      // 이는 봇이 요청을 생성했음을 나타냅니다.
      const userIdHeader = request.headers.get(GITHUB_USER_ID_HEADER);
      const userLoginHeader = request.headers.get(GITHUB_USER_LOGIN_HEADER);
      if (!userIdHeader || !userLoginHeader) {
        throw new HTTPException(401, {
          message: "Github-User-Id 또는 Github-User-Login 헤더가 없습니다.",
        });
      }
      user = await verifyGithubUserId(
        decryptedInstallationToken,
        Number(userIdHeader),
        userLoginHeader,
      );
    } else {
      // 확인 함수에 전달하기 전에 토큰을 해독해야 합니다.
      user = await verifyGithubUser(decryptedAccessToken);
    }

    if (!user) {
      throw new HTTPException(401, {
        message: "사용자를 찾을 수 없습니다.",
      });
    }

    return {
      identity: user.id.toString(),
      is_authenticated: true,
      display_name: user.login,
      metadata: {
        installation_name: installationNameHeader,
      },
      permissions: LANGGRAPH_USER_PERMISSIONS,
    };
  })

  // 스레드: 메타데이터로 생성 작업
  .on("threads:create", ({ value, user }) =>
    createWithOwnerMetadata(value, user),
  )
  .on("threads:create_run", ({ value, user }) =>
    createWithOwnerMetadata(value, user),
  )

  // 스레드: 읽기, 업데이트, 삭제, 검색 작업
  .on("threads:read", ({ user }) => createOwnerFilter(user))
  .on("threads:update", ({ user }) => createOwnerFilter(user))
  .on("threads:delete", ({ user }) => createOwnerFilter(user))
  .on("threads:search", ({ user }) => createOwnerFilter(user))

  // 어시스턴트: 메타데이터로 생성 작업
  .on("assistants:create", ({ value, user }) =>
    createWithOwnerMetadata(value, user),
  )

  // 어시스턴트: 읽기, 업데이트, 삭제, 검색 작업
  .on("assistants:read", ({ user }) => createOwnerFilter(user))
  .on("assistants:update", ({ user }) => createOwnerFilter(user))
  .on("assistants:delete", ({ user }) => createOwnerFilter(user))
  .on("assistants:search", ({ user }) => createOwnerFilter(user))

  // 저장소: 권한 기반 액세스
  .on("store", ({ user }) => {
    return { owner: user.identity };
  });
