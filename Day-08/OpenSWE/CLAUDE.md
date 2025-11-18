# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open SWE is an open-source cloud-based asynchronous coding agent built with LangGraph. It autonomously understands codebases, plans solutions, and executes code changes across entire repositories—from initial planning to opening pull requests.

**Architecture**: The system consists of four main LangGraph agents that work together:
- **Manager**: Entry point that initializes GitHub issues and classifies messages to route to appropriate agents
- **Planner**: Analyzes requirements and generates execution plans in a sandbox environment, with human-in-the-loop approval
- **Programmer**: Executes the plan by making actual code changes using various tools
- **Reviewer**: Reviews code changes and can request additional modifications from the Programmer

## Repository Structure

This is a **Yarn workspace monorepo** managed with **Turborepo**:

**apps/open-swe** - Core LangGraph agent (`@openswe/agent`)
- Three main graphs configured in `langgraph.json`: `manager`, `planner`, `programmer`
- Source organized by graphs (manager/planner/programmer/reviewer) and tools
- Strict ESLint rules including **no-console errors** (use `createLogger` instead)
- Authentication logic in `src/security/auth.ts`
- Custom HTTP routes in `src/routes/app.ts`

**apps/web** - Next.js 15 web interface (`@openswe/web`)
- React 19 frontend with Shadcn UI (wrapped Radix UI) and Tailwind CSS
- Provides user interface for creating and managing Open SWE tasks

**apps/cli** - Command-line interface for terminal interaction

**apps/docs** - Documentation site

**apps/open-swe-v2** - Next version of the agent (in development)

**packages/shared** - Common utilities (`@openswe/shared`)
- Exports via namespace: `@openswe/shared/open-swe/types`, `@openswe/shared/crypto`, etc.
- Contains shared types, constants, crypto utilities, GraphState types, and open-swe specific modules
- **Must be built before other packages can import from it** (handled automatically via turbo)

**Root Configuration**:
- `langgraph.json`: Configures the three LangGraph graphs and their entry points
- `turbo.json`: Build orchestration with task dependencies and parallel execution
- `.yarnrc.yml`: Yarn 3.5.1 configuration with node-modules linker

## Development Commands

**Package Manager**: Always use **Yarn** (never npm). Version: 3.5.1

**Installation**:
```bash
yarn install  # From repository root - handles all workspace dependencies
```

**Common Commands** (run from repository root using Turbo):
```bash
yarn dev              # Start development servers for all apps
yarn build            # Build all packages (builds shared package first automatically)
yarn lint             # Lint all packages
yarn lint:fix         # Auto-fix linting issues
yarn format           # Format code with Prettier
yarn format:check     # Check code formatting
yarn test             # Run unit tests across all packages
yarn clean            # Clean build artifacts
```

**Testing**:
```bash
# From root or specific package:
yarn test                    # Run unit tests (excludes *.int.test.ts)
yarn test:int                # Run integration tests (apps/open-swe only)
yarn test:single <file>      # Run a specific test file

# Testing framework: Jest with ts-jest and ESM support
# Test timeout: 20 seconds for longer-running tests
# Environment variables loaded via dotenv
```

**Per-Package Commands**:
```bash
# Filter to specific package:
turbo run build --filter=@openswe/agent
turbo run test --filter=@openswe/web

# Open SWE agent specific (from apps/open-swe):
yarn dev                     # Start LangGraph dev server (langgraphjs dev)
yarn build                   # Compile TypeScript
yarn get-trace-urls          # Get LangSmith trace URLs for debugging

# Web app specific (from apps/web):
yarn dev                     # Start Next.js dev server
yarn start                   # Start production server
```

## Code Organization and Patterns

**Import Conventions**:
- Shared package imports use namespace with specific module paths:
  ```typescript
  import { GraphState } from '@openswe/shared/open-swe/types';
  import { encrypt } from '@openswe/shared/crypto';
  ```
- Before creating new utilities, **search `packages/shared/src`** to check if one already exists

**Logging**:
- **Console logging is prohibited** in apps/open-swe (ESLint error)
- Use `createLogger` function to create logger instances instead

**TypeScript**:
- Strict mode enabled across all packages
- Base config in root `tsconfig.json`, extended by each package

**Code Quality**:
- ESLint and Prettier enforce code quality
- Run `yarn lint:fix` and `yarn format` before committing
- Minimize inline comments - code should be self-documenting

**Testing Structure**:
- Unit tests: `*.test.ts` in `__tests__` directories
- Integration tests: `*.int.test.ts` (apps/open-swe only)
- Focus on testing core business logic, utilities, and agent functionality

## LangGraph Configuration

The three main graphs are defined in `langgraph.json`:
- **manager**: `./apps/open-swe/src/graphs/manager/index.ts:graph`
- **planner**: `./apps/open-swe/src/graphs/planner/index.ts:graph`
- **programmer**: `./apps/open-swe/src/graphs/programmer/index.ts:graph`

**Environment**: Configuration points to `./apps/open-swe/.env`

**Authentication**: Custom auth handler at `./apps/open-swe/src/security/auth.ts:auth`

**HTTP Configuration**: Custom app with configurable GitHub-related headers (access tokens, installation tokens, user info, local mode)

## Key Dependencies

**LangChain Ecosystem**:
- `@langchain/langgraph` - Graph-based agent orchestration
- `@langchain/anthropic` - Anthropic LLM integration
- `@langchain/core` - Core LangChain functionality
- `@langchain/langgraph-sdk` - LangGraph SDK for client interaction

**Web Stack**:
- Next.js 15 with React 19
- Shadcn UI (Radix UI components) + Tailwind CSS
- TypeScript, ESLint, Prettier

**Tools & Services**:
- Octokit - GitHub API integration
- Daytona SDK - Sandbox environment management
- Firecrawl - Web scraping capabilities

## Development Workflow

1. **Starting Development**:
   - Run `yarn install` from root
   - Shared package builds automatically on first install (postinstall hook)
   - Use `yarn dev` to start all dev servers, or filter to specific package

2. **Making Changes**:
   - Follow existing code patterns and architecture
   - Search `packages/shared/src` before creating new utilities
   - Use `createLogger` instead of console.log in agent code
   - Run `yarn lint:fix` and `yarn format` before committing

3. **Testing**:
   - Write unit tests for new utilities and business logic
   - Use integration tests for end-to-end workflows
   - Run tests with `yarn test` or `yarn test:single <file>`

4. **Building**:
   - Turbo handles build dependencies automatically
   - Shared package always builds first
   - Use `yarn build` from root for production builds
