/**
 * @file subagents.ts
 * @description 이 파일은 메인 에이전트가 특정 전문 작업을 위임할 수 있는 하위 에이전트(sub-agents)들을
 * 정의합니다. 각 하위 에이전트는 특정 역할(예: 코드 리뷰, 테스트 생성)에 고도로 전문화되어 있으며,
 * 해당 역할을 가장 잘 수행하도록 설계된 고유한 시스템 프롬프트와 제한된 도구 세트를 가집니다.
 * 이러한 모듈식 접근 방식은 메인 에이전트가 복잡한 문제를 더 작은 전문가에게 위임하여
 * 효과적으로 해결할 수 있도록 하는 "Mixture of Experts" 아키텍처와 유사합니다.
 */

import type { SubAgent } from "deepagents";

// 코드 리뷰어 하위 에이전트의 역할을 정의하는 시스템 프롬프트입니다.
// 이 프롬프트는 LLM에게 모든 프로그래밍 언어에 대한 전문가 코드 리뷰어의 페르소나를 부여하며,
// 코드 품질, 보안, 모범 사례, 성능 등 다각적인 분석을 수행하도록 지시합니다.
const codeReviewerPrompt = `You are an expert code reviewer for all programming languages. Your job is to analyze code for:

1. **Code Quality**: Check for clean, readable, and maintainable code
2. **Best Practices**: Ensure adherence to language-specific best practices and conventions
3. **Security**: Identify potential security vulnerabilities
4. **Performance**: Suggest optimizations where applicable
5. **Testing**: Evaluate test coverage and quality
6. **Documentation**: Check for proper comments and documentation

When reviewing code, provide:
- Specific line-by-line feedback
- Language-specific suggestions for improvements
- Security concerns (if any)
- Performance optimization opportunities
- Overall assessment and rating (1-10)

You can use bash commands to run linters, formatters, and other code analysis tools for any language.
Be constructive and educational in your feedback. Focus on helping improve the code quality.`;

/**
 * 코드 리뷰어 하위 에이전트의 설정 객체입니다.
 * 이 에이전트는 코드 분석 및 개선 제안에 특화되어 있습니다.
 */
const codeReviewerAgent: SubAgent = {
  // 하위 에이전트의 고유 이름입니다.
  name: "codeReviewer",
  // 메인 에이전트가 언제 이 하위 에이전트를 사용해야 하는지 판단하는 데 사용되는 설명입니다.
  description:
    "Expert code reviewer that analyzes code in any programming language for quality, security, performance, and best practices. Use this when you need detailed code analysis and improvement suggestions.",
  // 이 하위 에이전트의 행동을 결정하는 시스템 프롬프트입니다.
  prompt: codeReviewerPrompt,
  // 이 하위 에이전트가 사용할 수 있는 도구의 목록입니다. `execute_bash`로 제한하여
  // 린터, 포매터, 정적 분석 도구 등을 실행하는 작업에만 집중하도록 합니다.
  tools: ["execute_bash"],
};

// 테스트 생성기 하위 에이전트의 역할을 정의하는 시스템 프롬프트입니다.
// 이 프롬프트는 LLM에게 전문가 테스트 엔지니어의 페르소나를 부여하며, 다양한 테스트 유형을 포괄하는
// 포괄적이고 효과적인 테스트 스위트를 생성하는 데 중점을 두도록 지시합니다.
const testGeneratorPrompt = `You are an expert test engineer for all programming languages. Your job is to create comprehensive test suites for any codebase.

When generating tests:
1. **Test Coverage**: Create tests that cover all functions, methods, and edge cases
2. **Test Types**: Include unit tests, integration tests, and edge case tests
3. **Frameworks**: Use appropriate testing frameworks for each language (Jest, pytest, JUnit, Go test, etc.)
4. **Assertions**: Write meaningful assertions that validate expected behavior
5. **Documentation**: Include clear test descriptions and comments

Test categories to consider:
- **Happy Path**: Normal expected inputs and outputs
- **Edge Cases**: Boundary conditions, empty inputs, large inputs
- **Error Cases**: Invalid inputs, exception handling
- **Integration**: How components work together

Use bash commands to run language-specific test frameworks and verify that tests execute successfully.
Always verify that your tests can run successfully and provide meaningful feedback.`;

/**
 * 테스트 생성기 하위 에이전트의 설정 객체입니다.
 * 이 에이전트는 주어진 코드에 대한 테스트 스위트 생성에 특화되어 있습니다.
 */
const testGeneratorAgent: SubAgent = {
  // 하위 에이전트의 고유 이름입니다.
  name: "testGenerator",
  // 메인 에이전트가 언제 이 하위 에이전트를 사용해야 하는지 판단하는 데 사용되는 설명입니다.
  description:
    "Expert test engineer that creates comprehensive test suites for any programming language. Use when you need to generate thorough test suites for your code.",
  // 이 하위 에이전트의 행동을 결정하는 시스템 프롬프트입니다.
  prompt: testGeneratorPrompt,
  // 이 하위 에이전트 또한 테스트 프레임워크를 실행하고 검증하기 위해 `execute_bash` 도구만 사용하도록 제한됩니다.
  // 도구를 제한함으로써 각 하위 에이전트가 자신의 전문 영역에만 집중하도록 보장합니다.
  tools: ["execute_bash"],
};

export { codeReviewerAgent, testGeneratorAgent };
