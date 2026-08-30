import type { TokenStore, OAuthTokenSet } from "../auth/TokenStore.js";

// ── Domain types — matches pm-system's public /api/v1/* shapes exactly ────────
// (nested relations, not the flat *_Name strings the internal /api/nexus/*
// endpoints return — this is a different, public-facing API surface.)

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "HIGHEST";

export interface AssigneeRef {
  id: string;
  name: string;
  avatarColor: string | null;
}

export interface StatusRef {
  id: string;
  name: string;
  color: string;
}

export interface EpicRef {
  id: string;
  code: string;
  name: string;
  color: string;
}

export interface SprintRef {
  id: string;
  number: number;
  name: string;
}

export interface StoryRef {
  id: string;
  name: string;
}

export interface RepositoryRef {
  id: string;
  name: string;
  repoUrl: string;
  keyPrefix: string;
}

export interface TaskDepRef {
  id: string;
  taskKey: string | null;
  name: string;
  status: string;
}

export interface AttachmentRef {
  id: string;
  name: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface EmbedRef {
  id: string;
  url: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  /** e.g. "figma", "google-docs" — whatever unfurled the link. */
  provider: string;
}

export interface LabelRef {
  id: string;
  name: string;
  color: string;
}

export interface GitActivity {
  id: string;
  type: "COMMIT" | "MR_OPENED" | "MR_UPDATED" | "MR_MERGED" | "MR_CLOSED" | "MR_APPROVED" | "MR_READY_FOR_REVIEW";
  commitSha: string | null;
  commitMessage: string | null;
  commitUrl: string | null;
  commitBranch: string | null;
  authorName: string | null;
  mrIid: number | null;
  mrTitle: string | null;
  mrUrl: string | null;
  mrState: "OPENED" | "CLOSED" | "MERGED" | "LOCKED" | null;
  mrSourceBranch: string | null;
  mrTargetBranch: string | null;
  mrAuthorName: string | null;
  pushedAt: string | null;
  createdAt: string;
  repository: RepositoryRef | null;
}

export type TaskAssigneeRole = "ASSIGNEE" | "REVIEWER";

export interface TaskAssignee {
  id: string;
  taskId: string;
  memberId: string;
  member: AssigneeRef | null;
  role: TaskAssigneeRole;
  createdAt: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  authorId: string | null;
  author: AssigneeRef | null;
  content: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  taskKey: string;
  /** Direct link to this task in the Nexus web UI. */
  url: string;
  name: string;
  status: string;
  priority: Priority;
  storyPoints: number;
  archived: boolean;
  dueDate: string | null;
  description: string | null;
  projectId: string;
  storyId: string | null;
  repositoryId: string | null;
  blockedById: string | null;
  createdAt: string;
  updatedAt: string;
  assignee: AssigneeRef | null;
  statusRel: StatusRef | null;
  epic: EpicRef | null;
  sprint: SprintRef | null;
  story: StoryRef | null;
  repository: RepositoryRef | null;
  /** The task that must finish first — this task can't start/land until it does. */
  blockedBy: TaskDepRef | null;
  /** Tasks waiting on this one — the other side of the hand-off. */
  blocks: TaskDepRef[];
  /** Uploaded files — screenshots, mockups, exported assets. */
  attachments: AttachmentRef[];
  /** Unfurled links — Figma files, docs, etc. */
  embeds: EmbedRef[];
  taskLabels: Array<{ label: LabelRef }>;
  _count: { subtasks: number; comments: number };
}

export interface ProjectStatus {
  id: string;
  name: string;
  color: string;
  isDone: boolean;
  order: number;
  isDefault: boolean;
}

export interface Project {
  id: string;
  name: string;
  /** Direct link to this project's board in the Nexus web UI. */
  url: string;
  key: string;
  status?: string;
  _count: { epics: number; members: number; sprints: number };
  statuses?: ProjectStatus[];
}

export interface Epic {
  id: string;
  projectId: string | null;
  code: string;
  name: string;
  description: string | null;
  priority: Priority;
  status: string;
  color: string;
  order: number;
}

export interface Story {
  id: string;
  epicId: string;
  sprintId: string | null;
  name: string;
  description: string | null;
  priority: Priority;
  status: string;
  storyPoints: number;
  order: number;
}

export interface Member {
  id: string;
  name: string;
  displayRole: string | null;
  avatarColor: string | null;
  email: string;
  role: string | null;
}

export type SprintStatus = "UPCOMING" | "ACTIVE" | "COMPLETED";

export interface Sprint {
  id: string;
  number: number;
  name: string;
  status: SprintStatus;
  startDate: string;
  endDate: string;
}

/**
 * A subtask is a plain Task row with parentId pointing at its parent —
 * not a separate entity type in Nexus itself. This is a lighter shape than
 * Task (no epic/story/sprint/repository refs) matching what
 * /api/v1/tasks/:id/subtasks actually returns.
 */
export interface Subtask {
  id: string;
  taskKey: string;
  url: string;
  name: string;
  description: string | null;
  status: string;
  statusId: string | null;
  priority: Priority;
  parentId: string;
  assignee: AssigneeRef | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitRepository {
  id: string;
  projectId: string;
  name: string;
  keyPrefix: string;
  repoUrl: string;
  repoNamespace: string;
  provider: string;
  active: boolean;
}

interface Paged<T> {
  data: T[];
  meta: { total: number; page: number; perPage: number };
}

// ── Client ────────────────────────────────────────────────────────────────────

export class NexusClient {
  constructor(
    private readonly tokenStore: TokenStore,
    private readonly getApiUrl: () => string,
  ) {}

