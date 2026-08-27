#!/usr/bin/env python3
"""生成 Onprs Mail 的 Windows 多尺寸应用图标。"""

from pathlib import Path
from PIL import Image, ImageDraw

OUTPUT = Path(__file__).resolve().parents[1] / "build"
OUTPUT.mkdir(parents=True, exist_ok=True)

size = 1024
image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

draw.rounded_rectangle((48, 48, 976, 976), radius=176, fill="#147A6F")
draw.rounded_rectangle((174, 254, 850, 752), radius=70, outline="#F7FFFD", width=52)
draw.line((202, 302, 512, 548, 822, 302), fill="#F7FFFD", width=52, joint="curve")
draw.ellipse((742, 142, 882, 282), fill="#F1B84B")

png = image.resize((512, 512), Image.Resampling.LANCZOS)
png.save(OUTPUT / "icon.png", optimize=True)
image.save(
    OUTPUT / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
)
