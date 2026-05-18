import argparse
import json
import os
import sys


def configure_cache(cache_dir: str) -> None:
    os.makedirs(cache_dir, exist_ok=True)
    os.environ["HF_HOME"] = cache_dir
    os.environ["HUGGINGFACE_HUB_CACHE"] = cache_dir
    os.environ["TRANSFORMERS_CACHE"] = cache_dir
    os.environ["XDG_CACHE_HOME"] = cache_dir


def load_model(cache_dir: str):
    configure_cache(cache_dir)
    from faster_whisper import WhisperModel

    return WhisperModel("tiny", device="cpu", compute_type="int8")


def warmup(cache_dir: str) -> int:
    load_model(cache_dir)
    print(json.dumps({"status": "ready"}))
    return 0


def transcribe(audio_path: str, cache_dir: str) -> int:
    model = load_model(cache_dir)
    segments, info = model.transcribe(
        audio_path,
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    print(
        json.dumps(
            {
                "text": text,
                "language": getattr(info, "language", "") or "",
                "language_probability": getattr(info, "language_probability", 0.0) or 0.0,
            }
        )
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    warmup_parser = subparsers.add_parser("warmup")
    warmup_parser.add_argument("--cache-dir", required=True)

    transcribe_parser = subparsers.add_parser("transcribe")
    transcribe_parser.add_argument("--audio", required=True)
    transcribe_parser.add_argument("--cache-dir", required=True)

    args = parser.parse_args()

    try:
        if args.command == "warmup":
            return warmup(args.cache_dir)
        if args.command == "transcribe":
            return transcribe(args.audio, args.cache_dir)
        raise ValueError(f"Unsupported command: {args.command}")
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
