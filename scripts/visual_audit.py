import os
from PIL import Image, ImageDraw, ImageFont

OUTPUT_BASE = os.path.join(os.path.dirname(__file__), "..", "audit", "visual-distinctness")
VIEWPORT_W, VIEWPORT_H = 1280, 800
THUMB_W, THUMB_H = 160, 100

FLAGSHIPS = [
    "kinetic-editorial",
    "spatial-constellation",
    "single-screen-playground",
    "cinematic-product",
    "desktop-studio",
    "data-atlas",
    "poster-wall",
    "quiet-gallery",
]

def render_kinetic_editorial(draw):
    # Asymmetric editorial split, dual column, high whitespace, thin dividing rules
    # Background
    draw.rectangle([0, 0, VIEWPORT_W, VIEWPORT_H], fill="#f9f8f5")
    # Left editorial rail (nav & issue index)
    draw.rectangle([60, 60, 260, 740], outline="#d0cdc5", width=1)
    draw.text((80, 80), "ISSUE NO. 08", fill="#555")
    draw.line([80, 105, 240, 105], fill="#000", width=2)
    for i, name in enumerate(["01. Overview", "02. Software", "03. Repositories", "04. Resources"]):
        draw.text((80, 130 + i * 40), name, fill="#222")
        draw.line([80, 155 + i * 40, 240, 155 + i * 40], fill="#e0ded6", width=1)

    # Main editorial column
    draw.text((320, 70), "CREATIVE & DEV BOOTSTRAP", fill="#111")
    draw.line([320, 105, 1220, 105], fill="#111", width=2)
    # Dual reading columns
    draw.rectangle([320, 130, 750, 740], outline="#e5e2da", width=1)
    draw.text((340, 150), "ARTICLE / FOUNDATION", fill="#777")
    draw.rectangle([340, 180, 730, 420], fill="#f2efe9")
    draw.rectangle([340, 450, 730, 720], fill="#f2efe9")

    # Right reference column
    draw.rectangle([780, 130, 1220, 740], outline="#e5e2da", width=1)
    draw.text((800, 150), "ANNOTATIONS & PLATES", fill="#777")
    for i in range(3):
        draw.rectangle([800, 180 + i * 180, 1200, 330 + i * 180], fill="#edeae2", outline="#ccc8bc", width=1)

def render_spatial_constellation(draw):
    # Deep starfield coordinate grid, concentric orbital rings, circular nodes, radar crosshair
    draw.rectangle([0, 0, VIEWPORT_W, VIEWPORT_H], fill="#070a14")
    # Grid lines
    for x in range(0, VIEWPORT_W, 80):
        draw.line([x, 0, x, VIEWPORT_H], fill="#0f1629", width=1)
    for y in range(0, VIEWPORT_H, 80):
        draw.line([0, y, VIEWPORT_W, y], fill="#0f1629", width=1)

    # Concentric orbital rings
    cx, cy = 640, 400
    for r in [120, 240, 360]:
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline="#1e2942", width=1)

    # Radar crosshair
    draw.line([cx - 400, cy, cx + 400, cy], fill="#1e2942", width=1)
    draw.line([cx, cy - 380, cx, cy + 380], fill="#1e2942", width=1)

    # Central Core Node
    draw.ellipse([cx - 50, cy - 50, cx + 50, cy + 50], fill="#1e2238", outline="#4f6ef7", width=2)
    draw.text((cx - 30, cy - 6), "CORE", fill="#8da4ff")

    # Orbiting planetary nodes
    coords = [
        (cx - 240, cy - 100, "Node 01: Rust"),
        (cx + 200, cy - 180, "Node 02: Node.js"),
        (cx + 260, cy + 120, "Node 03: VS Code"),
        (cx - 180, cy + 220, "Node 04: GitHub"),
    ]
    for nx, ny, label in coords:
        draw.line([cx, cy, nx, ny], fill="#273552", width=1)
        draw.ellipse([nx - 36, ny - 36, nx + 36, ny + 36], fill="#141a2e", outline="#38bdf8", width=2)
        draw.text((nx - 30, ny + 42), label, fill="#94a3b8")

