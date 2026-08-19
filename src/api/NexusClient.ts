import type { TokenStore } from "../auth/TokenStore.js";
import type { OAuthProvider } from "../auth/OAuthProvider.js";

// ── Domain types (ported from nexus-vscode/src/api/NexusClient.ts) ─────────────

export type TaskStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "BLOCKED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "HIGHEST";

export interface Task {
  id: string;
  projectId: string | null;
  taskKey: string;
  name: string;
  status: string;
  statusId: string | null;
  priority: TaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  sprintId: string | null;
  sprintName: string | null;
  epicName: string | null;
  dueDate: string | null;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  key: string;
}

export interface ProjectStatus {
  id: string;
  name: string;
  color: string;
  order: number;
  isDone: boolean;
  isDefault: boolean;
}

export interface TaskDetail extends Task {
  description: string | null;
  epicId: string | null;
  epicColor: string | null;
  estimatedHours: number | null;
  storyPoints: number;
  comments: TaskComment[];
  commits?: TaskCommit[];
}

export interface TaskComment {
  id: string;
  content: string;
  authorName: string;
  createdAt: string;
}

export interface Epic {
  id: string;
  name: string;
  code: string;
  color: string;
}

export interface TaskCommit {
  id: string;
  sha: string | null;
  fullSha: string | null;
  message: string | null;
  branch: string | null;
  url: string | null;
  author: string | null;
  createdAt: string;
}

export interface Sprint {
  id: string;
  name: string;
  status: "PLANNING" | "ACTIVE" | "COMPLETED";
  startDate: string;
  endDate: string;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class NexusClient {
  private _refreshPromise: Promise<void> | null = null;

  constructor(
    private readonly tokenStore: TokenStore,
    private readonly oauthProvider: OAuthProvider,
    private readonly getApiUrl: () => string,
  ) {}

  // ── Core request method ───────────────────────────────────────────────────

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this._getValidToken();
    const url = `${this.getApiUrl()}${path}`;

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      await this._forceRefresh();
      const retryToken = await this._getValidToken();
      const retryRes = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${retryToken}` },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!retryRes.ok) throw new NexusApiError(retryRes.status, await retryRes.text());
      return this._parseJson<T>(retryRes);
    }

    if (!res.ok) throw new NexusApiError(res.status, await res.text());
    return this._parseJson<T>(res);
  }

  private async _parseJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    if (!text.trim()) throw new NexusApiError(res.status, "Server returned an empty response");
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new NexusApiError(res.status, `Server returned non-JSON: ${text.slice(0, 120)}`);
    }
  }

  // ── Token management ──────────────────────────────────────────────────────

  async getAccessToken(): Promise<string | null> {
    try {
      return await this._getValidToken();
    } catch {
      return null;
    }
  }

  private async _getValidToken(): Promise<string> {
    const tokens = await this.tokenStore.get();
    if (!tokens) throw new NotAuthenticatedError();

    if (this.tokenStore.isExpired(tokens)) {
      await this._forceRefresh();
      const refreshed = await this.tokenStore.get();
      if (!refreshed) throw new NotAuthenticatedError();
      return refreshed.accessToken;
    }

    return tokens.accessToken;
  }

  private async _forceRefresh(): Promise<void> {
    if (this._refreshPromise) return this._refreshPromise;

    this._refreshPromise = (async () => {
      const tokens = await this.tokenStore.get();
      if (!tokens) throw new NotAuthenticatedError();
      const refreshed = await this.oauthProvider.refresh(tokens.refreshToken);
      await this.tokenStore.store(refreshed);
    })().finally(() => {
      this._refreshPromise = null;
    });

    return this._refreshPromise;
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  async findProjectByGitRemote(normalizedRemote: string): Promise<Project | null> {
    const data = await this.request<{ data: Project[] }>(
      "GET",
      `/api/nexus/projects?gitRemote=${encodeURIComponent(normalizedRemote)}`,
    );
    return data.data[0] ?? null;
  }

  async listProjects(): Promise<Project[]> {
    const data = await this.request<{ data: Project[] }>("GET", "/api/nexus/projects");
    return data.data;
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  async getMyTasks(projectId: string, status?: TaskStatus): Promise<Task[]> {
    const tokens = await this.tokenStore.get();
    if (!tokens) throw new NotAuthenticatedError();

    let path = `/api/nexus/projects/${projectId}/tasks?assigneeId=${tokens.userId}`;
    if (status) path += `&status=${status}`;

    const data = await this.request<{ data: Task[] }>("GET", path);
    return data.data;
  }

  async getTaskByKey(projectId: string, taskKey: string): Promise<Task | null> {
    const data = await this.request<{ data: Task[] }>(
      "GET",
      `/api/nexus/projects/${projectId}/tasks?taskKey=${encodeURIComponent(taskKey)}`,
    );
    return data.data[0] ?? null;
  }

  async listProjectStatuses(projectId: string): Promise<ProjectStatus[]> {
    const data = await this.request<{ data: ProjectStatus[] }>(
      "GET",
      `/api/nexus/projects/${projectId}/statuses`,
    );
    return data.data;
  }

  async updateTaskStatus(taskId: string, statusId: string): Promise<Task> {
    const data = await this.request<{ data: Task }>(
      "PATCH",
      `/api/nexus/tasks/${taskId}/status`,
      { statusId },
    );
    return data.data;
  }

  // ── Task details / comments ───────────────────────────────────────────────

  async getTask(taskId: string): Promise<TaskDetail> {
    const data = await this.request<{ data: TaskDetail }>("GET", `/api/nexus/tasks/${taskId}`);
    return data.data;
  }

  async addComment(taskId: string, content: string): Promise<TaskComment> {
    const data = await this.request<{ data: TaskComment }>(
      "POST",
      `/api/nexus/tasks/${taskId}/comments`,
      { content },
    );
    return data.data;
  }

  async listEpics(projectId: string): Promise<Epic[]> {
    const data = await this.request<{ data: Epic[] }>("GET", `/api/nexus/projects/${projectId}/epics`);
    return data.data;
  }

  async getTaskCommits(taskId: string): Promise<TaskCommit[]> {
    try {
      const data = await this.request<{ data: TaskCommit[] }>(
        "GET",
        `/api/nexus/tasks/${taskId}/commits`,
      );
      return data.data;
    } catch {
      return [];
    }
  }

  async linkCommit(
    taskId: string,
    commitSha: string,
    commitMessage: string,
    branch: string,
    repoUrl: string,
  ): Promise<void> {
    await this.request("POST", "/api/nexus/git/link-commit", {
      taskId,
      commitSha,
      commitMessage,
      branch,
      repoUrl,
    });
  }

  async getActiveSprint(projectId: string): Promise<Sprint | null> {
    const data = await this.request<{ data: Sprint[] }>(
      "GET",
      `/api/nexus/projects/${projectId}/sprints?status=ACTIVE`,
    );
    return data.data[0] ?? null;
  }

  // ── Auth helpers ──────────────────────────────────────────────────────────

  async isAuthenticated(): Promise<boolean> {
    const tokens = await this.tokenStore.get();
    return tokens !== null;
  }

  async getCurrentUser(): Promise<{ id: string; email: string; name: string } | null> {
    const tokens = await this.tokenStore.get();
    if (!tokens) return null;
    return { id: tokens.userId, email: tokens.userEmail, name: tokens.userName };
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
    super("Not authenticated — run `npm run login` first");
    this.name = "NotAuthenticatedError";
  }
}
