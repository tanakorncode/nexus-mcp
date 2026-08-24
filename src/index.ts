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
  "Auto-detect the Nexus project for the current repo — tries matching this repo's git remote against registered repositories first, falls back to the current branch's task-key prefix (e.g. feature/ALPHA-42-x -> project key ALPHA) if the repo isn't registered.",
  {},
  async () => {
    try {
      const project = await projectDetector.detect(process.cwd());
      if (!project) return errorResult(new Error("No project matched — repo isn't registered in Nexus, and the branch name has no recognizable task key."));
      return textResult(project);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "get_current_repository",
  "Match the current repo's git remote against Nexus's registered repositories for this project. Returns null (not an error) if this repo hasn't been registered there yet — that's a normal state, not a bug.",
  {},
  async () => {
    try {
      const repository = await projectDetector.detectRepository(process.cwd());
      if (!repository) {
        return textResult({
          matched: false,
          note: "This repo isn't registered as a Nexus GitRepository yet — repo-scoped task filtering (repositoryId) isn't available here until someone adds it in the project's settings. Project-level detection still works via the branch task-key prefix.",
        });
      }
      return textResult({ matched: true, repository });
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "list_my_tasks",
  "List tasks assigned to the current user in a project. Auto-detects the project from the current repo if projectId is omitted. Pass repositoryId (from get_current_repository) to narrow to tasks scoped to one specific repo within a multi-repo project.",
  {
    projectId: z.string().optional().describe("Nexus project id. Omit to auto-detect from the current repo."),
    repositoryId: z.string().optional().describe("Narrow to tasks tagged with this specific repo (see get_current_repository). Most tasks won't have one set unless the team tags them."),
    status: z.string().optional().describe("Status name to filter by, e.g. 'In Progress' (use list_statuses for exact names)."),
  },
  async ({ projectId, repositoryId, status }) => {
    try {
      const [id, me] = await Promise.all([resolveProjectId(projectId), client.getCurrentMember()]);
      return textResult((await client.listTasks({ projectId: id, assigneeId: me.id, repositoryId, status })).data);
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
  "list_story_tasks",
  "List sibling tasks under the same story as a given task — the practical way to find 'the other half' of a hand-off (e.g. the frontend task paired with a backend task) when a story groups one task per repo. Pass either taskId (resolves its story automatically) or storyId directly.",
  {
    taskId: z.string().optional().describe("A task in the story you want siblings for."),
    storyId: z.string().optional().describe("The story id directly, if already known."),
    projectId: z.string().optional().describe("Nexus project id. Omit to auto-detect from the current repo."),
  },
  async ({ taskId, storyId, projectId }) => {
    try {
      let resolvedStoryId = storyId;
      if (!resolvedStoryId) {
        if (!taskId) return errorResult(new Error("Pass either taskId or storyId."));
        const task = await client.getTask(taskId);
        if (!task.storyId) return errorResult(new Error(`Task ${task.taskKey} isn't attached to a story — nothing to group by.`));
        resolvedStoryId = task.storyId;
      }
      const id = await resolveProjectId(projectId);
      const { data: tasks } = await client.listTasks({ projectId: id, storyId: resolvedStoryId, perPage: 100 });
      return textResult(tasks);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "list_epics",
  "List epics in a project — the top level of the hierarchy, needed to create a task or story. Auto-detects the project if omitted.",
  { projectId: z.string().optional().describe("Nexus project id. Omit to auto-detect from the current repo.") },
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
  "create_epic",
  "Create an epic — the top level of the hierarchy, above stories and tasks. Epics are normally infrequent/lead-planned; check list_epics first so you don't create a near-duplicate of one that already exists. code is optional — omit it to get the same auto-generated format the product UI uses (<last 4 chars of projectId>-E<seq>); codes are globally unique across all projects, so a manually chosen one must not collide with any existing epic.",
  {
    projectId: z.string().optional().describe("Nexus project id. Omit to auto-detect from the current repo."),
    name: z.string(),
    code: z.string().optional().describe("Globally unique epic code. Omit to auto-generate."),
    description: z.string().optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "HIGHEST"]).optional(),
    color: z.string().optional().describe("Hex color, e.g. #3b82f6. Omit for the default."),
  },
  async ({ projectId, name, code, description, priority, color }) => {
    try {
      const id = await resolveProjectId(projectId);
      return textResult(await client.createEpic({ projectId: id, name, code, description, priority, color }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "update_epic",
  "Update an epic's name, description, priority, status, or color. code and projectId aren't editable here (code is globally unique and not meant to be reassigned; moving an epic between projects isn't supported).",
  {
    epicId: z.string(),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "HIGHEST"]).optional(),
    status: z.string().optional(),
    color: z.string().optional().describe("Hex color, e.g. #3b82f6."),
  },
  async ({ epicId, name, description, priority, status, color }) => {
    try {
      return textResult(await client.updateEpic(epicId, { name, description, priority, status, color }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "list_stories",
  "List stories under an epic — check this before creating a new story, in case one already exists for the feature you're about to add a task to.",
  { epicId: z.string() },
  async ({ epicId }) => {
    try {
      return textResult(await client.listStories(epicId));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "create_story",
  "Create a story under an epic — the grouping unit for a feature that spans multiple repos. Convention: one story per feature, one task per repo underneath it (check list_story_tasks/list_stories first to avoid creating a duplicate for a feature that already has one).",
  {
    epicId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "HIGHEST"]).optional(),
    storyPoints: z.number().optional(),
  },
  async ({ epicId, name, description, priority, storyPoints }) => {
    try {
      return textResult(await client.createStory({ epicId, name, description, priority, storyPoints }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "list_labels",
  "List labels defined in a project. Check before create_label, to avoid creating a duplicate.",
  { projectId: z.string().optional().describe("Nexus project id. Omit to auto-detect from the current repo.") },
  async ({ projectId }) => {
    try {
      const id = await resolveProjectId(projectId);
      return textResult(await client.listLabels(id));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "create_label",
  "Create a new label in a project — check list_labels first, this errors if the name already exists.",
  {
    projectId: z.string().optional().describe("Nexus project id. Omit to auto-detect from the current repo."),
    name: z.string(),
    color: z.string().optional().describe("Hex color, e.g. '#3b82f6'. Omit for the project's default."),
  },
  async ({ projectId, name, color }) => {
    try {
      const id = await resolveProjectId(projectId);
      return textResult(await client.createLabel({ projectId: id, name, color }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "create_task",
  "Create a task. epicId is required by the API — use list_epics to find it. Optional fields that make the task properly discoverable later: storyId (multi-repo feature grouping — see list_stories/create_story), repositoryId (see get_current_repository), blockedById (a task that must finish first), assigneeId (see list_members), labelIds (see list_labels/create_label). See the nexus-plan-work skill for the recommended process around which of these to ask about before calling this.",
  {
    name: z.string(),
    epicId: z.string(),
    projectId: z.string().optional().describe("Nexus project id. Omit to auto-detect from the current repo."),
    description: z.string().optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "HIGHEST"]).optional(),
    status: z.string().optional().describe("Status name (use list_statuses). Omit for the project's default."),
    storyPoints: z.number().optional(),
    dueDate: z.string().optional().describe("ISO date string."),
    assigneeId: z.string().optional().describe("See list_members."),
    storyId: z.string().optional().describe("Group this task with its siblings across repos — see list_stories/create_story."),
    repositoryId: z.string().optional().describe("Which repo this task is for — see get_current_repository."),
    blockedById: z.string().optional().describe("A task that must finish first."),
    labelIds: z.array(z.string()).optional().describe("See list_labels/create_label."),
  },
  async ({ projectId, ...rest }) => {
    try {
      const id = await resolveProjectId(projectId);
      return textResult(await client.createTask({ projectId: id, ...rest }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "update_task",
  "Set or clear a task's story/repository/blocked-by/assignee/labels after creation. Pass null for storyId/repositoryId/blockedById/assigneeId to unset one, omit fields you don't want to change. labelIds is a full replace, not a diff — pass the complete set of label ids the task should end up with (use list_labels to see ids, get_task to see the task's current labelIds via taskLabels).",
  {
    taskId: z.string(),
    storyId: z.string().nullable().optional(),
    repositoryId: z.string().nullable().optional(),
    blockedById: z.string().nullable().optional(),
    assigneeId: z.string().nullable().optional().describe("See list_members."),
    labelIds: z.array(z.string()).optional().describe("Full replacement set — see list_labels."),
  },
  async ({ taskId, storyId, repositoryId, blockedById, assigneeId, labelIds }) => {
    try {
      return textResult(await client.updateTask(taskId, { storyId, repositoryId, blockedById, assigneeId, labelIds }));
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
