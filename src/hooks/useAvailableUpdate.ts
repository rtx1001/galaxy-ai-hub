import { useEffect, useState } from "react";

export type AvailableUpdate = {
  version: string;
  url: string;
};

export const CURRENT_APP_VERSION = "0.1.4";
const GITHUB_RELEASES_API = "https://api.github.com/repos/rtx1001/galaxy-ai-hub/releases?per_page=10";
const GITHUB_RELEASES_PAGE = "https://github.com/rtx1001/galaxy-ai-hub/releases";

const versionParts = (version: string) =>
  version
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map((part) => {
      const value = Number.parseInt(part, 10);
      return Number.isFinite(value) ? value : 0;
    });

const isNewerVersion = (candidate: string, current: string) => {
  const next = versionParts(candidate);
  const installed = versionParts(current);
  const length = Math.max(next.length, installed.length);
  for (let index = 0; index < length; index += 1) {
    const nextPart = next[index] ?? 0;
    const installedPart = installed[index] ?? 0;
    if (nextPart > installedPart) return true;
    if (nextPart < installedPart) return false;
  }
  return false;
};

export function useAvailableUpdate(enabled: boolean) {
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const controller = new AbortController();
    const checkForAppUpdate = async () => {
      try {
        const response = await fetch(GITHUB_RELEASES_API, {
          signal: controller.signal,
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!response.ok) return;
        const releases = (await response.json()) as Array<{
          tag_name?: string;
          html_url?: string;
          draft?: boolean;
        }>;
        const latest = releases.find((release) => !release.draft && release.tag_name);
        if (!latest?.tag_name || cancelled) return;
        if (isNewerVersion(latest.tag_name, CURRENT_APP_VERSION)) {
          setAvailableUpdate({
            version: latest.tag_name.replace(/^v/i, ""),
            url: latest.html_url || GITHUB_RELEASES_PAGE,
          });
        }
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("Update check failed:", error);
        }
      }
    };
    void checkForAppUpdate();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled]);

  return availableUpdate;
}
