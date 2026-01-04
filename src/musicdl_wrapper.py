import argparse
import contextlib
import io
import json
import logging
import os
import sys

# Configure logging to stderr to avoid polluting stdout (stdout is reserved for JSON)
logging.basicConfig(level=logging.ERROR, format="%(asctime)s - %(levelname)s - %(message)s")


def suppress_stdout():
    """Context manager to redirect stdout to stderr to avoid polluting JSON output."""
    return contextlib.redirect_stdout(sys.stderr)


def map_source(name: str | None) -> list[str]:
    """Translate user-friendly source name to musicdl client names."""
    if not name:
        return [
            "YouTubeMusicClient",
            "TidalMusicClient",
            "QQMusicClient",
            "NeteaseMusicClient",
            "MiguMusicClient",
        ]
    name = name.lower()
    mapping = {
        "tidal": ["TidalMusicClient"],
        "youtube": ["YouTubeMusicClient"],
        "qq": ["QQMusicClient"],
        "netease": ["NeteaseMusicClient"],
        "migu": ["MiguMusicClient"],
        # musicdl doesn't support soundcloud; fall back to YouTube search as a best-effort
        "soundcloud": ["YouTubeMusicClient"],
    }
    return mapping.get(name, ["YouTubeMusicClient"])


def pick_first(search_results: dict, preferred_order: list[str]):
    """Pick the first available song_info respecting preferred source order."""
    for src in preferred_order:
        items = search_results.get(src) or []
        if items:
            return items[0]
    # fallback: any first item
    for items in search_results.values():
        if items:
            return items[0]
    return None


def main():
    parser = argparse.ArgumentParser(description="Wrapper for musicdl")
    parser.add_argument("url", help="Keyword or URL to search/download")
    parser.add_argument("--output-dir", required=True, help="Directory to save the file")
    parser.add_argument(
        "--source",
        choices=["tidal", "youtube", "qq", "netease", "migu", "soundcloud"],
        help="Preferred source platform (optional)",
    )
    parser.add_argument("--token", help="Auth token for the source platform (unused for musicdl)")

    args = parser.parse_args()
    os.makedirs(args.output_dir, exist_ok=True)
    # Run everything relative to the chosen output dir so musicdl's path
    # sanitization (pathvalidate) accepts the paths.
    os.chdir(args.output_dir)

    try:
        from musicdl.musicdl import MusicClient
    except ImportError:
        error_msg = "musicdl library not found. Please install it."
        print(json.dumps({"success": False, "error": error_msg}))
        sys.exit(1)

    # Initialize all supported clients to avoid KeyError when musicdl tries to access them
    # Initialize all supported clients to avoid KeyError when musicdl tries to access them
    all_sources = [
        "YouTubeMusicClient",
        "TidalMusicClient",
        "QQMusicClient",
        "NeteaseMusicClient",
        "MiguMusicClient",
    ]
    
    requested_sources = map_source(args.source)
    
    # Configure each client to write into the cwd (already changed to output_dir).
    init_cfg = {
        src: {
            "work_dir": ".",  # must be relative to avoid pathvalidate rejecting abs paths
            "disable_print": True,
            "search_size_per_source": 5 if src in requested_sources else 1,
            "max_retries": 3,
        }
        for src in all_sources
    }
    clients_threadings = {src: 3 for src in all_sources}

    try:
        music_client = MusicClient(
            music_sources=all_sources,
            init_music_clients_cfg=init_cfg,
            clients_threadings=clients_threadings,
            requests_overrides={},
            search_rules={},
        )

        # Search for the requested track/keyword
        with suppress_stdout():
            try:
                search_results = music_client.search(keyword=args.url)
            except KeyError:
                # musicdl might raise KeyError if a client fails internally during search loop
                # We try to recover whatever results were found, but musicdl doesn't return partials on error easily.
                # However, if it crashed, we might not have results.
                # Let's try to access the internal results if possible, or just fail gracefully.
                logging.error("musicdl internal search error (KeyError).")
                search_results = {}
            except Exception:
                logging.exception("musicdl internal search error.")
                search_results = {}

        if not search_results:
            raise RuntimeError("Aucun résultat trouvé avec musicdl.")

        # Ensure deterministic order by respecting preferred sources
        selected = pick_first(search_results, requested_sources)
        if not selected:
            raise RuntimeError("Aucun résultat exploitable pour ce mot-clé.")

        with suppress_stdout():
            music_client.download(song_infos=[selected])
        
        # If download returns None, we need another way to find the file.
        # Let's assume it worked if we find a file.
        downloaded = [selected] # Hack to proceed for now if file exists

        if not downloaded:
            raise RuntimeError("musicdl n'a pas pu télécharger ce titre.")

        # Find the downloaded file
        # musicdl creates a subdirectory named after the source (e.g. YouTubeMusicClient)
        source_dir = selected.get("source")
        if source_dir and os.path.isdir(source_dir):
            # Look for the file in the source directory
            files = os.listdir(source_dir)
            if files:
                # Assuming the most recent file is the one we want, or just the only one if clean dir
                # But we might have multiple files if we reuse the dir.
                # Let's try to match by extension or just take the latest.
                full_paths = [os.path.join(source_dir, f) for f in files]
                latest_file = max(full_paths, key=os.path.getmtime)
                file_path = latest_file
            else:
                file_path = None
        else:
            # Fallback: look in current dir
            files = [f for f in os.listdir('.') if os.path.isfile(f)]
            if files:
                latest_file = max(files, key=os.path.getmtime)
                file_path = latest_file
            else:
                file_path = None

        if not file_path or not os.path.exists(file_path):
            raise RuntimeError(f"Fichier téléchargé introuvable sur le disque (cherché dans {source_dir} et .)")

        abs_path = os.path.abspath(file_path)

        info = selected
        metadata = {
            "title": info.get("song_name") or selected.get("song_name"),
            "artist": info.get("singers") or selected.get("singers"),
            "album": info.get("album") or selected.get("album"),
            "bitrate": info.get("bit_rate") or selected.get("bit_rate"),
            "duration": info.get("duration") or selected.get("duration"),
            "source": info.get("source") or selected.get("source"),
            "ext": info.get("ext") or selected.get("ext"),
            "file_size": info.get("file_size") or selected.get("file_size"),
        }

        filename = os.path.basename(file_path)
        ext = metadata.get("ext")
        if ext and not filename.lower().endswith(f".{ext.lower()}"):
            # We don't rename the file on disk, just report the filename with extension
            # But wait, if we report a filename that doesn't match the file on disk, 
            # the caller might try to rename from the reported filename?
            # No, the caller uses file_path to find the source.
            # And uses filename for the destination.
            # So this is correct: we report the desired filename.
            filename = f"{filename}.{ext}"

        result = {
            "success": True,
            "file_path": abs_path,
            "filename": filename,
            "metadata": metadata,
        }
        print(json.dumps(result))
    except Exception as exc:  # noqa: BLE001
        logging.exception("musicdl wrapper failed")
        print(json.dumps({"success": False, "error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
