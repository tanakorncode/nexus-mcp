import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import type { NexusClient, Project, GitRepository } from "../api/NexusClient.js";

const CACHE_PATH = path.join(os.homedir(), ".nexus-mcp", "project-cache.json");

interface Detection {
  project: Project;
  repository: GitRepository | null;
}

/**
 * Two ways to resolve "what am I working on" from the current repo, tried in order:
 *
 * 1. Git remote → GitRepository (exact resource: which repo, which project).
 *    Requires the repo to be registered in Nexus (`GET /projects/:id/git-repositories`
 *    in the product UI) — falls through silently if it isn't.
 * 2. Branch name's task-key prefix → Project.key (e.g. feature/ALPHA-42-x → ALPHA).
 *    Coarser (project-level only, no repo match) but needs no registration.
 *
 * The public /api/v1/* surface has no git-remote lookup built in (that only
 * exists on the internal /api/nexus/* endpoints reserved for the official
 * extensions) — both of the above are client-side matching against list endpoints.
 */
export class ProjectDetector {
  constructor(private readonly client: NexusClient) {}

  async detect(cwd: string): Promise<Project | null> {
    const found = await this._detect(cwd);
    return found?.project ?? null;
  }

  async detectRepository(cwd: string): Promise<GitRepository | null> {
    const found = await this._detect(cwd);
    return found?.repository ?? null;
  }

  private async _detect(cwd: string): Promise<Detection | null> {
    const cached = this._getCached(cwd);
    if (cached) return cached;

    const byRepo = await this._detectByGitRemote(cwd);
    if (byRepo) {
      this._setCache(cwd, byRepo);
      return byRepo;
    }

    const byBranch = await this._detectByBranchTaskKey(cwd);
    if (byBranch) {
      this._setCache(cwd, byBranch);
      return byBranch;
    }

    return null;
  }

  private async _detectByGitRemote(cwd: string): Promise<Detection | null> {
    const remote = this._resolveGitRemote(cwd);
    if (!remote) return null;

    const normalizedRemote = this._normalizeRemoteUrl(remote);
    const repositories = await this.client.listRepositories();
    const repository = repositories.find(
      (r) => this._normalizeRemoteUrl(r.repoUrl) === normalizedRemote,
    );
    if (!repository) return null;

    const project = await this.client.getProject(repository.projectId);
    return { project, repository };
  }

  private async _detectByBranchTaskKey(cwd: string): Promise<Detection | null> {
    const taskKey = this.resolveCurrentBranchTaskKey(cwd);
    if (!taskKey) return null;

    const prefix = taskKey.split("-")[0];
    const { data: projects } = await this.client.listProjects();
    const project = projects.find((p) => p.key === prefix);
    if (!project) return null;

    return { project, repository: null };
  }

  resolveCurrentBranchTaskKey(cwd: string): string | null {
    const headPath = path.join(cwd, ".git", "HEAD");
    if (!fs.existsSync(headPath)) return null;

    try {
      const head = fs.readFileSync(headPath, "utf8").trim();
      const branchMatch = head.match(/^ref: refs\/heads\/(.+)$/);
      if (!branchMatch) return null;
      const match = branchMatch[1].match(/([A-Z]+-\d+)/);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  // ── Git remote ────────────────────────────────────────────────────────────

  private _resolveGitRemote(cwd: string): string | null {
    const configPath = path.join(cwd, ".git", "config");
    if (!fs.existsSync(configPath)) return null;

    try {
      const config = fs.readFileSync(configPath, "utf8");
      const match = config.match(/\[remote\s+"origin"\][^\[]*url\s*=\s*(.+)/);
      return match?.[1]?.trim() ?? null;
    } catch {
      return null;
    }
  }

  private _normalizeRemoteUrl(raw: string): string {
    return raw
      .replace(/^git@([^:]+):/, "https://$1/")
      .replace(/\.git$/, "")
      .replace(/\/$/, "")
      .toLowerCase()
      .trim();
  }

  // ── Cache ─────────────────────────────────────────────────────────────────

  private _readCacheFile(): Record<string, Detection> {
    try {
      return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as Record<string, Detection>;
    } catch {
      return {};
    }
  }

  private _getCached(cwd: string): Detection | null {
    return this._readCacheFile()[cwd] ?? null;
  }

  private _setCache(cwd: string, detection: Detection): void {
    const map = this._readCacheFile();
    map[cwd] = detection;
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(map, null, 2));
  }
}
