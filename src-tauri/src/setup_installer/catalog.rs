use super::*;

pub(super) fn portable_models_dir() -> PathBuf {
    app_root_dir().join("assistant-runtime").join("models")
}

pub(super) fn brain_model_folder_for_tier(tier: &str) -> PathBuf {
    portable_models_dir()
        .join("brain")
        .join(brain_choice(tier).folder_name)
}

pub(super) fn selected_brain_model_path_for_tier(tier: &str) -> PathBuf {
    brain_model_folder_for_tier(tier).join("model.gguf")
}

pub(super) struct BrainChoice {
    folder_name: &'static str,
    model_name: &'static str,
    repo: &'static str,
    file: &'static str,
    size_hint: &'static str,
    mmproj_repo: &'static str,
    mmproj_file: &'static str,
    mmproj_size_hint: &'static str,
}

pub(super) fn brain_choice(tier: &str) -> BrainChoice {
    match tier {
        "light" => BrainChoice {
            folder_name: "Gemma-4-E2B-Hauhau-Q4_K_P",
            model_name: "Gemma 4 E2B Hauhau Q4",
            repo: "HauhauCS/Gemma-4-E2B-Uncensored-HauhauCS-Aggressive",
            file: "Gemma-4-E2B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf",
            size_hint: "about 3.2 GB",
            mmproj_repo: "HauhauCS/Gemma-4-E2B-Uncensored-HauhauCS-Aggressive",
            mmproj_file: "mmproj-Gemma-4-E2B-Uncensored-HauhauCS-Aggressive-f16.gguf",
            mmproj_size_hint: "about 940 MB",
        },
        "high" => BrainChoice {
            folder_name: "Gemma-4-E4B-Hauhau-Q8_K_P",
            model_name: "Gemma 4 E4B Hauhau Q8",
            repo: "HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive",
            file: "Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf",
            size_hint: "about 7.6 GB",
            mmproj_repo: "HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive",
            mmproj_file: "mmproj-Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-f16.gguf",
            mmproj_size_hint: "about 944 MB",
        },
        _ => BrainChoice {
            folder_name: "Gemma-4-E4B-Hauhau-Q4_K_P",
            model_name: "Gemma 4 E4B Hauhau Q4",
            repo: "HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive",
            file: "Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf",
            size_hint: "about 5.0 GB",
            mmproj_repo: "HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive",
            mmproj_file: "mmproj-Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-f16.gguf",
            mmproj_size_hint: "about 944 MB",
        },
    }
}

pub(super) fn hf_url(repo: &str, file: &str) -> String {
    format!(
        "https://huggingface.co/{}/resolve/main/{}?download=true",
        repo,
        file.replace('\\', "/")
    )
}

pub(super) fn relative_display(path: &Path) -> String {
    path.strip_prefix(app_root_dir())
        .unwrap_or(path)
        .display()
        .to_string()
}

pub(super) fn setup_file(
    label: &str,
    repo: &str,
    file: &str,
    destination: PathBuf,
    size_hint: &str,
) -> SetupFile {
    SetupFile {
        label: label.to_string(),
        url: hf_url(repo, file),
        destination: relative_display(&destination),
        size_hint: size_hint.to_string(),
        extract_to: None,
    }
}

pub(super) fn setup_archive_file(
    label: &str,
    url: &str,
    destination: PathBuf,
    extract_to: PathBuf,
    size_hint: &str,
) -> SetupFile {
    SetupFile {
        label: label.to_string(),
        url: url.to_string(),
        destination: relative_display(&destination),
        size_hint: size_hint.to_string(),
        extract_to: Some(relative_display(&extract_to)),
    }
}

pub(super) fn brain_files(tier: &str) -> Vec<SetupFile> {
    let choice = brain_choice(tier);
    vec![
        setup_file(
            choice.model_name,
            choice.repo,
            choice.file,
            selected_brain_model_path_for_tier(tier),
            choice.size_hint,
        ),
        setup_file(
            "Gemma 4 vision projector",
            choice.mmproj_repo,
            choice.mmproj_file,
            brain_model_folder_for_tier(tier).join("mmproj.gguf"),
            choice.mmproj_size_hint,
        ),
    ]
}

