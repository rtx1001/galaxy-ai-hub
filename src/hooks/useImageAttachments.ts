import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { LocalImageDataUrl } from "../appCore";

type ImageViewerState = {
  url: string;
  localPath?: string;
  zoom: number;
  x: number;
  y: number;
};

export function useImageAttachments({
  setComposerNotice,
}: {
  setComposerNotice: (notice: string) => void;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageViewer, setImageViewer] = useState<ImageViewerState | null>(null);

  const clearImage = () => {
    setImage(null);
    setImagePath(null);
  };

  const handleImageSelected = (
    dataUrl: string,
    localPath: string | null = null,
  ) => {
    setComposerNotice("");
    setImage(dataUrl);
    setImagePath(localPath);
  };

  const attachImageFromFile = (file: File | null | undefined) => {
    if (!file || !file.type.startsWith("image/")) {
      setComposerNotice("Please choose a picture file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const localPath =
        typeof (file as File & { path?: string }).path === "string"
          ? (file as File & { path?: string }).path ?? null
          : null;
      handleImageSelected(event.target?.result as string, localPath);
    };
    reader.readAsDataURL(file);
  };

  const chooseImageForComposer = async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Choose an image",
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] },
      ],
    });
    if (typeof selected !== "string") return;
    try {
      const result = await invoke<LocalImageDataUrl>("read_local_image_data_url", {
        path: selected,
      });
      handleImageSelected(result.data_url, result.path);
    } catch (error) {
      setComposerNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const revealImageLocation = async (localPath: string) => {
    try {
      await invoke("reveal_file_location", { path: localPath });
    } catch (error) {
      console.error("Reveal image location error:", error);
      setComposerNotice(`Image saved at: ${localPath}`);
    }
  };

  const openImageViewer = (url: string, localPath?: string) => {
    if (!url) return;
    setImageViewer({ url, localPath, zoom: 1, x: 0, y: 0 });
  };

  const readAvatarImage = (
    file: File | null | undefined,
    onReady: (dataUrl: string) => void,
  ) => {
    if (!file || !file.type.startsWith("image/")) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const originalDataUrl = event.target?.result as string;
      const imageElement = new Image();
      imageElement.onload = () => {
        const maxSide = 512;
        const scale = Math.min(
          1,
          maxSide / Math.max(imageElement.width, imageElement.height),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(imageElement.width * scale));
        canvas.height = Math.max(1, Math.round(imageElement.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          onReady(originalDataUrl);
          return;
        }
        context.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
        onReady(canvas.toDataURL("image/jpeg", 0.82));
      };
      imageElement.onerror = () => onReady(originalDataUrl);
      imageElement.src = originalDataUrl;
    };
    reader.readAsDataURL(file);
  };

  const compressAvatarDataUrl = (dataUrl: string) =>
    new Promise<string>((resolve) => {
      if (!/^data:image\//i.test(dataUrl) || dataUrl.length < 220_000) {
        resolve(dataUrl);
        return;
      }

      const imageElement = new Image();
      imageElement.onload = () => {
        const maxSide = 512;
        const scale = Math.min(
          1,
          maxSide / Math.max(imageElement.width, imageElement.height),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(imageElement.width * scale));
        canvas.height = Math.max(1, Math.round(imageElement.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(dataUrl);
          return;
        }
        context.fillStyle = "#131314";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      imageElement.onerror = () => resolve(dataUrl);
      imageElement.src = dataUrl;
    });

  useEffect(() => {
    if (!imageViewer) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setImageViewer(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [imageViewer]);

  return {
    image,
    imagePath,
    imageViewer,
    setImageViewer: setImageViewer as Dispatch<SetStateAction<ImageViewerState | null>>,
    clearImage,
    attachImageFromFile,
    chooseImageForComposer,
    compressAvatarDataUrl,
    readAvatarImage,
    revealImageLocation,
    openImageViewer,
  };
}