  /** Resolves the Bearer token to send — a PAT as-is, or a valid/refreshed OAuth access token. */
  private async getBearerToken(): Promise<string> {
    const tokens = await this.tokenStore.get();
    if (!tokens) throw new NotAuthenticatedError();

    if (tokens.type === "pat") return tokens.token;

    // Refresh proactively if within 60s of expiry, so a mid-request 401 is rare.
    if (Date.now() < tokens.expiresAt - 60_000) return tokens.accessToken;
    return this.refreshOAuth(tokens);
  }

  private async refreshOAuth(tokens: OAuthTokenSet): Promise<string> {
    const res = await fetch(`${this.getApiUrl()}/api/auth/nexus/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: tokens.refreshToken }),
    });

    if (!res.ok) throw new NotAuthenticatedError();

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user: OAuthTokenSet["user"];
    };

    // The server rotates refresh tokens on every use — the old one is revoked,
    // so the new one must be persisted or the next refresh will fail.
    const updated: OAuthTokenSet = {
      type: "oauth",
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      user: data.user,
    };
    await this.tokenStore.store(updated);
    return updated.accessToken;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const bearer = await this.getBearerToken();

    const res = await fetch(`${this.getApiUrl()}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) throw new NotAuthenticatedError();

    const text = await res.text();
    let parsed: unknown = null;
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new NexusApiError(res.status, `Server returned non-JSON: ${text.slice(0, 120)}`);
      }
    }

    if (!res.ok) {
      const message =
        parsed && typeof parsed === "object" && "error" in parsed
          ? JSON.stringify((parsed as { error: unknown }).error)
          : text;
      throw new NexusApiError(res.status, message);
    }

    return parsed as T;
  }

