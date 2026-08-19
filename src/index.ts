import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TokenStore } from "./auth/TokenStore.js";
import { OAuthProvider } from "./auth/OAuthProvider.js";
import { NexusClient, NotAuthenticatedError } from "./api/NexusClient.js";
import { ProjectDetector } from "./workspace/ProjectDetector.js";

const apiUrl = process.env.NEXUS_API_URL;
if (!apiUrl) {
  console.error("NEXUS_API_URL is not set. Example: export NEXUS_API_URL=https://nexus.internal.pea");
  process.exit(1);
}

const tokenStore = new TokenStore();
const oauth = new OAuthProvider(tokenStore, () => apiUrl);
const client = new NexusClient(tokenStore, oauth, () => apiUrl);
const projectDetector = new ProjectDetector(client);

async function resolveProjectId(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const project = await projectDetector.detect(process.cwd());
  if (!project) {
    throw new Error(
      "Could not auto-detect the project from this repo's git remote. Pass projectId explicitly, or run list_projects to find it.",
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

server.tool("whoami", "Show the currently authenticated Nexus user.", {}, async () => {
  try {
    const user = await client.getCurrentUser();
    if (!user) return errorResult(new NotAuthenticatedError());
    return textResult(user);
  } catch (err) {
    return errorResult(err);
  }
});

server.tool("list_projects", "List all Nexus projects the current user is a member of.", {}, async () => {
  try {
    return textResult(await client.listProjects());
  } catch (err) {
    return errorResult(err);
  }
});

server.tool(
  "get_current_project",
  "Auto-detect the Nexus project for the current working directory's git remote.",
  {},
  async () => {
    try {
      const project = await projectDetector.detect(process.cwd());
      if (!project) return errorResult(new Error("No project matched this repo's git remote."));
      return textResult(project);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "list_my_tasks",
  "List tasks assigned to the current user in a project. Auto-detects the project from the current repo if projectId is omitted.",
  {
    projectId: z.string().optional().describe("Nexus project id. Omit to auto-detect from the current repo."),
    status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "BLOCKED"]).optional(),
  },
  async ({ projectId, status }) => {
    try {
      const id = await resolveProjectId(projectId);
      return textResult(await client.getMyTasks(id, status));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "get_task",
  "Get full detail (description, comments, linked commits) for one task by its internal id.",
  { taskId: z.string() },
  async ({ taskId }) => {
    try {
      return textResult(await client.getTask(taskId));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "get_task_by_key",
  "Look up a task by its human-readable key (e.g. ALPHA-42). Auto-detects the project if omitted.",
  {
    taskKey: z.string(),
    projectId: z.string().optional(),
  },
  async ({ taskKey, projectId }) => {
    try {
      const id = await resolveProjectId(projectId);
      const task = await client.getTaskByKey(id, taskKey);
      if (!task) return errorResult(new Error(`No task found with key ${taskKey}`));
      return textResult(task);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "get_current_task",
  "Resolve the task key from the current git branch name (e.g. feature/ALPHA-42-fix-login) and fetch its full detail.",
  {},
  async () => {
    try {
      const cwd = process.cwd();
      const taskKey = projectDetector.resolveCurrentBranchTaskKey(cwd);
      if (!taskKey) {
        return errorResult(new Error("Current branch name has no recognizable task key (expected e.g. PROJ-123)."));
      }
      const id = await resolveProjectId();
      const task = await client.getTaskByKey(id, taskKey);
      if (!task) return errorResult(new Error(`Branch references ${taskKey} but no such task exists.`));
      return textResult(await client.getTask(task.id));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "list_statuses",
  "List the workflow statuses available in a project, with their statusId (needed for update_task_status).",
  { projectId: z.string().optional() },
  async ({ projectId }) => {
    try {
      const id = await resolveProjectId(projectId);
      return textResult(await client.listProjectStatuses(id));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "update_task_status",
  "Move a task to a new status — this is the hand-off signal other agents/people watch for. Use list_statuses first to find the statusId.",
  { taskId: z.string(), statusId: z.string() },
  async ({ taskId, statusId }) => {
    try {
      return textResult(await client.updateTaskStatus(taskId, statusId));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "add_comment",
  "Add a comment to a task — use this to log progress or hand-off notes for the next person.",
  { taskId: z.string(), content: z.string() },
  async ({ taskId, content }) => {
    try {
      return textResult(await client.addComment(taskId, content));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "list_epics",
  "List epics in a project. Auto-detects the project if omitted.",
  { projectId: z.string().optional() },
  async ({ projectId }) => {
    try {
      const id = await resolveProjectId(projectId);
      return textResult(await client.listEpics(id));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "get_task_commits",
  "List commits already linked to a task.",
  { taskId: z.string() },
  async ({ taskId }) => {
    try {
      return textResult(await client.getTaskCommits(taskId));
    } catch (err) {
      return errorResult(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
