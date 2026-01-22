from fastapi import UploadFile, HTTPException
import xml.etree.ElementTree as ET


def validate_svg(file: UploadFile):
    try:
        ET.parse(file.file)
        file.file.seek(0)
    except Exception:
        raise HTTPException(400, "Invalid SVG file")


def validate_nc(file: UploadFile):
    if not file.filename.lower().endswith(".nc"):
        raise HTTPException(400, "NC file must have .nc extension")


def validate_preview(file: UploadFile):
    if not file.content_type.startswith("image/"):
        raise HTTPException(400, "Preview must be image")
