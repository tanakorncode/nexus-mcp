#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TokenStore } from "./auth/TokenStore.js";
import { NexusClient, NotAuthenticatedError } from "./api/NexusClient.js";
import { ProjectDetector } from "./workspace/ProjectDetector.js";

const apiUrl = process.env.NEXUS_API_URL;
if (!apiUrl) {
  console.error("NEXUS_API_URL is not set. Example: export NEXUS_API_URL=http://27.254.62.17:8090");
  process.exit(1);
}

const tokenStore = new TokenStore();
const client = new NexusClient(tokenStore, () => apiUrl);
const projectDetector = new ProjectDetector(client);

async function resolveProjectId(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const project = await projectDetector.detect(process.cwd());
  if (!project) {
    throw new Error(
      "Could not auto-detect the project from the current branch name (expected e.g. PROJ-123-something). Pass projectId explicitly, or run list_projects to find it.",
    );
  }
  return project.id;
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown) {
  const message =
    err instanceof NotAuthenticatedError
      ? "Not authenticated — run `npm run login` in nexus-mcp first."
      : err instanceof Error
        ? err.message
        : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

const server = new McpServer({ name: "nexus-mcp", version: "0.1.0" });

server.tool("whoami", "Show the currently configured Nexus member (resolved by email against /api/v1/members).", {}, async () => {
  try {
    return textResult(await client.getCurrentMember());
  } catch (err) {
    return errorResult(err);
  }
});

server.tool("list_projects", "List all Nexus projects the current user is a member of.", {}, async () => {
  try {
    return textResult((await client.listProjects()).data);
  } catch (err) {
    return errorResult(err);
  }
});

server.tool(
  "get_current_project",
  "Auto-detect the Nexus project from the current git branch's task key prefix (e.g. branch feature/ALPHA-42-x -> project key ALPHA).",
  {},
  async () => {
    try {
      const project = await projectDetector.detect(process.cwd());
      if (!project) return errorResult(new Error("No project matched — branch name has no recognizable task key."));
      return textResult(project);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "list_my_tasks",
  "List tasks assigned to the current user in a project. Auto-detects the project from the current branch if projectId is omitted.",
  {
    projectId: z.string().optional().describe("Nexus project id. Omit to auto-detect from the current branch."),
    status: z.string().optional().describe("Status name to filter by, e.g. 'In Progress' (use list_statuses for exact names)."),
  },
  async ({ projectId, status }) => {
    try {
      const [id, me] = await Promise.all([resolveProjectId(projectId), client.getCurrentMember()]);
      return textResult((await client.listTasks({ projectId: id, assigneeId: me.id, status })).data);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool("get_task", "Get full detail for one task by its internal id.", { taskId: z.string() }, async ({ taskId }) => {
  try {
    return textResult(await client.getTask(taskId));
  } catch (err) {
    return errorResult(err);
  }
});

server.tool(
  "get_task_by_key",
  "Look up a task by its human-readable key (e.g. ALPHA-42). Auto-detects the project if omitted.",
  { taskKey: z.string(), projectId: z.string().optional() },
  async ({ taskKey, projectId }) => {
    try {
      const id = await resolveProjectId(projectId);
      const { data: tasks } = await client.listTasks({ projectId: id, perPage: 100 });
      const task = tasks.find((t) => t.taskKey.toUpperCase() === taskKey.toUpperCase());
      if (!task) return errorResult(new Error(`No task found with key ${taskKey} in this project's first 100 tasks.`));
      return textResult(task);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "get_current_task",
  "Resolve the task key from the current git branch name (e.g. feature/ALPHA-42-fix-login) and fetch its detail.",
  {},
  async () => {
    try {
      const cwd = process.cwd();
      const taskKey = projectDetector.resolveCurrentBranchTaskKey(cwd);
      if (!taskKey) return errorResult(new Error("Current branch name has no recognizable task key (expected e.g. PROJ-123)."));
      const id = await resolveProjectId();
      const { data: tasks } = await client.listTasks({ projectId: id, perPage: 100 });
      const task = tasks.find((t) => t.taskKey.toUpperCase() === taskKey.toUpperCase());
      if (!task) return errorResult(new Error(`Branch references ${taskKey} but no such task was found.`));
      return textResult(task);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "list_statuses",
  "List the workflow statuses available in a project — the exact `status` strings update_task_status accepts.",
  { projectId: z.string().optional() },
  async ({ projectId }) => {
    try {
      const id = await resolveProjectId(projectId);
      const project = await client.getProject(id);
      return textResult(project.statuses ?? []);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "update_task_status",
  "Move a task to a new status by name (use list_statuses for exact names) — this is the hand-off signal other agents/people watch for.",
  { taskId: z.string(), status: z.string() },
  async ({ taskId, status }) => {
    try {
      return textResult(await client.updateTask(taskId, { status }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "list_sprints",
  "List sprints in a project, optionally filtered by status.",
  {
    projectId: z.string().optional(),
    status: z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]).optional(),
  },
  async ({ projectId, status }) => {
    try {
      const id = await resolveProjectId(projectId);
      return textResult((await client.listSprints({ projectId: id, status })).data);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool("list_members", "List team members sharing a project with the current user.", {}, async () => {
  try {
    return textResult(await client.listMembers());
  } catch (err) {
    return errorResult(err);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
