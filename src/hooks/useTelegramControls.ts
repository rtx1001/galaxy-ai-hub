import { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TelegramBotStatus } from "../appCore";

type UseTelegramControlsOptions = {
  buildAssistantRuntimePrompt: () => string;
  ensureAudioPlaybackUnlocked: () => Promise<unknown>;
  googleClientId: string;
  googleClientSecret: string;
  linkedFolders: string[];
  liveConversation: boolean;
  minP: number;
  repeatLastN: number;
  repeatPenalty: number;
  replyLength: number;
  samplingTemperature: number;
  setLiveConversation: Dispatch<SetStateAction<boolean>>;
  setTelegramRunning: Dispatch<SetStateAction<boolean>>;
  setTelegramStatus: Dispatch<SetStateAction<string>>;
  telegramBotToken: string;
  telegramOwnerId: string;
  thinkingEnabled: boolean;
  topK: number;
  topP: number;
};

export function useTelegramControls(options: UseTelegramControlsOptions) {
  const handleTestTelegram = async () => {
    options.setTelegramStatus("Checking Telegram...");
    try {
      const status = await invoke<TelegramBotStatus>("test_telegram_bot", {
        token: options.telegramBotToken,
      });
      options.setTelegramStatus(status.message);
    } catch (error) {
      options.setTelegramStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handleStartTelegram = async () => {
    options.setTelegramStatus("Starting Telegram control...");
    try {
      const status = await invoke<TelegramBotStatus>("start_telegram_bot", {
        token: options.telegramBotToken,
        ownerUserId: options.telegramOwnerId,
        systemPrompt: options.buildAssistantRuntimePrompt(),
        temperature: options.samplingTemperature,
        thinkingEnabled: options.thinkingEnabled,
        topK: options.topK,
        topP: options.topP,
        minP: options.minP,
        repeatLastN: options.repeatLastN,
        repeatPenalty: options.repeatPenalty,
        maxTokens: Math.min(options.replyLength, 768),
        googleClientId: options.googleClientId,
        googleClientSecret: options.googleClientSecret,
        folders: options.linkedFolders,
      });
      options.setTelegramRunning(status.success);
      options.setTelegramStatus(status.message);
    } catch (error) {
      options.setTelegramRunning(false);
      options.setTelegramStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handleStopTelegram = async () => {
    try {
      const status = await invoke<TelegramBotStatus>("stop_telegram_bot");
      options.setTelegramRunning(false);
      options.setTelegramStatus(status.message);
    } catch (error) {
      options.setTelegramStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const setAutoVoiceMode = (enabled: boolean) => {
    if (enabled) {
      options.ensureAudioPlaybackUnlocked().catch(() => null);
      invoke("prepare_omnivoice_engine").catch(() => undefined);
    }
    options.setLiveConversation(enabled);
  };

  return {
    handleStartTelegram,
    handleStopTelegram,
    handleTestTelegram,
    setAutoVoiceMode,
  };
}