  private qs(params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, String(value));
    }
    const s = search.toString();
    return s ? `?${s}` : "";
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  async listProjects(page?: number, perPage?: number): Promise<Paged<Project>> {
    return this.request<Paged<Project>>("GET", `/api/v1/projects${this.qs({ page, perPage })}`);
  }

  async getProject(projectId: string): Promise<Project> {
    const { data } = await this.request<{ data: Project }>("GET", `/api/v1/projects/${projectId}`);
    return data;
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  async listTasks(params: {
    projectId?: string;
    status?: string;
    assigneeId?: string;
    storyId?: string;
    repositoryId?: string;
    search?: string;
    page?: number;
    perPage?: number;
  }): Promise<Paged<Task>> {
    return this.request<Paged<Task>>("GET", `/api/v1/tasks${this.qs(params)}`);
  }

  async getTask(taskId: string): Promise<Task> {
    const { data } = await this.request<{ data: Task }>("GET", `/api/v1/tasks/${taskId}`);
    return data;
  }

  async updateTask(
    taskId: string,
    patch: {
      name?: string;
      status?: string;
      priority?: Priority;
      storyPoints?: number;
      dueDate?: string | null;
      assigneeId?: string | null;
      description?: string | null;
      storyId?: string | null;
      repositoryId?: string | null;
      blockedById?: string | null;
      sprintId?: string | null;
      labelIds?: string[];
      archived?: boolean;
    },
  ): Promise<Task> {
    const { data } = await this.request<{ data: Task }>("PATCH", `/api/v1/tasks/${taskId}`, patch);
    return data;
  }

  async listTaskComments(taskId: string): Promise<TaskComment[]> {
    const { data } = await this.request<{ data: TaskComment[] }>("GET", `/api/v1/tasks/${taskId}/comments`);
    return data;
  }

  async listTaskGitActivity(taskId: string): Promise<GitActivity[]> {
    const { data } = await this.request<{ data: GitActivity[] }>("GET", `/api/v1/tasks/${taskId}/git-activity`);
    return data;
  }

  async addTaskAttachment(
    taskId: string,
    filename: string,
    mimeType: string,
    contentBase64: string,
  ): Promise<AttachmentRef> {
    const { data } = await this.request<{ data: AttachmentRef }>("POST", `/api/v1/tasks/${taskId}/attachments`, {
      filename,
      mimeType,
      contentBase64,
    });
    return data;
  }

  async listTaskAssignees(taskId: string): Promise<TaskAssignee[]> {
    const { data } = await this.request<{ data: TaskAssignee[] }>("GET", `/api/v1/tasks/${taskId}/assignees`);
    return data;
  }

  async addTaskAssignee(taskId: string, memberId: string, role?: TaskAssigneeRole): Promise<TaskAssignee> {
    const { data } = await this.request<{ data: TaskAssignee }>("POST", `/api/v1/tasks/${taskId}/assignees`, {
      memberId,
      role,
    });
    return data;
  }

  async removeTaskAssignee(taskId: string, assigneeId: string): Promise<void> {
    await this.request<void>("DELETE", `/api/v1/tasks/${taskId}/assignees/${assigneeId}`);
  }

  async addTaskComment(taskId: string, content: string, parentId?: string): Promise<TaskComment> {
    const { data } = await this.request<{ data: TaskComment }>("POST", `/api/v1/tasks/${taskId}/comments`, {
      content,
      parentId,
    });
    return data;
  }

  async createTask(input: {
    name: string;
    projectId: string;
    epicId: string;
    status?: string;
    priority?: Priority;
    storyPoints?: number;
    dueDate?: string;
    assigneeId?: string;
    description?: string;
    storyId?: string;
    repositoryId?: string;
    blockedById?: string;
    sprintId?: string;
    labelIds?: string[];
  }): Promise<Task> {
    const { data } = await this.request<{ data: Task }>("POST", "/api/v1/tasks", input);
    return data;
  }

  // ── Subtasks ──────────────────────────────────────────────────────────────
  // A subtask is a Task row with parentId set — see the Subtask type above.
  // Inherits projectId/epicId/storyId/sprintId/repositoryId from its parent
  // automatically; only name (required) and the fields below need passing.

  async listSubtasks(taskId: string): Promise<Subtask[]> {
    const { data } = await this.request<{ data: Subtask[] }>("GET", `/api/v1/tasks/${taskId}/subtasks`);
    return data;
  }

  async createSubtask(
    taskId: string,
    input: {
      name: string;
      description?: string;
      priority?: Priority;
      assigneeId?: string;
      dueDate?: string;
    },
  ): Promise<Subtask> {
    const { data } = await this.request<{ data: Subtask }>(
      "POST",
      `/api/v1/tasks/${taskId}/subtasks`,
      input,
    );
    return data;
  }

  // ── Epics / Stories ───────────────────────────────────────────────────────

  async listEpics(projectId?: string): Promise<Epic[]> {
    const { data } = await this.request<{ data: Epic[] }>("GET", `/api/v1/epics${this.qs({ projectId })}`);
    return data;
  }

  async getEpic(epicId: string): Promise<Epic> {
    const { data } = await this.request<{ data: Epic }>("GET", `/api/v1/epics/${epicId}`);
    return data;
  }

  async createEpic(input: {
    projectId: string;
    name: string;
    code?: string;
    description?: string;
    priority?: Priority;
    color?: string;
  }): Promise<Epic> {
    const { data } = await this.request<{ data: Epic }>("POST", "/api/v1/epics", input);
    return data;
  }

  async updateEpic(
    epicId: string,
    patch: {
      name?: string;
      description?: string | null;
      priority?: Priority;
      status?: string;
      color?: string;
    },
  ): Promise<Epic> {
    const { data } = await this.request<{ data: Epic }>("PATCH", `/api/v1/epics/${epicId}`, patch);
    return data;
  }

  async listStories(epicId: string): Promise<Story[]> {
    const { data } = await this.request<{ data: Story[] }>("GET", `/api/v1/stories${this.qs({ epicId })}`);
    return data;
  }

  async getStory(storyId: string): Promise<Story> {
    const { data } = await this.request<{ data: Story }>("GET", `/api/v1/stories/${storyId}`);
    return data;
  }

  async createStory(input: {
    epicId: string;
    name: string;
    description?: string;
    priority?: Priority;
    storyPoints?: number;
  }): Promise<Story> {
    const { data } = await this.request<{ data: Story }>("POST", "/api/v1/stories", input);
    return data;
  }

  async updateStory(
    storyId: string,
    patch: {
      name?: string;
      description?: string | null;
      priority?: Priority;
      status?: string;
      storyPoints?: number;
    },
  ): Promise<Story> {
    const { data } = await this.request<{ data: Story }>("PATCH", `/api/v1/stories/${storyId}`, patch);
    return data;
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  async listLabels(projectId: string): Promise<LabelRef[]> {
    const { data } = await this.request<{ data: LabelRef[] }>("GET", `/api/v1/labels${this.qs({ projectId })}`);
    return data;
  }

  async createLabel(input: { projectId: string; name: string; color?: string }): Promise<LabelRef> {
    const { data } = await this.request<{ data: LabelRef }>("POST", "/api/v1/labels", input);
    return data;
  }

  // ── Sprints ───────────────────────────────────────────────────────────────

  async listSprints(params: {
    projectId?: string;
    status?: SprintStatus;
    page?: number;
    perPage?: number;
  }): Promise<Paged<Sprint>> {
    return this.request<Paged<Sprint>>("GET", `/api/v1/sprints${this.qs(params)}`);
  }

  async createSprint(input: {
    projectId: string;
    name: string;
    startDate: string;
    endDate: string;
    phase?: string;
    goals?: string;
  }): Promise<Sprint> {
    const { data } = await this.request<{ data: Sprint }>("POST", "/api/v1/sprints", input);
    return data;
  }

  // ── Repositories ──────────────────────────────────────────────────────────

  async listRepositories(params: { projectId?: string; repoUrl?: string } = {}): Promise<GitRepository[]> {
    const { data } = await this.request<{ data: GitRepository[] }>(
      "GET",
      `/api/v1/repositories${this.qs(params)}`,
    );
    return data;
  }

  async createRepository(input: {
    projectId: string;
    name: string;
    keyPrefix: string;
    repoUrl: string;
    repoNamespace: string;
    gitlabProjectId?: number;
  }): Promise<GitRepository> {
    const { data } = await this.request<{ data: GitRepository }>("POST", "/api/v1/repositories", input);
    return data;
  }

  async updateRepository(
    repositoryId: string,
    patch: { name?: string; active?: boolean; gitlabProjectId?: number | null },
  ): Promise<GitRepository> {
    const { data } = await this.request<{ data: GitRepository }>(
      "PATCH",
      `/api/v1/repositories/${repositoryId}`,
      patch,
    );
    return data;
  }

  async deleteRepository(repositoryId: string): Promise<void> {
    await this.request<void>("DELETE", `/api/v1/repositories/${repositoryId}`);
  }

  // ── Members / identity ───────────────────────────────────────────────────
  // No /me endpoint exists on the public API — resolve "self" by matching the
  // email captured at login against /api/v1/members (requires members:read).
  // Not cached: project membership changes (e.g. someone just got added) need
  // to show up on the next call, not after a process restart.

  async listMembers(params: { projectId?: string; role?: string[] } = {}): Promise<Member[]> {
    const { data } = await this.request<{ data: Member[] }>(
      "GET",
      `/api/v1/members${this.qs({ projectId: params.projectId, role: params.role?.join(",") })}`,
    );
    return data;
  }

  async getCurrentMember(): Promise<Member> {
    const tokens = await this.tokenStore.get();
    if (!tokens) throw new NotAuthenticatedError();

    // OAuth logins get identity straight from the token exchange — no /members
    // lookup, no email-matching, and no chance of the "no member found" error
    // PAT logins can hit if the email typed at login doesn't match exactly.
    if (tokens.type === "oauth") {
      return {
        id: tokens.user.id,
        name: tokens.user.name,
        email: tokens.user.email,
        displayRole: null,
        avatarColor: null,
        role: null,
      };
    }

    const members = await this.listMembers();
    const me = members.find((m) => m.email.toLowerCase() === tokens.email.toLowerCase());
    if (!me) {
      throw new Error(
        `No member found with email ${tokens.email} — check the email you entered during login.`,
      );
    }
    return me;
  }
}

// ── Error types ───────────────────────────────────────────────────────────────

export class NexusApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Nexus API error ${status}: ${body}`);
    this.name = "NexusApiError";
  }
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated, or token expired/revoked — run `npm run login` again");
    this.name = "NotAuthenticatedError";
  }
}
