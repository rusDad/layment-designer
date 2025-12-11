import re
import math
import os

def parse_gcode(lines):
    original_current_pos = {'X': 0.0, 'Y': 0.0, 'Z': 0.0, 'F': None}
    modal_cmd = 'G1'
    output = []
    
    for line in lines:
        line = line.strip()
        if not line or line.startswith(';') or line.startswith('('):
            continue
        # Улучшенный regex: захватывает букву и значение (поддержка экспоненты)
        parts = re.findall(r'([GXYZFIJR])([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)', line.upper())
        if parts and parts[0][0] == 'G':
            g_value = float(parts[0][1])
            cmd = 'G%d' % int(g_value)  # Нормализация G01 → G1
        else:
            cmd = modal_cmd
        if cmd in ['G0', 'G1', 'G2', 'G3']:
            modal_cmd = cmd
        params = {p[0]: float(p[1]) for p in parts if p[0] != 'G'}
        # Вычисляем полную оригинальную позицию
        full_orig_pos = original_current_pos.copy()
        full_orig_pos.update({k: v for k, v in params.items() if k in 'XYZF'})
        if params or cmd in ['G2', 'G3']:  # Включаем даже если params пустые, но arc
            output.append((cmd, params, full_orig_pos.copy()))
        # Обновляем original_current_pos
        original_current_pos = full_orig_pos
    return output

def transform_point(x, y, rotation):
    rad = math.radians(rotation)
    new_x = x * math.cos(rad) - y * math.sin(rad)
    new_y = x * math.sin(rad) + y * math.cos(rad)
    return new_x, new_y

def swap_arc_direction(cmd, rotation):
    if rotation % 360 == 180:
        if cmd == 'G2':
            return 'G2'
        elif cmd == 'G3':
            return 'G3'
        else:
            return cmd
    return cmd

def validate_gcode(commands, original_lines=None):
    errors = []
    min_z = float('inf')
    min_z_line = None
    for idx, (_, _, full_pos) in enumerate(commands):
        z = full_pos.get('Z')
        if z is not None and z < min_z:
            min_z = z
            min_z_line = idx + 1  # Приблизительно
    if min_z < -50:
        line_ref = f" (строка ≈{min_z_line})" if min_z_line else ""
        errors.append(f"Слишком глубокий Z: {min_z:.3f} мм{line_ref}")

    unknown_cmds = set(c[0] for c in commands) - {'G0', 'G1', 'G2', 'G3'}
    if unknown_cmds:
        errors.append(f"Неизвестные команды: {unknown_cmds}")

    if len(commands) < 5:
        errors.append(f"Файл слишком короткий: всего {len(commands)} команд")

    # Дополнительно: если есть I/J — предупредить (ваши файлы на R)
    has_ij = any('I' in p or 'J' in p for _, p, _ in commands)
    if has_ij:
        errors.append("Обнаружены I/J в arcs — они не трансформируются (используйте R-mode)")

    return len(errors) == 0, errors

def generate_rotated_gcode(original_lines, rotation):
    commands = parse_gcode(original_lines)
    valid, errors = validate_gcode(commands, original_lines)
    if not valid:
        error_msg = "\n".join(errors)
        raise ValueError(f"Некорректный G-код:\n{error_msg}")
    
    rotated_current_pos = {'X': 0.0, 'Y': 0.0, 'Z': 0.0, 'F': None}
    rotated_lines = []
    
    for cmd, params, full_orig in commands:
        new_cmd = swap_arc_direction(cmd, rotation)
        new_params = {}
        
        # Трансформируем полную оригинальную позицию
        new_x, new_y = transform_point(full_orig['X'], full_orig['Y'], rotation)
        
        # Добавляем только если изменилось (delta)
        if abs(new_x - rotated_current_pos['X']) > 0.001:
            new_params['X'] = round(new_x, 3) if new_x % 1 != 0 else int(new_x)
        if abs(new_y - rotated_current_pos['Y']) > 0.001:
            new_params['Y'] = round(new_y, 3) if new_y % 1 != 0 else int(new_y)
        
        if 'Z' in params:
            new_params['Z'] = round(params['Z'], 3) if params['Z'] % 1 != 0 else int(params['Z'])
        if 'F' in params:
            new_params['F'] = int(params['F'])
        if 'R' in params:
            new_params['R'] = round(params['R'], 3) if params['R'] % 1 != 0 else int(params['R'])
        
        if new_params or new_cmd in ['G2', 'G3']:  # Всегда выводим arc, даже если без params
            line = new_cmd
            for k, v in new_params.items():
                line += f" {k}{v:.3f}" if isinstance(v, float) else f" {k}{v}"
            rotated_lines.append(line)
        
        # Обновляем rotated_current_pos
        rotated_current_pos['X'] = new_x
        rotated_current_pos['Y'] = new_y
        rotated_current_pos['Z'] = full_orig.get('Z', rotated_current_pos['Z'])
        rotated_current_pos['F'] = full_orig.get('F', rotated_current_pos['F'])
    
    return rotated_lines

# Standalone функция для админки: ротация для контура по id
def rotate_gcode_for_contour(contour_id):
    nc_path = f"./contours/nc/{contour_id}.nc"
    if not os.path.exists(nc_path):
        raise ValueError(f".nc file not found for {contour_id}")
    
    with open(nc_path, 'r') as f:
        lines = f.read().splitlines()
    
    versions = {
        '0': lines,  # Оригинал без изменений
        '90': generate_rotated_gcode(lines, 90),
        '180': generate_rotated_gcode(lines, 180),
        '270': generate_rotated_gcode(lines, 270)
    }
    
    base_path = f"./contours/nc/{contour_id}"
    os.makedirs(base_path, exist_ok=True)
    for rot, code in versions.items():
        # Меняем местами имена для 90 и 270 (без изменения генерации)
        if rot == '90':
            save_rot = '270'
        elif rot == '270':
            save_rot = '90'
        else:
            save_rot = rot
        with open(f"{base_path}/rotated_{save_rot}.nc", 'w') as f:
            f.write('\n'.join(code))
    
    print(f"Rotated versions generated for {contour_id}")