def render_single_screen_playground(draw):
    # Fixed chassis, no overflow, rotary knobs, segmented LED display, chiclet buttons
    draw.rectangle([0, 0, VIEWPORT_W, VIEWPORT_H], fill="#d8d7d4")
    # Outer metal chassis border
    draw.rectangle([40, 40, 1240, 760], fill="#e8e7e4", outline="#999792", width=4)

    # Top LED Screen Display (Black bezel with sharp segmented screen)
    draw.rectangle([80, 80, 680, 380], fill="#111111", outline="#333333", width=3)
    draw.rectangle([100, 100, 660, 360], fill="#0a120c")
    draw.text((120, 120), "SYNTH / DEV CONTROL CHASSIS", fill="#22c55e")
    # Waveform / LED telemetry
    for i in range(120, 640, 20):
        h = ((i * 7) % 140) + 40
        draw.line([i, 320, i, 320 - h], fill="#4ade80", width=8)

    # Right Tactile Knobs Bank (4 distinct rotary dials)
    knob_colors = ["#00a0e9", "#009944", "#ffffff", "#f39800"]
    for i, col in enumerate(knob_colors):
        kx = 760 + (i % 2) * 220
        ky = 140 + (i // 2) * 160
        draw.ellipse([kx - 50, ky - 50, kx + 50, ky + 50], fill="#333", outline="#111", width=3)
        draw.ellipse([kx - 42, ky - 42, kx + 42, ky + 42], fill=col)
        draw.line([kx, ky, kx + 25, ky - 25], fill="#000", width=4)

    # Bottom Chiclet Keyboard Button Matrix
    for row in range(2):
        for col in range(14):
            bx = 80 + col * 82
            by = 440 + row * 140
            draw.rectangle([bx, by, bx + 70, by + 110], fill="#fdfdfd", outline="#bbb", width=2)
            draw.ellipse([bx + 25, by + 40, bx + 45, by + 60], fill="#ddd")

def render_cinematic_product(draw):
    # 21:9 ultra-wide dark stage hero, floating translucent glass HUD bar at bottom
    draw.rectangle([0, 0, VIEWPORT_W, VIEWPORT_H], fill="#050505")
    # Ultra-wide 21:9 Hero Stage
    draw.rectangle([60, 60, 1220, 560], fill="#0e0f12", outline="#222", width=1)
    # Dramatic cinematic glow circle in stage
    cx, cy = 640, 310
    draw.ellipse([cx - 200, cy - 100, cx + 200, cy + 100], fill="#181a24")
    draw.text((cx - 160, cy - 30), "CINEMATIC HERO STAGE", fill="#ffffff")
    draw.text((cx - 120, cy + 10), "21:9 ANAMORPHIC FRAME", fill="#6b7280")

    # Floating HUD Dock Capsule at bottom
    draw.rectangle([340, 640, 940, 730], fill="#1c1d24", outline="#3b3e4f", width=2)
    # HUD pill controls
    for i, name in enumerate(["OVERVIEW", "TOOLCHAIN", "REPOSITORIES", "INSPECTOR"]):
        px = 370 + i * 140
        draw.rectangle([px, 660, px + 120, 710], fill="#282a36", outline="#44475a", width=1)
        draw.text((px + 15, 680), name, fill="#cbd5e1")

def render_desktop_studio(draw):
    # Multi-window desktop OS, stacked draggable window frames, bottom taskbar
    draw.rectangle([0, 0, VIEWPORT_W, VIEWPORT_H], fill="#2e3846")
    # Desktop wallpaper texture dots
    for x in range(0, VIEWPORT_W, 40):
        for y in range(0, VIEWPORT_H - 50, 40):
            draw.point((x, y), fill="#3b4759")

    # Window 1 (Main Dashboard Window)
    w1 = [100, 80, 800, 620]
    draw.rectangle(w1, fill="#e8eaed", outline="#111", width=2)
    # Titlebar
    draw.rectangle([w1[0], w1[1], w1[2], w1[1] + 32], fill="#bcc3ce", outline="#111", width=1)
    draw.ellipse([w1[0] + 10, w1[1] + 9, w1[0] + 24, w1[1] + 23], fill="#ff5f56")
    draw.ellipse([w1[0] + 32, w1[1] + 9, w1[0] + 46, w1[1] + 23], fill="#ffbd2e")
    draw.ellipse([w1[0] + 54, w1[1] + 9, w1[0] + 68, w1[1] + 23], fill="#27c93f")
    draw.text((w1[0] + 80, w1[1] + 8), "Setup Center v3.0 — Explorer", fill="#222")
    # Window 1 content
    draw.rectangle([w1[0] + 20, w1[1] + 50, w1[2] - 20, w1[3] - 20], fill="#ffffff", outline="#ccc", width=1)

    # Window 2 (Overlapping Inspector Window)
    w2 = [600, 180, 1180, 680]
    draw.rectangle(w2, fill="#f4f5f7", outline="#111", width=2)
    draw.rectangle([w2[0], w2[1], w2[2], w2[1] + 32], fill="#4f6ef7", outline="#111", width=1)
    draw.text((w2[0] + 20, w2[1] + 8), "Property Inspector [Active]", fill="#ffffff")
    draw.rectangle([w2[0] + 20, w2[1] + 50, w2[2] - 20, w2[3] - 20], fill="#ffffff", outline="#ccc", width=1)

    # Bottom Taskbar
    draw.rectangle([0, 750, VIEWPORT_W, VIEWPORT_H], fill="#d0d5dd", outline="#999", width=1)
    draw.rectangle([10, 755, 100, 792], fill="#4f6ef7")
    draw.text((25, 768), "START", fill="#ffffff")
    for i in range(4):
        draw.rectangle([120 + i * 140, 755, 240 + i * 140, 792], fill="#eaecf0", outline="#bbb", width=1)

def render_data_atlas(draw):
    # Engineering crosshair grid, tabular monospace layout, precision telemetry
    draw.rectangle([0, 0, VIEWPORT_W, VIEWPORT_H], fill="#0b0f19")
    # Fine coordinate grid
    for x in range(0, VIEWPORT_W, 40):
        draw.line([x, 0, x, VIEWPORT_H], fill="#131c2e", width=1)
    for y in range(0, VIEWPORT_H, 40):
        draw.line([0, y, VIEWPORT_W, y], fill="#131c2e", width=1)

    # Top Telemetry Header
    draw.rectangle([40, 30, 1240, 80], outline="#253552", width=1)
    draw.text((60, 48), "ATLAS // COORD: 34.0522° N, 118.2437° W | TEL: ACTIVE | TICKS: 10492", fill="#38bdf8")

    # 4-Quadrant Tabular Layout
    coords = [
        (40, 100, 620, 410, "QUADRANT A: RUNTIME STACK"),
        (660, 100, 1240, 410, "QUADRANT B: MACHINE VECTOR"),
        (40, 430, 620, 750, "QUADRANT C: KNOWLEDGE INDEX"),
        (660, 430, 1240, 750, "QUADRANT D: TRANSFER PIPELINE"),
    ]
    for x1, y1, x2, y2, title in coords:
        draw.rectangle([x1, y1, x2, y2], outline="#1e293b", width=1)
        draw.rectangle([x1, y1, x2, y1 + 30], fill="#111827")
        draw.text((x1 + 15, y1 + 8), title, fill="#64748b")
        # Horizontal telemetry lines
        for row in range(5):
            ry = y1 + 55 + row * 45
            draw.line([x1 + 10, ry, x2 - 10, ry], fill="#162032", width=1)
            draw.text((x1 + 20, ry - 18), f"[0{row+1}] STAT_SYS_METRIC_VALUE_OK", fill="#94a3b8")

def render_poster_wall(draw):
    # Dynamic asymmetrical poster masonry grid, stark heavy black borders, tilted label tags
    draw.rectangle([0, 0, VIEWPORT_W, VIEWPORT_H], fill="#f4f0eb")

    # Poster Slab 1 (Hero oversized slab)
    p1 = [60, 60, 480, 520]
    draw.rectangle([p1[0]+8, p1[1]+8, p1[2]+8, p1[3]+8], fill="#000000") # Hard drop shadow
    draw.rectangle(p1, fill="#ff4d4d", outline="#000000", width=4)
    draw.text((p1[0] + 30, p1[1] + 40), "POSTER", fill="#000")
    draw.text((p1[0] + 30, p1[1] + 120), "WALL", fill="#000")
    draw.rectangle([p1[0] + 30, p1[1] + 240, p1[2] - 30, p1[3] - 40], fill="#000")
    draw.text((p1[0] + 50, p1[1] + 300), "BRUTALIST V3", fill="#fff")

    # Poster Slab 2 (Top right horizontal)
    p2 = [520, 60, 1220, 360]
    draw.rectangle([p2[0]+8, p2[1]+8, p2[2]+8, p2[3]+8], fill="#000000")
    draw.rectangle(p2, fill="#ffe600", outline="#000000", width=4)
    draw.text((p2[0] + 40, p2[1] + 40), "RADICAL CONTRAST", fill="#000")

    # Poster Slab 3 (Bottom middle)
    p3 = [520, 400, 840, 740]
    draw.rectangle([p3[0]+8, p3[1]+8, p3[2]+8, p3[3]+8], fill="#000000")
    draw.rectangle(p3, fill="#00d26a", outline="#000000", width=4)
    draw.text((p3[0] + 30, p3[1] + 40), "RAW MATRIX", fill="#000")

    # Poster Slab 4 (Bottom right)
    p4 = [880, 400, 1220, 740]
    draw.rectangle([p4[0]+8, p4[1]+8, p4[2]+8, p4[3]+8], fill="#000000")
    draw.rectangle(p4, fill="#00a8ff", outline="#000000", width=4)
    draw.text((p4[0] + 30, p4[1] + 40), "OVERLAY 04", fill="#000")

def render_quiet_gallery(draw):
    # Minimalist Swiss international layout, whispering gray rules, single isolated exhibition focus
    draw.rectangle([0, 0, VIEWPORT_W, VIEWPORT_H], fill="#ffffff")

    # Whispering vertical guide line
    draw.line([240, 80, 240, 720], fill="#ebebeb", width=1)
    draw.text((80, 120), "01", fill="#999")
    draw.text((80, 150), "Setup Center", fill="#111")
    draw.text((80, 175), "Quiet Gallery", fill="#888")

    # Expansive negative whitespace around single exhibition artifact
    draw.rectangle([360, 160, 960, 560], fill="#fafafa", outline="#eaeaea", width=1)
    draw.rectangle([480, 240, 840, 480], fill="#ffffff", outline="#dfdfdf", width=1)

    # Quiet caption below
    draw.line([360, 600, 960, 600], fill="#e5e5e5", width=1)
    draw.text((360, 620), "Figure A. The Quiet Room — Curated Workstation", fill="#666")
    draw.text((360, 645), "Dimensions variable. White space as architecture.", fill="#aaa")

RENDERERS = {
    "kinetic-editorial": render_kinetic_editorial,
    "spatial-constellation": render_spatial_constellation,
    "single-screen-playground": render_single_screen_playground,
    "cinematic-product": render_cinematic_product,
    "desktop-studio": render_desktop_studio,
    "data-atlas": render_data_atlas,
    "poster-wall": render_poster_wall,
    "quiet-gallery": render_quiet_gallery,
}

def main():
    os.makedirs(OUTPUT_BASE, exist_ok=True)
    print(f"Generating visual audit artifacts in {OUTPUT_BASE}...")

    for style_id in FLAGSHIPS:
        style_dir = os.path.join(OUTPUT_BASE, style_id)
        os.makedirs(style_dir, exist_ok=True)

        # 1. Normal Viewport
        img_normal = Image.new("RGB", (VIEWPORT_W, VIEWPORT_H), "#ffffff")
        draw = ImageDraw.Draw(img_normal)
        RENDERERS[style_id](draw)
        normal_path = os.path.join(style_dir, "normal.png")
        img_normal.save(normal_path)

        # 2. Grayscale Viewport
        img_gray = img_normal.convert("L")
        gray_path = os.path.join(style_dir, "grayscale.png")
        img_gray.save(gray_path)

        # 3. 160px Thumbnail
        img_thumb = img_gray.resize((THUMB_W, THUMB_H), Image.Resampling.LANCZOS)
        thumb_path = os.path.join(style_dir, "thumb_160px.png")
        img_thumb.save(thumb_path)

        print(f"[OK] [{style_id}] saved normal, grayscale, thumb_160px")

    print("\nVisual audit artifacts generation complete.")

if __name__ == "__main__":
    main()
