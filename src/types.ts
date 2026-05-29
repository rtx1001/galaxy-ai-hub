export type ChatContentPart = | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; local_path?: string } }
      | { type: "tool_result_cards"; cards: ToolResultCard[] }
      | { type: "file_preview"; file_preview: FilePreviewResult }
      | { type: "image_proposal"; image_proposal: ImageProposal }
      | { type: "action_proposal"; action_proposal: ActionProposal };
export type ChatMessage = {
      id: string;
      role: "user" | "assistant";
      content: string | ChatContentPart[];
      thinking?: string;
      created_at?: number;
      completed_at?: number;
      duration_ms?: number;
    };
export type ChatSessions = Record<string, ChatMessage[]>;
export type EngineInfo = {
      ready: boolean;
      source: string;
      version: string;
      build: number | null;
      supports_mmproj: boolean;
    };
export type ModelLoadStatus = {
      state: string;
      message: string;
      progress: number;
    };
export type VoiceSetupStatus = {
      state: string;
      message: string;
      progress: number;
      ready: boolean;
    };
export type ResourceBarStatus = {
      label: string;
      available: boolean;
      percent: number;
      summary: string;
    };
export type SystemResourceStatus = {
      vram: ResourceBarStatus;
      gpu_temp: ResourceBarStatus;
      ram: ResourceBarStatus;
      cpu: ResourceBarStatus;
      cpu_temp: ResourceBarStatus;
    };
export type ToolResultCard = {
      kind: string;
      title: string;
      summary: string | null;
      fields: ToolResultField[];
      items: ToolResultItem[];
      text: string | null;
    };
export type ToolResultField = {
      label: string;
      value: string;
    };
export type ToolResultItem = {
      title: string;
      subtitle: string | null;
      details: ToolResultField[];
      url: string | null;
    };
export type ImageProposal = {
      prompt: string;
      mode: string;
      mask_prompt?: string | null;
    };
export type ActionProposal = {
      action_type: string;
      title: string;
      details: string;
      risk_level: string;
      arguments: Record<string, unknown>;
    };
export type FilePreviewResult = {
      path: string;
      name: string;
      extension: string;
      mime_type: string;
      size_bytes: number;
      data_url: string | null;
      text: string | null;
      perception?: string | null;
      truncated: boolean;
    };
export type GoogleCalendarEvent = {
      id: string;
      title: string;
      start: string;
      end: string;
      all_day: boolean;
      location: string | null;
      description: string | null;
      html_link: string | null;
    };
