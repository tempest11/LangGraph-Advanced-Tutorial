import { v4 as uuidv4 } from "uuid";
import { createLogger, LogLevel } from "../../utils/logger.js";
import { GitHubApp } from "../../utils/github-app.js";
import { isAllowedUser } from "@openswe/shared/github/allowed-users";
import { HumanMessage } from "@langchain/core/messages";
import { ManagerGraphUpdate } from "@openswe/shared/open-swe/manager/types";
import { RequestSource } from "../../constants.js";
import { getOpenSweAppUrl } from "../../utils/url-helpers.js";
import { createRunFromWebhook, createDevMetadataComment } from "./utils.js";
import { GraphConfig } from "@openswe/shared/open-swe/types";
import { Octokit } from "@octokit/core";

/**
 * 웹훅 핸들러 컨텍스트 인터페이스입니다.
 */
export interface WebhookHandlerContext {
  installationId: number;
  octokit: Octokit;
  token: string;
  owner: string;
  repo: string;
  userLogin: string;
  userId: number;
}

/**
 * 실행 인수 인터페이스입니다.
 */
export interface RunArgs {
  runInput: ManagerGraphUpdate;
  configurable?: Partial<GraphConfig["configurable"]>;
}

/**
 * 댓글 설정 인터페이스입니다.
 */
export interface CommentConfiguration {
  issueNumber: number;
  message: string;
}

/**
 * 웹훅 핸들러의 기본 클래스입니다.
 * 모든 웹훅 핸들러는 이 클래스를 상속받아 공통 기능을 사용합니다.
 */
export class WebhookHandlerBase {
  protected logger: ReturnType<typeof createLogger>;
  protected githubApp: GitHubApp;

  constructor(loggerName: string) {
    this.logger = createLogger(LogLevel.INFO, loggerName);
    this.githubApp = new GitHubApp();
  }

  /**
   * 설치 및 사용자 유효성 검사를 통해 웹훅 컨텍스트를 설정하고 유효성을 검사합니다.
   * @param payload - 웹훅 페이로드.
   * @returns 웹훅 핸들러 컨텍스트 또는 null.
   */
  protected async setupWebhookContext(
    payload: any,
  ): Promise<WebhookHandlerContext | null> {
    const installationId = payload.installation?.id;
    if (!installationId) {
      this.logger.error("웹훅 페이로드에서 설치 ID를 찾을 수 없습니다.");
      return null;
    }

    if (!isAllowedUser(payload.sender.login)) {
      this.logger.error("사용자가 허용된 조직의 구성원이 아닙니다.", {
        username: payload.sender.login,
      });
      return null;
    }

    const [octokit, { token }] = await Promise.all([
      this.githubApp.getInstallationOctokit(installationId),
      this.githubApp.getInstallationAccessToken(installationId),
    ]);

    return {
      installationId,
      octokit,
      token,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      userLogin: payload.sender.login,
      userId: payload.sender.id,
    };
  }

  /**
   * 제공된 구성으로 웹훅에서 실행을 생성합니다.
   * @param context - 웹훅 핸들러 컨텍스트.
   * @param args - 실행 인수.
   * @returns 실행 ID와 스레드 ID.
   */
  protected async createRun(
    context: WebhookHandlerContext,
    args: RunArgs,
  ): Promise<{ runId: string; threadId: string }> {
    const { runId, threadId } = await createRunFromWebhook({
      installationId: context.installationId,
      installationToken: context.token,
      userId: context.userId,
      userLogin: context.userLogin,
      installationName: context.owner,
      runInput: args.runInput,
      configurable: args.configurable || {},
    });

    this.logger.info("GitHub 웹훅에서 새 실행을 생성했습니다.", {
      threadId,
      runId,
    });

    return { runId, threadId };
  }

  /**
   * 제공된 구성으로 이슈/PR에 댓글을 생성합니다.
   * @param context - 웹훅 핸들러 컨텍스트.
   * @param config - 댓글 설정.
   * @param runId - 실행 ID.
   * @param threadId - 스레드 ID.
   */
  protected async createComment(
    context: WebhookHandlerContext,
    config: CommentConfiguration,
    runId: string,
    threadId: string,
  ): Promise<void> {
    this.logger.info("댓글 생성 중...");

    const appUrl = getOpenSweAppUrl(threadId);
    const appUrlCommentText = appUrl
      ? `Open SWE에서 실행 보기 [여기](${appUrl}) (@${context.userLogin}님만 이 URL을 사용할 수 있습니다.)`
      : "";

    const fullMessage = `${config.message}\n\n${appUrlCommentText}\n\n${createDevMetadataComment(runId, threadId)}`;

    await context.octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: context.owner,
        repo: context.repo,
        issue_number: config.issueNumber,
        body: fullMessage,
      },
    );
  }

  /**
   * 제공된 내용과 요청 소스로 HumanMessage를 생성합니다.
   * @param content - 메시지 내용.
   * @param requestSource - 요청 소스.
   * @param additionalKwargs - 추가 키워드 인수.
   * @returns 생성된 HumanMessage.
   */
  protected createHumanMessage(
    content: string,
    requestSource: RequestSource,
    additionalKwargs: Record<string, any> = {},
  ): HumanMessage {
    return new HumanMessage({
      id: uuidv4(),
      content,
      additional_kwargs: {
        requestSource,
        ...additionalKwargs,
      },
    });
  }

  /**
   * 모든 웹훅 핸들러에서 오류를 일관되게 처리합니다.
   * @param error - 오류 객체.
   * @param context - 오류가 발생한 컨텍스트.
   */
  protected handleError(error: any, context: string): void {
    this.logger.error(`${context} 처리 중 오류 발생:`, error);
  }
}
