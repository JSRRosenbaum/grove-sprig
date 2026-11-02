#!/usr/bin/env python3
import math
import os
import random
import shutil
import signal
import sys
import time

ESC = "\033["
RESET = ESC + "0m"
CYAN, BLUE, DIM = "38;5;51", "38;5;39", "38;5;45"
mode = sys.argv[1] if len(sys.argv) > 1 else "matrix"
rng = random.Random(mode)
frame = 0
running = True
drops = []
points = [(rng.random(), rng.random(), rng.random()) for _ in range(28)]


def paint(text, shade=CYAN, bold=False):
    return f"{ESC}{'1;' if bold else ''}{shade}m{text}{RESET}"


def stop(*_):
    global running
    running = False


def dims():
    size = shutil.get_terminal_size((44, 12))
    return max(12, size.columns), max(5, size.lines)


def title(width):
    labels = {
        "matrix": "DATA RAIN // LIVE", "radar": "PERIMETER RADAR",
        "spectrum": "SIGNAL SPECTRUM", "tunnel": "NEURAL UPLINK",
        "wave": "WAVEFORM ARRAY", "scan": "NODE DISCOVERY",
        "cpu": "CORE TELEMETRY", "packet": "PACKET TRACE",
        "pulse": "QUANTUM PULSE", "orbit": "ORBITAL RELAY",
    }
    return paint(f" {labels[mode]}  {frame:05x}"[:width].ljust(width), CYAN, True)


def matrix(w, h):
    global drops
    if len(drops) != w:
        drops = [rng.randrange(-h, h) for _ in range(w)]
    out = [[" " for _ in range(w)] for _ in range(h)]
    for x, drop in enumerate(drops):
        tail = 2 + (x * 7) % max(3, h // 2)
        for n in range(tail):
            y = drop - n
            if 0 <= y < h:
                out[y][x] = paint(rng.choice("01abcdef<>[]{}*/\\|+·"), CYAN if n == 0 else DIM, n == 0)
        drops[x] += 1 + (x % 13 == 0)
        if drops[x] - tail > h:
            drops[x] = rng.randrange(-h, 0)
    return ["".join(row) for row in out]


def render(w, h):
    if mode == "matrix":
        return matrix(w, h)
    rows = []
    cx, cy = w / 2, h / 2
    for y in range(h):
        row = []
        for x in range(w):
            dx, dy = x - cx, y - cy
            radius, angle = math.hypot(dx, dy), math.atan2(dy, dx)
            char, shade, bold = " ", DIM, False
            if mode == "radar":
                sweep = abs(math.atan2(math.sin(angle - frame * .17), math.cos(angle - frame * .17)))
                if abs(radius - min(w / 2 - 2, h / 2 - 1)) < .5: char = "·"
                if radius < min(w / 2 - 2, h / 2 - 1) and sweep < .08: char, bold = "╱" if -1.4 < frame * .17 % 6.28 < 1.4 else "╲", True
                if any(abs(x - px * w) < .6 and abs(y - py * h) < .6 and math.sin(frame * .2 + p * 20) > 0 for px, py, p in points): char, bold = "◆", True
            elif mode == "spectrum":
                bar = .18 + .78 * abs(math.sin(frame * .13 + x * .71))
                if (h - y) / h < bar: char, shade, bold = "█", CYAN if y > h / 2 else BLUE, True
            elif mode == "wave":
                wave = int((h - 1) / 2 + math.sin(x * .29 + frame * .23) * h * .27 + math.sin(x * .71 - frame * .12) * h * .12)
                if y == wave: char, shade, bold = "●", CYAN, True
                elif y == wave + 1: char = "·"
            elif mode == "tunnel":
                phase = angle * 4 + frame * .23 - radius * 36
                if math.sin(phase) > .62 and radius > .8: char, bold = ("✦" if radius > min(w, h) * .3 else "·"), True
            elif mode == "scan":
                cursor = (frame + y * 11) % (w + 20)
                if x == cursor: char, bold = "█", True
                elif x < cursor: char = "·"
            elif mode == "cpu":
                level = (math.sin(frame * .15 + y * 1.2) + 1) * .33 + os.getloadavg()[0] / max(1, os.cpu_count() or 1) * .55
                if x < level * w: char, shade, bold = "█", CYAN if y % 2 else BLUE, True
                elif x < w - 1: char = "░"
            elif mode == "packet":
                data = (frame * 5 + y * 97 + x * 31) & 0xff
                if x % 3 != 2: char, shade = f"{data:02X}"[x % 3], BLUE
                if (frame * 2 + y * 3) % max(1, w - 3) == x: bold = True
            elif mode == "pulse":
                ring = (frame * .55) % max(2, min(cx, cy))
                if abs(radius - ring) < .55: char, bold = "▓", True
                elif x == int(cx) or y == int(cy): char = "·"
            elif mode == "orbit":
                if abs(radius - min(w, h) * .23) < .5 or abs(radius - min(w, h) * .42) < .5: char = "·"
                for scale, shift in ((.23, 0), (.42, 2.1)):
                    if abs(x - (cx + math.cos(frame * (.13 if scale < .3 else -.09) + shift) * min(w, h) * scale)) < .7 and abs(y - (cy + math.sin(frame * (.13 if scale < .3 else -.09) + shift) * min(w, h) * scale)) < .7: char, bold = "◆", True
                if radius < .8: char, bold = "◉", True
            row.append(paint(char, shade, bold) if char != " " else " ")
        rows.append("".join(row))
    return rows


signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)
sys.stdout.write(ESC + "?25l" + ESC + "2J" + ESC + "H")
try:
    while running:
        width, height = dims()
        sys.stdout.write(ESC + "H" + "\n".join([title(width)] + render(width, height - 1)))
        sys.stdout.flush()
        frame += 1
        time.sleep(.085)
finally:
    sys.stdout.write(RESET + ESC + "?25h\n")