pub(super) fn voice_files(tier: &str) -> Vec<SetupFile> {
    let (base_file, tokenizer_file, quant_label, size_hint) = match tier {
        "light" => (
            "omnivoice-base-Q4_K_M.gguf",
            "omnivoice-tokenizer-Q4_K_M.gguf",
            "Q4",
            "about 650 MB",
        ),
        _ => (
            "omnivoice-base-Q8_0.gguf",
            "omnivoice-tokenizer-Q8_0.gguf",
            "Q8",
            "about 1.2 GB",
        ),
    };
    let root = app_root_dir()
        .join("assistant-runtime")
        .join("voice-tts")
        .join("models")
        .join("omnivoice.cpp");
    vec![
        setup_file(
            &format!("Speech base {}", quant_label),
            "Serveurperso/OmniVoice-GGUF",
            base_file,
            root.join(base_file),
            size_hint,
        ),
        setup_file(
            &format!("Speech tokenizer {}", quant_label),
            "Serveurperso/OmniVoice-GGUF",
            tokenizer_file,
            root.join(tokenizer_file),
            "about 30 MB",
        ),
    ]
}

pub(super) struct WhisperChoice {
    model_name: &'static str,
    repo: &'static str,
    size_hint: &'static str,
}

pub(super) fn whisper_choice(tier: &str) -> WhisperChoice {
    match tier {
        "light" => WhisperChoice {
            model_name: "faster-whisper-base",
            repo: "Systran/faster-whisper-base",
            size_hint: "about 145 MB",
        },
        "high" => WhisperChoice {
            model_name: "faster-whisper-medium",
            repo: "Systran/faster-whisper-medium",
            size_hint: "about 1.53 GB",
        },
        _ => WhisperChoice {
            model_name: "faster-whisper-small",
            repo: "Systran/faster-whisper-small",
            size_hint: "about 484 MB",
        },
    }
}

pub(super) fn voice_helper_model_dir(tier: &str) -> PathBuf {
    let choice = whisper_choice(tier);
    app_root_dir()
        .join("assistant-runtime")
        .join("voice")
        .join("models")
        .join(choice.model_name)
}

pub(super) fn voice_helper_marker_path() -> PathBuf {
    app_root_dir()
        .join("assistant-runtime")
        .join("voice")
        .join("selected-whisper-model.txt")
}

pub(super) fn voice_helper_files(tier: &str) -> Vec<SetupFile> {
    let choice = whisper_choice(tier);
    let model_dir = voice_helper_model_dir(tier);
    vec![
        setup_archive_file(
            "Voice engine",
            "https://github.com/rtx1001/galaxy-ai-hub/releases/latest/download/GalaxyAIHub-voice-runtime-win64.zip",
            app_root_dir()
                .join("assistant-runtime")
                .join("download-cache")
                .join("GalaxyAIHub-voice-runtime-win64.zip"),
            app_root_dir()
                .join("assistant-runtime")
                .join("voice-tts")
                .join("bin"),
            "about 160 MB",
        ),
        setup_file(
            "Whisper config",
            choice.repo,
            "config.json",
            model_dir.join("config.json"),
            "about 3 KB",
        ),
        setup_file(
            "Whisper model",
            choice.repo,
            "model.bin",
            model_dir.join("model.bin"),
            choice.size_hint,
        ),
        setup_file(
            "Whisper tokenizer",
            choice.repo,
            "tokenizer.json",
            model_dir.join("tokenizer.json"),
            "about 2.2 MB",
        ),
        setup_file(
            "Whisper vocabulary",
            choice.repo,
            "vocabulary.txt",
            model_dir.join("vocabulary.txt"),
            "about 460 KB",
        ),
    ]
}

