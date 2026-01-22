from pathlib import Path
from fastapi import UploadFile, HTTPException
import shutil
from domain_store import CONTOURS_DIR

DIRS = {
    "svg": CONTOURS_DIR / "svg",
    "nc": CONTOURS_DIR / "nc",
    "preview": CONTOURS_DIR / "preview",
}


def save_file(
    file: UploadFile,
    target_dir: Path,
    filename: str,
    force: bool
):
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / filename

    if target_path.exists() and not force:
        raise HTTPException(
            status_code=409,
            detail=f"File {filename} already exists"
        )

    with target_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    return target_path
