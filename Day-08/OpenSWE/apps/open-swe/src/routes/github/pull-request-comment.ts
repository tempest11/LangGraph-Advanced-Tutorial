import {
  PRWebhookHandlerBase,
  PRWebhookContext,
} from "./pr-webhook-handler-base.js";
import { constructLinkToPRComment } from "./utils.js";
import { PullRequestReviewTriggerData } from "./types.js";
import { createPromptFromPRCommentTrigger } from "./prompts.js";
import { getRandomWebhookMessage } from "./webhook-messages.js";
import { GITHUB_TRIGGER_USERNAME } from "./constants.js";

/**
 * Pull Request 댓글 관련 웹훅을 처리하는 클래스입니다.
 */
class PRCommentWebhookHandler extends PRWebhookHandlerBase {
  constructor() {
    super("GitHubPRCommentHandler");
  }

  /**
   * PR 댓글 트리거로부터 프롬프트를 생성합니다.
   * @param prData - Pull Request 리뷰 트리거 데이터.
   * @returns 생성된 프롬프트 문자열.
   */
  protected createPrompt(prData: PullRequestReviewTriggerData): string {
    return createPromptFromPRCommentTrigger(prData);
  }

  /**
   * 트리거 링크를 포함하는 댓글 메시지를 생성합니다.
   * @param linkToTrigger - 트리거 링크.
   * @returns 생성된 댓글 메시지 문자열.
   */
  protected createCommentMessage(linkToTrigger: string): string {
    return getRandomWebhookMessage("pr_comment", linkToTrigger);
  }

  /**
   * 트리거 링크를 생성합니다.
   * @param context - PR 웹훅 컨텍스트.
   * @param triggerId - 트리거 ID.
   * @returns 생성된 트리거 링크 문자열.
   */
  protected createTriggerLink(
    context: PRWebhookContext,
    triggerId: number | string,
  ): string {
    return constructLinkToPRComment({
      owner: context.owner,
      repo: context.repo,
      pullNumber: context.prNumber,
      commentId: triggerId as number,
    });
  }

  /**
   * Pull Request에 댓글이 달렸을 때의 이벤트를 처리합니다.
   * OpenSWE 멘션이 포함된 경우, 새로운 실행을 생성하고 관련 댓글을 답니다.
   * @param payload - 웹훅 페이로드.
   */
  async handlePullRequestComment(payload: any): Promise<void> {
    // Pull Request에 대한 댓글만 처리합니다.
    if (!payload.issue.pull_request) {
      return;
    }

    const commentBody = payload.comment.body;

    if (!this.validateOpenSWEMention(commentBody, "댓글")) {
      return;
    }

    this.logger.info(
      `${GITHUB_TRIGGER_USERNAME}가 PR #${payload.issue.number} 댓글에서 멘션되었습니다.`,
      {
        commentId: payload.comment.id,
        author: payload.comment.user?.login,
      },
    );

    try {
      const context = await this.setupPRWebhookContext(payload);
      if (!context) {
        return;
      }

      // 전체 PR 세부 정보 가져오기
      const { data: pullRequest } = await context.octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        {
          owner: context.owner,
          repo: context.repo,
          pull_number: context.prNumber,
        },
      );

      const { reviews, prComments, linkedIssues } = await this.fetchPRContext(
        context,
        pullRequest.body || "",
      );

      const prData = this.createPRTriggerData(
        pullRequest,
        context.prNumber,
        {
          id: payload.comment.id,
          body: commentBody,
          author: payload.comment.user?.login,
        },
        prComments,
        reviews,
        linkedIssues,
        {
          owner: context.owner,
          name: context.repo,
        },
      );

      const prompt = this.createPrompt(prData);
      const runInput = this.createPRRunInput(prompt, context, pullRequest);
      const configurable = this.createPRRunConfiguration(context);

      const { runId, threadId } = await this.createRun(context, {
        runInput,
        configurable,
      });

      const triggerLink = this.createTriggerLink(context, payload.comment.id);
      const commentMessage = this.createCommentMessage(triggerLink);

      await this.createComment(
        context,
        {
          issueNumber: context.prNumber,
          message: commentMessage,
        },
        runId,
        threadId,
      );
    } catch (error) {
      this.handleError(error, "PR 댓글 웹훅");
    }
  }
}

const prCommentHandler = new PRCommentWebhookHandler();

/**
 * PR 댓글 이벤트를 처리하는 외부 핸들러 함수입니다.
 * @param payload - 웹훅 페이로드.
 */
export async function handlePullRequestComment(payload: any): Promise<void> {
  return prCommentHandler.handlePullRequestComment(payload);
}
