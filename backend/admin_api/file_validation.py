from fastapi import UploadFile, HTTPException
import xml.etree.ElementTree as ET
import re


MAX_NC_VALIDATION_ERRORS = 10
_NC_TOKEN_RE = re.compile(
    r"\s*([A-Za-z])\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)"
)


def validate_svg(file: UploadFile):
    try:
        ET.parse(file.file)
        file.file.seek(0)
    except Exception:
        raise HTTPException(400, "Invalid SVG file")


def validate_nc(file: UploadFile):
    if not file.filename.lower().endswith(".nc"):
        raise HTTPException(400, "NC file must have .nc extension")

    raw_content = file.file.read()
    file.file.seek(0)

    try:
        content = raw_content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "NC file must be UTF-8 encoded text")

    errors = []
    for line_number, raw_line in enumerate(content.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("'"):          # <-- добавили апостроф как комментарий
            continue
        if line.startswith(";"):
            continue
        if line.startswith("(") and line.endswith(")"):
            continue

        line_errors = []
        first = _NC_TOKEN_RE.match(line, 0)
        first_letter = first.group(1).upper() if first else None
        if not first or first_letter not in {"G", "X", "Y", "Z"}:
            line_errors.append("line must start with G0/G1/G2/G3 or a modal X/Y/Z")
        else:
            if first_letter == "G":
                g_raw = first.group(2)
                try:
                    g_value = float(g_raw)
                    if not g_value.is_integer() or int(g_value) not in {0, 1, 2, 3}:
                        line_errors.append("only G0/G1/G2/G3 commands are allowed")
                except ValueError:
                    line_errors.append("invalid G command")

        cursor = first.end() if first else 0
        while cursor < len(line):
            token = _NC_TOKEN_RE.match(line, cursor)
            if not token:
                if line[cursor:].strip():
                    line_errors.append("invalid syntax")
                break

            letter = token.group(1).upper()
            if letter in {"I", "J"}:
                line_errors.append("I/J parameters are forbidden, use R arcs")
            elif letter not in {"X", "Y", "Z", "F", "R"}:
                line_errors.append(
                    f"unsupported parameter '{letter}' (allowed: X/Y/Z/F/R)"
                )
            cursor = token.end()

        if line_errors:
            unique_errors = "; ".join(dict.fromkeys(line_errors))
            errors.append(
                f"line {line_number}: {raw_line.rstrip()} ({unique_errors})"
            )
            if len(errors) >= MAX_NC_VALIDATION_ERRORS:
                break

    if errors:
        error_details = "\n".join(errors)
        raise HTTPException(
            400,
            f"Invalid NC file. First {len(errors)} issue(s):\n{error_details}",
        )


def validate_preview(file: UploadFile):
    if not file.content_type.startswith("image/"):
        raise HTTPException(400, "Preview must be image")
