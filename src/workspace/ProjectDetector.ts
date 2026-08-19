import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import type { NexusClient, Project } from "../api/NexusClient.js";

const CACHE_PATH = path.join(os.homedir(), ".nexus-mcp", "project-cache.json");

/**
 * The public /api/v1/* surface has no git-remote → project lookup (that only
 * exists on the internal /api/nexus/* endpoints reserved for the official
 * extensions). Instead: read the task key off the current branch name
 * (e.g. feature/ALPHA-42-fix-login → ALPHA-42), take the prefix before the
 * dash (ALPHA), and match it against each project's `key`.
 */
export class ProjectDetector {
  constructor(private readonly client: NexusClient) {}

  async detect(cwd: string): Promise<Project | null> {
    const cached = this._getCached(cwd);
    if (cached) return cached;

    const taskKey = this.resolveCurrentBranchTaskKey(cwd);
    if (!taskKey) return null;

    const prefix = taskKey.split("-")[0];
    const { data: projects } = await this.client.listProjects();
    const project = projects.find((p) => p.key === prefix) ?? null;
    if (project) this._setCache(cwd, project);
    return project;
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

  // ── Cache ─────────────────────────────────────────────────────────────────

  private _readCacheFile(): Record<string, Project> {
    try {
      return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as Record<string, Project>;
    } catch {
      return {};
    }
  }

  private _getCached(cwd: string): Project | null {
    return this._readCacheFile()[cwd] ?? null;
  }

  private _setCache(cwd: string, project: Project): void {
    const map = this._readCacheFile();
    map[cwd] = project;
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(map, null, 2));
  }
}
