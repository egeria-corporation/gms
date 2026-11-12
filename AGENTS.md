# Agent instructions

- To deploy or upgrade an instance of this system for a person: follow `DEPLOY_WITH_AGENT.md` exactly. In Claude Code, run `/deploy-gms`.
- To work on the code: read `CLAUDE.md` (working rules, commands, constraints).
- The deploy tool is `pnpm -s gms deploy <step>`; its reference is `scripts/deploy/README.md`. A step's result is the last stdout line that starts with `{` (`pnpm` prints its own `[ELIFECYCLE]` line after it when the exit code is not 0).
