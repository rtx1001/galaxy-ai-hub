import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { DEFAULT_SETTINGS } from "../appCore";

export function useWorkspaceFolders() {
  const [linkedFolders, setLinkedFolders] = useState<string[]>(
    DEFAULT_SETTINGS.linked_folders,
  );

  const handleAddLinkedFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Add a folder for future file tools",
      defaultPath: linkedFolders[0] || undefined,
    });

    if (typeof selected !== "string") {
      return;
    }

    setLinkedFolders((prev) =>
      prev.includes(selected) ? prev : [...prev, selected],
    );
  };

  const handleRemoveLinkedFolder = (folderPath: string) => {
    setLinkedFolders((prev) => prev.filter((folder) => folder !== folderPath));
  };

  return {
    linkedFolders,
    setLinkedFolders,
    handleAddLinkedFolder,
    handleRemoveLinkedFolder,
  };
}
