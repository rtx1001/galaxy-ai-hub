mod agent_mcp;
mod agent_react;
mod agent_shell;
mod agent_store;
mod agent_web;
mod app_paths;
mod assistant_runtime;
mod character_store;
mod config_store;
mod downloader;
mod engine_paths;
mod file_tools;
mod google_calendar;
mod image_runtime;
mod llama_manager;
mod omnivoice_runtime;
mod process_util;
mod resource_monitor;
mod setup_installer;
mod system_detect;
mod weather;

use std::{collections::HashMap, sync::Mutex};
use tauri::Manager;
use tauri::{LogicalSize, Size};

const DEFAULT_WINDOW_WIDTH: f64 = 1220.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 820.0;

fn cleanup_runtime_processes(app: &tauri::AppHandle) {
    image_runtime::shutdown_image_server();

    let llama_state = app.state::<llama_manager::LlamaState>();
    llama_manager::shutdown_model_process(llama_state.inner());

    let omnivoice_state = app.state::<omnivoice_runtime::OmniVoiceRuntimeState>();
    omnivoice_runtime::shutdown_omnivoice_process(omnivoice_state.inner());
}

fn apply_startup_window_layout(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_size(Size::Logical(LogicalSize {
            width: DEFAULT_WINDOW_WIDTH,
            height: DEFAULT_WINDOW_HEIGHT,
        }));
        let _ = window.center();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(llama_manager::LlamaState {
            process: std::sync::Arc::new(Mutex::new(None)),
            session: std::sync::Arc::new(Mutex::new(None)),
            profiles: std::sync::Arc::new(Mutex::new(HashMap::new())),
            transition_lock: std::sync::Arc::new(Mutex::new(())),
        })
        .manage(assistant_runtime::VoiceRuntimeState::default())
        .manage(omnivoice_runtime::OmniVoiceRuntimeState::default())
        .manage(assistant_runtime::TelegramRuntimeState::default())
        .manage(agent_shell::ShellApprovalState::default())
        .setup(|app| {
            let app_handle = app.handle().clone();
            apply_startup_window_layout(&app_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_detect::check_system,
            downloader::download_engine,
            downloader::check_engine_ready,
            downloader::get_engine_info,
            setup_installer::get_setup_catalog,
            setup_installer::get_setup_preflight,
            setup_installer::install_setup_bundle,
            setup_installer::install_setup_part,
            agent_store::remember_local_memory,
            agent_store::list_local_memory,
            agent_store::forget_local_memory,
            agent_store::create_automation_job,
            agent_store::update_automation_job,
            agent_store::list_automation_jobs,
            agent_store::set_automation_job_enabled,
            agent_store::delete_automation_job,
            agent_store::mark_automation_job_ran,
            agent_store::record_agent_tool_run,
            agent_store::list_agent_tool_runs,
            agent_store::clear_agent_tool_runs,
            agent_store::save_personality_chat_session,
            agent_store::load_personality_chat_session,
            agent_store::delete_personality_chat_session,
            character_store::load_character_files,
            character_store::save_character_files,
            character_store::delete_character_files,
            character_store::migrate_character_folders,
            agent_shell::propose_shell_action,
            agent_shell::list_pending_shell_actions,
            agent_shell::reject_shell_action,
            agent_shell::execute_shell_action,
            agent_web::agent_web_search,
            agent_react::agent_jan_chat,
            agent_mcp::mcp_stdio_list_tools,
            agent_mcp::mcp_stdio_call_tool,
            config_store::load_app_settings,
            config_store::save_app_settings,
            config_store::list_telegram_guests,
            file_tools::search_linked_files,
            file_tools::validate_workspace_folders,
            file_tools::list_linked_folder,
            file_tools::read_linked_text_file,
            file_tools::list_linked_media_files,
            file_tools::preview_linked_file,
            file_tools::write_linked_text_file,
            file_tools::move_linked_file,
            file_tools::trash_linked_file,
            file_tools::open_in_explorer,
            file_tools::open_with_default_app,
            file_tools::read_local_image_data_url,
            file_tools::save_chat_input_image_data_url,
            file_tools::reveal_file_location,
            google_calendar::get_google_connection_status,
            google_calendar::connect_google_calendar,
            google_calendar::disconnect_google_calendar,
            google_calendar::list_google_calendar_events,
            google_calendar::create_google_calendar_event,
            google_calendar::delete_google_calendar_event,
            google_calendar::list_google_gmail_messages,
            google_calendar::send_google_gmail_message,
            google_calendar::trash_google_gmail_message,
            google_calendar::delete_google_contact,
            google_calendar::execute_google_api,
            assistant_runtime::start_voice_setup,
            assistant_runtime::get_voice_setup_status,
            assistant_runtime::default_voice_samples_folder,
            assistant_runtime::list_voice_samples,
            assistant_runtime::detect_voice_sample_language,
            omnivoice_runtime::prepare_omnivoice_engine,
            omnivoice_runtime::get_omnivoice_engine_status,
            omnivoice_runtime::estimate_omnivoice_vram_need,
            omnivoice_runtime::stop_omnivoice_engine,
            omnivoice_runtime::get_cached_voice_test_speech,
            omnivoice_runtime::save_voice_test_speech,
            omnivoice_runtime::copy_voice_test_speech,
            assistant_runtime::transcribe_audio,
            omnivoice_runtime::synthesize_speech,
            assistant_runtime::generate_image,
            assistant_runtime::stop_image_generation,
            assistant_runtime::test_telegram_bot,
            assistant_runtime::start_telegram_bot,
            assistant_runtime::stop_telegram_bot,
            assistant_runtime::get_telegram_bot_status,
            assistant_runtime::append_app_log,
            assistant_runtime::get_graphics_power_status,
            assistant_runtime::get_system_resource_status,
            assistant_runtime::get_vram_memory_status,
            llama_manager::scan_model_folder,
            llama_manager::start_model,
            llama_manager::prepare_model_for_aux_task,
            llama_manager::restore_model_after_aux_task,
            llama_manager::stop_model,
            llama_manager::get_loaded_model_memory_status,
            llama_manager::get_model_load_status
        ])
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                cleanup_runtime_processes(window.app_handle());
                window.app_handle().exit(0);
            }
            tauri::WindowEvent::Destroyed => {
                cleanup_runtime_processes(window.app_handle());
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
