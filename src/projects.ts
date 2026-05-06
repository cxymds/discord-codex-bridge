import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { readCodexSessionProject } from "./sessionSync.js";
import type { ProjectChoice } from "./types.js";

export interface ProjectDiscoveryCache {
  get(): ProjectChoice[];
  refresh(): ProjectChoice[];
}

interface ProjectDiscoveryCacheOptions {
  refreshIntervalMs?: number;
  now?: () => number;
}

export function discoverCodexProjects(codexHome: string): ProjectChoice[] {
  const sessionsDir = join(codexHome, "sessions");
  if (!existsSync(sessionsDir)) {
    return [];
  }

  const projectsByPath = new Map<string, ProjectChoice>();
  const stack = [sessionsDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    try {
      for (const entry of readdirSync(current)) {
        const path = join(current, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          stack.push(path);
        } else if (entry.endsWith(".jsonl")) {
          const project = readCodexSessionProject(path);
          if (project.path) {
            projectsByPath.set(project.path, { name: project.name || basename(project.path), path: project.path, source: "codex" });
          }
        }
      }
    } catch {
      continue;
    }
  }

  return [...projectsByPath.values()].sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
}

export function createProjectDiscoveryCache(discover: () => ProjectChoice[], options: ProjectDiscoveryCacheOptions = {}): ProjectDiscoveryCache {
  const refreshIntervalMs = options.refreshIntervalMs ?? 30_000;
  const now = options.now ?? Date.now;
  let choices: ProjectChoice[] = [];
  let lastRefreshAt = Number.NEGATIVE_INFINITY;

  function refresh(): ProjectChoice[] {
    try {
      choices = discover();
      lastRefreshAt = now();
    } catch {
      lastRefreshAt = now();
    }
    return choices;
  }

  return {
    get() {
      if (now() - lastRefreshAt >= refreshIntervalMs) {
        return refresh();
      }
      return choices;
    },
    refresh
  };
}

export function mergeProjectChoices(registered: ProjectChoice[], discovered: ProjectChoice[]): ProjectChoice[] {
  const choicesByName = new Map<string, ProjectChoice>();
  for (const project of discovered) {
    choicesByName.set(project.name, project);
  }
  for (const project of registered) {
    choicesByName.set(project.name, project);
  }

  return [...choicesByName.values()].sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
}

export function formatProjectChoices(choices: ProjectChoice[], query = "", limit = 25): Array<{ name: string; value: string }> {
  const normalizedQuery = query.trim().toLowerCase();
  return choices
    .filter((choice) => {
      if (!normalizedQuery) return true;
      return choice.name.toLowerCase().includes(normalizedQuery) || choice.path.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, limit)
    .map((choice) => ({
      name: `${choice.name}  ${choice.path}`,
      value: choice.name
    }));
}
