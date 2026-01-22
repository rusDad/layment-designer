import json
import tempfile
import shutil
from pathlib import Path
from domain_store import MANIFEST_PATH


def load_manifest():
    if not MANIFEST_PATH.exists():
        raise RuntimeError("manifest.json not found")

    with MANIFEST_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_manifest_atomic(data: dict):
    tmp_dir = MANIFEST_PATH.parent

    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=tmp_dir,
        delete=False
    ) as tmp:
        json.dump(data, tmp, ensure_ascii=False, indent=2)
        tmp_path = Path(tmp.name)

    shutil.move(tmp_path, MANIFEST_PATH)
