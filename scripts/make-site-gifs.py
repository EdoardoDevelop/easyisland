# GIF dimostrative per site/ — montaggi dalle schermate vere (scripts/screenshots.mjs).
# Esegui: python scripts/make-site-gifs.py
from PIL import Image
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOT = os.path.join(ROOT, "screenshots")
OUT = os.path.join(ROOT, "site", "media")
W = 640


def load(name):
    im = Image.open(os.path.join(SHOT, name)).convert("RGBA")
    r = W / im.width
    return im.resize((W, round(im.height * r)), Image.LANCZOS)


def canvas(frames):
    w = max(f.width for f in frames)
    h = max(f.height for f in frames)
    out = []
    for f in frames:
        c = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        c.alpha_composite(f, ((w - f.width) // 2, (h - f.height) // 2))
        out.append(c)
    return out


def hold(frames, ms=1100, step=100):
    out = []
    for f in frames:
        out += [f] * (ms // step)
    return out


def fade(a, b, n=6):
    out = []
    for i in range(1, n + 1):
        out.append(Image.blend(a, b, i / n))
    return out


def tour(names, out_name, hold_ms=1100):
    frames = canvas([load(n) for n in names])
    seq = [frames[0]] * (hold_ms // 100)
    for prev, nxt in zip(frames, frames[1:]):
        seq += fade(prev, nxt) + [nxt] * (hold_ms // 100)
    seq[0].save(
        os.path.join(OUT, out_name), save_all=True, append_images=seq[1:],
        duration=100, loop=0, optimize=True, colors=128,
    )
    print(out_name, len(seq), "frame,", round(os.path.getsize(os.path.join(OUT, out_name)) / 1024), "KB")


def pan(out_name="personaggi.gif"):
    im = load("characters.png")  # 1384px -> ridotta a W? no: usa originale scalata a doppia larghezza
    src = Image.open(os.path.join(SHOT, "characters.png")).convert("RGBA")
    r = 760 / src.width
    src = src.resize((760, round(src.height * r)), Image.LANCZOS)
    win_w, steps = W, 24
    max_x = src.width - win_w
    frames = []
    xs = [round(max_x * i / (steps - 1)) for i in range(steps)]
    for x in xs + xs[::-1]:
        c = Image.new("RGBA", (win_w, src.height), (0, 0, 0, 0))
        c.alpha_composite(src.crop((x, 0, x + win_w, src.height)), (0, 0))
        frames.append(c)
    frames[0].save(
        os.path.join(OUT, out_name), save_all=True, append_images=frames[1:],
        duration=90, loop=0, optimize=True, colors=128,
    )
    print(out_name, len(frames), "frame,", round(os.path.getsize(os.path.join(OUT, out_name)) / 1024), "KB")


tour(["greeting.png", "overview.png", "approval.png", "agenti.png", "chat.png", "threecx.png"], "demo.gif")
tour(["overview.png", "approval.png"], "permessi.gif", hold_ms=1300)
tour(["chat.png", "drop.png", "chat-history.png"], "chat.gif")
pan()
