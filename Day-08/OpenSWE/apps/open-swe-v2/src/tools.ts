/**
 * @file tools.ts
 * @description 이 파일은 Open SWE V2 에이전트가 외부 세계와 상호작용하는 데 사용하는 핵심 도구(Tool)들을
 * 정의합니다. 각 도구는 LangChain의 `tool` 데코레이터를 사용하여 생성되며, Zod 스키마를 통해
 * 입력 인자의 유효성을 엄격하게 검증하여 타입 안정성과 예측 가능성을 보장합니다. 이 파일에 정의된
 * 도구들은 셸 명령어 실행, HTTP 요청, 웹 검색 등 에이전트의 핵심적인 동적 능력을 구성합니다.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { spawn } from "child_process";
import { validateCommandSafety } from "./command-safety.js";

/**
 * 셸 명령어를 안전하게 실행하는 도구입니다.
 * 이 도구는 가장 강력하면서도 위험한 기능이므로, 여러 단계의 보안 장치를 포함합니다:
 * 1. `validateCommandSafety`를 호출하여 외부 LLM을 통해 명령어의 안전성을 사전 검증합니다.
 * 2. `spawn`을 사용하여 비동기적으로 명령어를 실행하고, stdout/stderr를 캡처합니다.
 * 3. 타임아웃을 설정하여 무한 루프나 장기 실행 명령어로 인해 에이전트가 멈추는 것을 방지합니다.
 */
