# Running REA in a Sandbox

**Important:** Official REA is *not* a sandbox. Its security notes explicitly state that analysis runs with the current user's permissions and does not protect against malicious processes.

## Recommended Approaches

1. **Virtual Machine (simplest safe option)**
   - Create a throwaway VM (Linux preferred).
   - Install Node.js 22.19+ / 24.11+ / 26+.
   - Run `npx rea-agents setup`.
   - Only copy the specific files/apps you intend to analyze.

2. **Docker containment**
   - See community project: [dagoSte/rea-safe-agents](https://github.com/dagoSte/rea-safe-agents)
   - Runs REA + agent in restricted Docker containers with limited mounts and verification steps.

3. **This skill + isolation**
   - Load `SKILL.md` into your agent.
   - Use the Builder isolation (worktree) and clean-room rules already built into the skill.
   - Prefer static analysis over runtime when possible.

## Quick Local Test (if trusted environment)
```bash
npx rea-agents setup
npx -y rea-agents@latest doctor --client claude_code --json
```

Always analyze only software you own or are authorized to examine.
