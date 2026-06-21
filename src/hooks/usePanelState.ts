import { useState } from "react";
import { DEFAULT_SETTINGS } from "../appCore";

export function usePanelState() {
  const [automationOpen, setAutomationOpen] = useState(
    DEFAULT_SETTINGS.ui_automation_open,
  );
  const [workspaceOpen, setWorkspaceOpen] = useState(
    DEFAULT_SETTINGS.ui_workspace_open,
  );
  const [imageStudioOpen, setImageStudioOpen] = useState(
    DEFAULT_SETTINGS.ui_image_studio_open,
  );
  const [calendarOpen, setCalendarOpen] = useState(
    DEFAULT_SETTINGS.ui_calendar_open,
  );
  const [telegramPanelOpen, setTelegramPanelOpen] = useState(
    DEFAULT_SETTINGS.ui_telegram_open,
  );
  const [googlePanelOpen, setGooglePanelOpen] = useState(
    DEFAULT_SETTINGS.ui_google_open,
  );
  const [mediaPlayerPanelOpen, setMediaPlayerPanelOpen] = useState(
    DEFAULT_SETTINGS.ui_media_player_open,
  );
  const [samplingOpen, setSamplingOpen] = useState(
    DEFAULT_SETTINGS.ui_sampling_open,
  );
  const [leftPanelOpen, setLeftPanelOpen] = useState(
    DEFAULT_SETTINGS.ui_left_panel_open,
  );
  const [rightPanelOpen, setRightPanelOpen] = useState(
    DEFAULT_SETTINGS.ui_right_panel_open,
  );

  return {
    automationOpen,
    setAutomationOpen,
    workspaceOpen,
    setWorkspaceOpen,
    imageStudioOpen,
    setImageStudioOpen,
    calendarOpen,
    setCalendarOpen,
    telegramPanelOpen,
    setTelegramPanelOpen,
    googlePanelOpen,
    setGooglePanelOpen,
    mediaPlayerPanelOpen,
    setMediaPlayerPanelOpen,
    samplingOpen,
    setSamplingOpen,
    leftPanelOpen,
    setLeftPanelOpen,
    rightPanelOpen,
    setRightPanelOpen,
  };
}
