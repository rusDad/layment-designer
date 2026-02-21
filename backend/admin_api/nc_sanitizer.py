from __future__ import annotations

import re
from typing import Dict, List, Optional

_G_AT_LINE_START_RE = re.compile(r"^\s*G\s*0*(\d+)\b", re.IGNORECASE)
_TOKEN_RE = re.compile(
    r"([A-Za-z])\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)"
)

_FOOTER_STRIP = {"M5", "G49", "M30"}

def _is_comment_or_empty(line: str) -> bool:
    s = line.strip()
    if not s:
        return True
    if s.startswith("'") or s.startswith(";"):
        return True
    if s.startswith("(") and s.endswith(")"):
        return True
    return False

def _parse_tokens(line: str) -> Dict[str, str]:
    # сохраняем строки значений (без float), чтобы не терять формат/точность
    tokens: Dict[str, str] = {}
    for letter, value in _TOKEN_RE.findall(line):
        tokens[letter.upper()] = value
    return tokens

def _motion_g(line: str) -> Optional[int]:
    m = _G_AT_LINE_START_RE.match(line.strip())
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None

def sanitize_fusion_nc_text(text: str) -> str:
    lines = text.splitlines()

    # 1) найти первую строку, начинающуюся с G1
    g1_idx: Optional[int] = None
    for i, raw in enumerate(lines):
        if _is_comment_or_empty(raw):
            continue
        g = _motion_g(raw)
        if g == 1:
            g1_idx = i
            break

    if g1_idx is None:
        raise ValueError("Cannot find first cutting move (line starting with G1)")

    # 2) найти последнюю строку G0 с X и Y перед G1
    entry_line: Optional[str] = None
    for j in range(g1_idx - 1, -1, -1):
        raw = lines[j]
        if _is_comment_or_empty(raw):
            continue
        g = _motion_g(raw)
        if g != 0:
            continue
        tokens = _parse_tokens(raw)
        if "X" in tokens and "Y" in tokens:
            entry_line = raw.strip()
            break

    # fallback: если нет G0 X/Y — попробуем взять X/Y из первой G1 и сделать G0
    if entry_line is None:
        tokens = _parse_tokens(lines[g1_idx])
        if "X" in tokens and "Y" in tokens:
            entry_line = f"G0 X{tokens['X']} Y{tokens['Y']}"

    out: List[str] = []
    if entry_line:
        out.append(entry_line)

    # 3) весь полезный код — с первой G1 и до конца
    out.extend([ln.rstrip() for ln in lines[g1_idx:]])

    # 4) убрать хвост M5/G49/M30 (и пустые строки)
    def is_footer_cmd(ln: str) -> bool:
        return ln.strip().upper() in _FOOTER_STRIP

    while out and (_is_comment_or_empty(out[-1]) or is_footer_cmd(out[-1])):
        out.pop()

    # финальный текст (с \n в конце — удобно для файлов)
    return ("\n".join(out).strip() + "\n") if out else ""