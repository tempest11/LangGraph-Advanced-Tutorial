# Open SWE

## Project Overview

Open SWE is an open-source, cloud-based asynchronous coding agent. It is designed to autonomously understand codebases, devise solutions, and implement code changes across entire repositories, from initial planning to the creation of pull requests. The project is a monorepo managed with Yarn and Turborepo, containing the following main components:

*   **`@openswe/agent`**: The core agent application, built with LangGraph. This component is responsible for the autonomous code understanding, planning, and execution capabilities of Open SWE. It interacts with language models and GitHub to perform its tasks.
*   **`@openswe/web`**: A Next.js web application that provides a user interface for creating, managing, and executing Open SWE tasks.
*   **`@openswe/shared`**: A shared package containing code used by both the agent and the web application.

The project is built with TypeScript and utilizes a variety of modern web development tools and libraries.

*   **`@openswe/cli`**: A command-line interface (CLI) application for interacting with Open SWE from the terminal.

## Building and Running

The project uses Yarn as its package manager and Turborepo to manage the monorepo. The following commands are available in the root `package.json`:

*   **`yarn dev`**: Starts the development servers for all applications in the monorepo.
*   **`yarn build`**: Builds all applications in the monorepo.
*   **`yarn test`**: Runs the tests for all applications in the monorepo.
*   **`yarn lint`**: Lints the code for all applications in the monorepo.
*   **`yarn format`**: Formats the code for all applications in the monorepo.

To run a specific command for a single application, you can use the `turbo` command directly. For example, to run the tests for only the `@openswe/agent` application, you would run the following command from the root of the project:

```bash
turbo run test --filter=@openswe/agent
```

To run the CLI application in development mode, you can run the following command from the root of the project:

```bash
yarn dev --filter=@openswe/cli
```

## Development Conventions

The project follows standard TypeScript and JavaScript development conventions. ESLint and Prettier are used for linting and formatting the code. The project also uses Jest for testing. All code is managed in a Git repository on GitHub.
