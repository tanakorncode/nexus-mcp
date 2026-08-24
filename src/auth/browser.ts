import { spawn } from "child_process";

/** Best-effort cross-platform "open URL in default browser" — the caller always
 * also prints the URL, since this can silently fail (headless box, no default
 * browser configured, etc.) and there's no reliable way to detect that upfront. */
export function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;
  let args: string[];

  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", '""', url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  try {
    spawn(command, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // fall through — caller already printed the URL to open manually
  }
}
