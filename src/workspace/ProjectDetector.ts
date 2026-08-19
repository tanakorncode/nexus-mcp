import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import type { NexusClient, Project } from "../api/NexusClient.js";

const CACHE_PATH = path.join(os.homedir(), ".nexus-mcp", "project-cache.json");

/**
 * Ported from nexus-vscode's ProjectDetector — same git remote → project
 * matching and branch → task key parsing. Swaps vscode.workspace /
 * workspaceState for a plain cwd argument and a local JSON cache file.
 */
export class ProjectDetector {
  constructor(private readonly client: NexusClient) {}

  async detect(cwd: string): Promise<Project | null> {
    const cached = this._getCached(cwd);
    if (cached) return cached;

    const remote = this._resolveGitRemote(cwd);
    if (!remote) return null;

    const project = await this.client.findProjectByGitRemote(remote);
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
      return this._parseTaskKeyFromBranch(branchMatch[1]);
    } catch {
      return null;
    }
  }

  private _parseTaskKeyFromBranch(branch: string): string | null {
    const match = branch.match(/([A-Z]+-\d+)/);
    return match?.[1] ?? null;
  }

  private _resolveGitRemote(cwd: string): string | null {
    const configPath = path.join(cwd, ".git", "config");
    if (!fs.existsSync(configPath)) return null;

    try {
      const config = fs.readFileSync(configPath, "utf8");
      return this._parseRemoteUrl(config);
    } catch {
      return null;
    }
  }

  private _parseRemoteUrl(gitConfig: string): string | null {
    const match = gitConfig.match(/\[remote\s+"origin"\][^\[]*url\s*=\s*(.+)/);
    if (!match) return null;
    return this._normalizeRemoteUrl(match[1].trim());
  }

  private _normalizeRemoteUrl(raw: string): string {
    return raw
      .replace(/^git@/, "")
      .replace(/^https?:\/\//, "")
      .replace(/:/, "/")
      .replace(/\.git$/, "")
      .toLowerCase()
      .trim();
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
