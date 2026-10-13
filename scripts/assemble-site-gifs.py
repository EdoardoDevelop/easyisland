# Assembla le GIF vere dai frame di scripts/capture-gif-frames.mjs.
# Uso: python scripts/assemble-site-gifs.py [outdir frames]
from PIL import Image
import glob
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRAMES = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "site", "media", "frames")
OUT = os.path.join(ROOT, "site", "media")
W = 640


def load_frames(name):
    files = sorted(glob.glob(os.path.join(FRAMES, name, "f*.png")))
    if not files:
        raise SystemExit(f"nessun frame per {name} in {FRAMES}/{name}")
    imgs = [Image.open(f).convert("RGBA") for f in files]
    w0, h0 = imgs[0].size
    r = W / w0
    return [im.resize((W, round(h0 * r)), Image.LANCZOS) for im in imgs]


def save(name, frames, duration=150):
    p = os.path.join(OUT, name)
    frames[0].save(
        p, save_all=True, append_images=frames[1:],
        duration=duration, loop=0, optimize=True, colors=128,
    )
    print(name, len(frames), "frame,", round(os.path.getsize(p) / 1024), "KB")


# Saluto animato + isola che si apre + permesso reale + fiamma che tremola
saluto = load_frames("saluto")
# Primi frame con sfondo chiaro (backdrop del saluto): tieni solo quelli scuri
dark = [f for f in saluto if sum(f.resize((1, 1)).convert("RGB").getpixel((0, 0))) < 200]
save("reale-saluto.gif", dark or saluto)
save("reale-isola.gif", load_frames("isola"))
save("reale-permesso.gif", load_frames("permesso"))
# Via i controlli della pagina di anteprima (dropdown in basso)
fiamma = [f.crop((0, 0, f.width, int(f.height * 0.68))) for f in load_frames("fiamma")]
save("reale-fiamma.gif", fiamma)
# Saluto: ritaglio centrale sul personaggio (era piccolo a tutta pagina)
def center_crop(frames):
    out = []
    for f in frames:
        w, h = f.size
        box = (int(w * 0.12), int(h * 0.18), int(w * 0.88), int(h * 0.94))
        c = f.crop(box)
        r = W / c.width
        out.append(c.resize((W, round(c.height * r)), Image.LANCZOS))
    return out
save("reale-saluto.gif", center_crop(dark or saluto))