pub(super) fn sd_runtime_file(has_nvidia_gpu: bool) -> SetupFile {
    let cache = app_root_dir()
        .join("assistant-runtime")
        .join("download-cache");
    let extract_to = app_root_dir().join("bin").join("stable-diffusion");
    if has_nvidia_gpu {
        setup_archive_file(
            "Image engine CUDA",
            "https://sourceforge.net/projects/stable-diffusion-cpp.mirror/files/master-650-1ceb5bd/sd-master-1ceb5bd-bin-win-cuda12-x64.zip/download",
            cache.join("sd-master-1ceb5bd-bin-win-cuda12-x64.zip"),
            extract_to,
            "about 337 MB",
        )
    } else {
        setup_archive_file(
            "Image engine CPU",
            "https://sourceforge.net/projects/stable-diffusion-cpp.mirror/files/master-650-1ceb5bd/sd-master-1ceb5bd-bin-win-avx2-x64.zip/download",
            cache.join("sd-master-1ceb5bd-bin-win-avx2-x64.zip"),
            extract_to,
            "about 14 MB",
        )
    }
}

pub(super) fn image_files(tier: &str, has_nvidia_gpu: bool) -> Vec<SetupFile> {
    let mut files = vec![sd_runtime_file(has_nvidia_gpu)];
    if tier == "high" {
        let root = app_root_dir()
            .join("assistant-runtime")
            .join("sdcpp")
            .join("models")
            .join("qwen-edit");
        files.extend([
            setup_file(
                "Qwen Image Edit",
                "Novice25/Qwen-Image-Edit-Rapid-AIO-GGUF",
                "v23/Qwen-Rapid-NSFW-v23_Q6_K.gguf",
                root.join("Qwen-Rapid-NSFW-v23_Q6_K.gguf"),
                "about 17.0 GB",
            ),
            setup_file(
                "Image text encoder",
                "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF",
                "Qwen2.5-VL-7B-Instruct.Q6_K.gguf",
                root.join("text_encoders")
                    .join("Qwen2.5-VL-7B-Instruct.Q6_K.gguf"),
                "about 6.0 GB",
            ),
            setup_file(
                "Image projector",
                "mradermacher/Qwen2.5-VL-7B-Instruct-GGUF",
                "Qwen2.5-VL-7B-Instruct.mmproj-Q8_0.gguf",
                root.join("text_encoders")
                    .join("Qwen2.5-VL-7B-Instruct.mmproj-Q8_0.gguf"),
                "about 814 MB",
            ),
            setup_file(
                "Image VAE",
                "QuantStack/Qwen-Image-Edit-GGUF",
                "VAE/Qwen_Image-VAE.safetensors",
                root.join("vae").join("qwen_image_vae.safetensors"),
                "about 500 MB",
            ),
        ]);
        return files;
    }

    let root = app_root_dir()
        .join("assistant-runtime")
        .join("sdcpp")
        .join("models")
        .join("z-image-turbo");
    let (model_file, model_size) = if tier == "light" {
        ("z_image_turbo-Q4_K.gguf", "about 3.6 GB")
    } else {
        ("z_image_turbo-Q6_K.gguf", "about 4.9 GB")
    };
    files.extend([
        setup_file(
            "Z-Image Turbo",
            "leejet/Z-Image-Turbo-GGUF",
            model_file,
            root.join(model_file),
            model_size,
        ),
        setup_file(
            "Image text encoder",
            "WeReCooking/flux2-klein-4B-uncensored-text-encoder",
            "qwen3-4b-abl-q4_0.gguf",
            root.join("qwen3-4b-abl-q4_0.gguf"),
            "about 2.3 GB",
        ),
        setup_file(
            "Image VAE",
            "Kijai/flux-fp8",
            "flux-vae-bf16.safetensors",
            root.join("ae.safetensors"),
            "about 320 MB",
        ),
    ]);
    files
}
