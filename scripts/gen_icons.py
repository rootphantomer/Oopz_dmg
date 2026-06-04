"""
生成 Oopz App 图标资源：
  - assets/icon.png          512x512  主图标
  - assets/icon.icns         macOS 应用图标
  - assets/trayTemplate.png  16x16   托盘图标（黑色模板）
  - assets/trayTemplate@2x.png  32x32 托盘图标 Retina
"""

import os
from PIL import Image, ImageDraw, ImageFont

ASSETS = "/Users/ph4nt0mer/Documents/github/oopz/assets"
os.makedirs(ASSETS, exist_ok=True)


def make_app_icon(size: int) -> Image.Image:
    """生成圆角正方形 App 图标，带渐变背景 + 'O' 字母"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 圆角背景
    radius = int(size * 0.22)
    # 渐变色：从 #1a1a2e 到 #16213e，用矩形层叠模拟
    for i in range(size):
        t = i / size
        r = int(26 + (22 - 26) * t)
        g = int(26 + (33 - 26) * t)
        b = int(46 + (62 - 46) * t)
        draw.rectangle([0, i, size, i + 1], fill=(r, g, b, 255))

    # 重新裁剪成圆角
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.putalpha(mask)

    # 绘制文字 "O"（如字体加载失败则手绘）
    draw = ImageDraw.Draw(img)
    font_size = int(size * 0.52)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/SFNSDisplay.ttf", font_size)
    except Exception:
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
        except Exception:
            font = ImageFont.load_default()

    text = "O"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) / 2 - bbox[0]
    ty = (size - th) / 2 - bbox[1]

    # 描边（增加立体感）
    for dx, dy in [(-2, -2), (2, -2), (-2, 2), (2, 2)]:
        draw.text((tx + dx, ty + dy), text, font=font, fill=(0, 0, 0, 120))
    # 主字母
    draw.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))

    return img


def make_tray_icon(size: int) -> Image.Image:
    """生成纯黑托盘模板图标，Electron/macOS 会自动反色适配深色模式"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = max(1, size // 8)
    r = (size - margin * 2) // 2

    # 画一个空心圆（环形）
    lw = max(1, size // 8)
    draw.ellipse(
        [margin, margin, size - margin - 1, size - margin - 1],
        outline=(0, 0, 0, 255),
        width=lw,
    )

    # 中间小点
    dot = lw
    cx = size // 2
    cy = size // 2
    draw.ellipse([cx - dot, cy - dot, cx + dot, cy + dot], fill=(0, 0, 0, 255))

    return img


# ── 主图标 512x512 PNG ────────────────────────────────────────────────
icon_512 = make_app_icon(512)
icon_512.save(os.path.join(ASSETS, "icon.png"))
print("✓ icon.png (512x512)")

# ── macOS .icns ───────────────────────────────────────────────────────
# electron-builder 可以直接从 icon.png 生成 icns，但我们也生成一个
sizes_for_icns = [16, 32, 64, 128, 256, 512, 1024]
iconset_dir = os.path.join(ASSETS, "icon.iconset")
os.makedirs(iconset_dir, exist_ok=True)

for s in sizes_for_icns:
    resized = make_app_icon(s)
    resized.save(os.path.join(iconset_dir, f"icon_{s}x{s}.png"))
    if s <= 512:
        resized2 = make_app_icon(s * 2)
        resized2.save(os.path.join(iconset_dir, f"icon_{s}x{s}@2x.png"))

print("✓ iconset 生成完毕，将用 iconutil 转换 .icns")

# ── 托盘图标 ──────────────────────────────────────────────────────────
tray_16 = make_tray_icon(16)
tray_16.save(os.path.join(ASSETS, "trayTemplate.png"))

tray_32 = make_tray_icon(32)
tray_32.save(os.path.join(ASSETS, "trayTemplate@2x.png"))

print("✓ trayTemplate.png (16x16)")
print("✓ trayTemplate@2x.png (32x32)")
print("All icons generated!")
