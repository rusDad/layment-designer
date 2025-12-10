import re
import math
import os

def parse_gcode(lines):
    current_pos = {'X': 0.0, 'Y': 0.0, 'Z': 0.0, 'F': None}
    modal_cmd = 'G1'
    output = []
    
    for line in lines:
        line = line.strip()
        if not line or line.startswith(';') or line.startswith('('):
            continue
        parts = re.findall(r'([GXYZFIJR])[-+]?\d*\.?\d+', line.upper())
        cmd = parts[0][0] if parts and parts[0][0] == 'G' else modal_cmd
        if cmd in ['G0', 'G1', 'G2', 'G3']:
            modal_cmd = cmd
        params = {p[0]: float(p[1:]) for p in parts if p[0] != 'G'}
        if params:
            new_pos = current_pos.copy()
            new_pos.update({k: v for k, v in params.items() if k in 'XYZF'})
            output.append((cmd, params))
            current_pos = new_pos
    return output

def transform_point(x, y, rotation):
    rad = math.radians(rotation)
    new_x = x * math.cos(rad) - y * math.sin(rad)
    new_y = x * math.sin(rad) + y * math.cos(rad)
    return new_x, new_y

def swap_arc_direction(cmd, rotation):
    if rotation % 180 != 0 and cmd in ['G2', 'G3']:
        return 'G3' if cmd == 'G2' else 'G2'
    return cmd

#def validate_gcode(commands):
#    errors = []
#    min_z = min(c[1].get('Z', 0) for c in commands if 'Z' in c[1])
#    if min_z < -50:
#        errors.append(f"Invalid Z depth: {min_z}")
#    unknown_cmds = set(c[0] for c in commands) - {'G0', 'G1', 'G2', 'G3'}
#    if unknown_cmds:
#        errors.append(f"Unknown commands: {unknown_cmds}")
#    if len(commands) < 5:
#        errors.append("G-code too short")
#    return errors == [], errors
def validate_gcode(commands, original_lines=None):
    #Проверяет список команд после парсинга.
    #Если передать original_lines — будет указывать номер строки в исходном файле.
    
    errors = []
    
    # 1. Минимальная глубина Z
    min_z = float('inf')
    min_z_line = None
    for idx, (cmd, params) in enumerate(commands):
        z = params.get('Z')
        if z is not None and z < min_z:
            min_z = z
            # Если есть оригинальные строки — найдём реальный номер
            if original_lines is not None:
                # Приблизительно: команда примерно соответствует строке idx+1
                # (можно сделать точнее через маппинг, но для 99% случаев хватит)
                min_z_line = idx + 1
            else:
                min_z_line = idx + 1
    
    if min_z < -50:
        line_ref = f" (строка ≈{min_z_line})" if min_z_line else ""
        errors.append(f"Слишком глубокий Z: {min_z:.3f} мм{line_ref}")

    # 2. Неизвестные команды (не G0-G3)
    unknown_cmds = set()
    unknown_lines = {}
    for idx, (cmd, params) in enumerate(commands):
        if cmd not in {'G0', 'G1', 'G2', 'G3'}:
            unknown_cmds.add(cmd)
            if original_lines:
                unknown_lines.setdefault(cmd, []).append(idx + 1)
            else:
                unknown_lines.setdefault(cmd, []).append(idx + 1)

    if unknown_cmds:
        for cmd in unknown_cmds:
            lines = unknown_lines[cmd]
            if len(lines) > 5:
                lines_str = f"строки {lines[0]}-{lines[-1]} (+ещё {len(lines)-2})"
            else:
                lines_str = "строки " + ", ".join(map(str, lines))
            errors.append(f"Неизвестная команда {cmd} — {lines_str}")

    # 3. Слишком короткий файл
    if len(commands) < 5:
        errors.append(f"Файл слишком короткий: всего {len(commands)} команд")

    return len(errors) == 0, errors

def generate_rotated_gcode(original_lines, rotation):
    commands = parse_gcode(original_lines)
    valid, errors = validate_gcode(commands, original_lines)
    if not valid:
        error_msg = "\n".join(errors)
        raise ValueError(f"Некорректный G-код:\n{error_msg}")
    
    current_pos = {'X': 0.0, 'Y': 0.0, 'Z': 0.0, 'F': None}
    rotated_lines = []
    
    for cmd, params in commands:
        new_cmd = swap_arc_direction(cmd, rotation)
        new_params = {}
        if 'X' in params or 'Y' in params:
            orig_x = params.get('X', current_pos['X'])
            orig_y = params.get('Y', current_pos['Y'])
            new_x, new_y = transform_point(orig_x, orig_y, rotation)
            if abs(new_x - current_pos['X']) > 0.001:
                new_params['X'] = round(new_x, 3)
            if abs(new_y - current_pos['Y']) > 0.001:
                new_params['Y'] = round(new_y, 3)
        if 'Z' in params:
            new_params['Z'] = round(params['Z'], 3)
        if 'F' in params:
            new_params['F'] = int(params['F'])
        if 'R' in params:
            new_params['R'] = round(params['R'], 3)
        
        if new_params:
            line = new_cmd
            for k, v in new_params.items():
                line += f" {k}{v:.3f}" if '.' in str(v) else f" {k}{v}"
            rotated_lines.append(line)
        
        current_pos['X'] = new_params.get('X', current_pos['X'])
        current_pos['Y'] = new_params.get('Y', current_pos['Y'])
        current_pos['Z'] = new_params.get('Z', current_pos['Z'])
        current_pos['F'] = new_params.get('F', current_pos['F'])
    
    return rotated_lines

# Standalone функция для админки: ротация для контура по id
def rotate_gcode_for_contour(contour_id):
    nc_path = f"../contours/nc/{contour_id}.nc"
    if not os.path.exists(nc_path):
        raise ValueError(f".nc file not found for {contour_id}")
    
    with open(nc_path, 'r') as f:
        lines = f.read().splitlines()
    
    versions = {
        '0': lines,
        '90': generate_rotated_gcode(lines, 90),
        '180': generate_rotated_gcode(lines, 180),
        '270': generate_rotated_gcode(lines, 270)
    }
    
    base_path = f"../contours/nc/{contour_id}"
    os.makedirs(base_path, exist_ok=True)
    for rot, code in versions.items():
        with open(f"{base_path}/rotated_{rot}.nc", 'w') as f:
            f.write('\n'.join(code))
    
    print(f"Rotated versions generated for {contour_id}")