export const executeBash = tool(
  async ({
    command,
    timeout = 30000, // 기본 타임아웃 30초
  }: {
    command: string;
    timeout?: number;
  }) => {
    try {
      // 1단계: `command-safety.ts`의 함수를 호출하여 명령어의 안전성을 검증합니다.
      const safetyValidation = await validateCommandSafety(command);

      // 검증 결과, 명령어가 안전하지 않다고 판단되면 즉시 실행을 차단하고 상세한 오류 정보를 반환합니다.
      if (!safetyValidation.is_safe) {
        return {
          success: false,
          returncode: -1,
          stdout: "",
          stderr: `명령어 실행 차단됨 - 안전성 검증 실패:\n- 위협 유형: ${safetyValidation.threat_type}\n- 사유: ${safetyValidation.reasoning}\n- 탐지된 패턴: ${safetyValidation.detected_patterns.join(", ")}`,
          safety_validation: safetyValidation,
        };
      }

      // 2단계: 안전하다고 판단된 명령어를 `spawn`을 통해 별도의 bash 프로세스에서 실행합니다.
      return new Promise((resolve) => {
        const child = spawn("bash", ["-c", command], {
          stdio: ["pipe", "pipe", "pipe"], // stdout, stderr, stdin 스트림을 파이프로 연결하여 캡처합니다.
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data) => {
          stdout += data.toString();
        });

        child.stderr.on("data", (data) => {
          stderr += data.toString();
        });

        // 3단계: 지정된 타임아웃 시간이 지나면 프로세스를 강제 종료하여 에이전트의 행(hang)을 방지합니다.
        const timeoutId = setTimeout(() => {
          child.kill(); // SIGTERM 신호를 보내 프로세스를 종료합니다.
          resolve({
            success: false,
            returncode: -1,
            stdout,
            stderr: stderr + "\n오류: 프로세스 실행 시간이 초과되었습니다.",
            safety_validation: safetyValidation,
          });
        }, timeout);

        // 프로세스가 정상적으로 또는 오류와 함께 종료될 때 호출되는 이벤트 리스너입니다.
        child.on("close", (code) => {
          clearTimeout(timeoutId); // 타임아웃 타이머를 제거합니다.
          resolve({
            success: code === 0, // 종료 코드가 0이면 성공으로 간주합니다.
            returncode: code || 0,
            stdout,
            stderr,
            safety_validation: safetyValidation,
          });
        });

        // `spawn` 자체에서 오류가 발생할 때(예: 명령어 실행 불가) 호출되는 이벤트 리스너입니다.
        child.on("error", (err) => {
          clearTimeout(timeoutId);
          resolve({
            success: false,
            returncode: -1,
            stdout,
            stderr: err.message,
            safety_validation: safetyValidation,
          });
        });
      });
    } catch (error) {
      // `validateCommandSafety` 호출 등 예기치 않은 예외 발생 시 처리 로직입니다.
      return {
        success: false,
        returncode: -1,
        stdout: "",
        stderr: `명령어 실행 중 예기치 않은 오류 발생: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  {
    name: "execute_bash",
    description: "주어진 bash 명령어를 실행하고, 실행 결과를 포함하는 객체를 반환합니다.",
    schema: z.object({
      command: z.string().describe("실행할 bash 명령어 문자열"),
      timeout: z
        .number()
        .optional()
        .default(30000)
        .describe("최대 실행 시간 (밀리초 단위)"),
    }),
  },
);

/**
 * 지정된 URL에 HTTP 요청을 보내는 도구입니다.
 * 에이전트가 외부 API와 통신하거나 웹 페이지의 원시 데이터를 가져오는 데 사용됩니다.
 */
export const httpRequest = tool(
  async ({
    url,
    method = "GET",
    headers = {},
    data,
  }: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    data?: any;
  }) => {
    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      };

      // GET, HEAD 메서드가 아닐 경우에만 요청 본문을 포함합니다.
      if (data && method !== "GET" && method !== "HEAD") {
        fetchOptions.body = JSON.stringify(data);
      }

      const response = await fetch(url, fetchOptions);
      const responseData = await response.text();

      // LangGraph 상태로 전달될 수 있도록 응답 헤더를 일반 객체로 변환합니다.
      const headersObj: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headersObj[key] = value;
      });

      return {
        status: response.status,
        headers: headersObj,
        data: responseData,
      };
    } catch (error) {
      // 네트워크 오류 등 요청 실패 시 오류 메시지를 포함하는 객체를 반환합니다.
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  {
    name: "http_request",
    description: "지정된 URL에 HTTP 요청을 보내고 응답을 반환합니다.",
    schema: z.object({
      url: z.string().describe("요청을 보낼 대상 URL"),
      method: z.string().optional().default("GET").describe("HTTP 메서드 (예: GET, POST)"),
      headers: z
        .record(z.string())
        .optional()
        .default({})
        .describe("요청에 포함할 HTTP 헤더 객체"),
      data: z.any().optional().describe("요청 본문에 포함할 데이터 (주로 POST, PUT 요청에 사용)"),
    }),
  },
);

/**
 * Tavily API를 사용하여 웹 검색을 수행하는 도구입니다.
 * 에이전트가 최신 정보나 특정 주제에 대한 지식이 필요할 때 사용됩니다.
 */
export const webSearch = tool(
  async ({ query, maxResults = 5 }: { query: string; maxResults?: number }) => {
    const apiKey = process.env.TAVILY_API_KEY;

    if (!apiKey) {
      throw new Error("TAVILY_API_KEY 환경 변수가 설정되지 않았습니다. 웹 검색을 수행할 수 없습니다.");
    }

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: apiKey,
          query: query,
          max_results: maxResults,
          search_depth: "basic",
          include_answer: true,
          include_images: false,
          include_raw_content: false,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Tavily API 오류: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as any;

      // 에이전트가 후속 작업에서 사용하기 쉽도록 API 응답을 간결하고 구조화된 형식으로 정리합니다.
      return {
        answer: data.answer || null,
        results:
          data.results?.map((result: any) => ({
            title: result.title,
            url: result.url,
            content: result.content,
            score: result.score,
          })) || [],
      };
    } catch (error) {
      // API 호출 실패 시, 에이전트의 작업 흐름이 중단되지 않도록 대체 목(mock) 결과를 제공합니다.
      return {
        answer: null,
        results: [
          {
            title: `검색 실패: ${query}`,
            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
            content: `웹 검색 중 오류가 발생했습니다. 다음 쿼리에 대한 결과를 가져올 수 없습니다: ${query}. 오류: ${error instanceof Error ? error.message : String(error)}`,
            score: 0,
          },
        ],
      };
    }
  },
  {
    name: "web_search",
    description: "Tavily API를 사용하여 웹에서 정보를 검색하고, 요약된 답변과 검색 결과 목록을 반환합니다.",
    schema: z.object({
      query: z.string().describe("검색할 쿼리 문자열"),
      maxResults: z
        .number()
        .optional()
        .default(5)
        .describe("반환할 최대 검색 결과 수"),
    }),
  },
);
