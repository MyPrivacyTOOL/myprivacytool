"""Split the locked Alice curtain-pull drawing into Alice / curtain / code layers (MPC-7797).

    python3 tools/alice-library/split_p6_layers.py assets/alice/reference/alice_ref_still03-text-free_v0.png OUT_DIR

Free tools only (numpy + Pillow). The curtain and code regions are hand-placed polygons read off a
coordinate grid of the 820x959 reference, so this script is specific to that one image. All three
output layers are full-canvas RGBA PNGs of the same size, so they stack with no offsets.
"""
import sys, numpy as np
from PIL import Image, ImageDraw, ImageFilter
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB"); W, H = im.size
a = np.asarray(im).astype(int)
lum = 0.299*a[...,0] + 0.587*a[...,1] + 0.114*a[...,2]

def poly(pts):
    m = Image.new("L", (W, H), 0); ImageDraw.Draw(m).polygon(pts, fill=255); return np.asarray(m) > 0

# hand-placed from the gridded views (coordinates in the 820x959 crop)
P_up = [(556,410),(566,330),(596,236),(622,130),(622,30),(820,30),(820,176),(800,218),(780,244),
        (740,290),(700,334),(650,364),(600,394)]
P_low = [(556,420),(548,560),(551,700),(560,862),(600,864),(648,812),(700,812),(738,778),(742,742),
         (700,680),(652,600),(602,500),(598,430),(590,408)]
P_code = [(820,170),(800,214),(780,240),(740,286),(700,330),(650,360),(600,392),(592,410),(598,430),(602,500),
          (652,600),(700,680),(742,742),(738,778),(700,812),(648,812),(600,864),(580,880),(820,892)]
m_curtain = poly(P_up) | poly(P_low)
m_codebox = poly(P_code)
dark_or_green = (lum < 110) | ((a[...,1] > a[...,0] + 20) & (a[...,1] > a[...,2] + 20))
m_code = m_codebox & ~m_curtain & dark_or_green
# grow code a little into box edges where antialiasing is light, but not into curtain
m_code = np.asarray(Image.fromarray((m_code*255).astype("uint8")).filter(ImageFilter.MaxFilter(3)))>0
m_code &= m_codebox & ~m_curtain

# Alice: everything else, silhouette via outside flood fill (curtain+code painted out)
rest = im.copy(); arr = np.asarray(rest).copy(); arr[m_curtain|m_code] = 255; rest = Image.fromarray(arr)
rl = np.asarray(rest.convert("L")).astype(int)
barrier = Image.fromarray(((rl < 200)*255).astype("uint8")).filter(ImageFilter.MaxFilter(5))
cv = Image.new("L", (W+2, H+2), 0); cv.paste(barrier, (1,1)); ImageDraw.floodfill(cv, (0,0), 128)
outside = np.asarray(cv)[1:-1,1:-1] == 128
m_alice = ~outside & ~m_curtain & ~m_code
m_alice[:, 601:] = False   # drop stray fragments right of the hand

def save(mask, name, extra=None):
    al = np.where(mask, 255, 0).astype("uint8")
    Image.fromarray(np.dstack([a.astype("uint8"), al]), "RGBA").save(f"{out}/{name}", optimize=True)
save(m_alice, "alice.png")
# curtain: opaque only where it has fabric/ink; keep the polygon opaque white fill
save(m_curtain, "curtain.png")

# code layer: visible code + column-wise extension behind the curtain
ys, xs = np.where(m_code); x0, x1, y0, y1 = xs.min(), xs.max()+1, 150, 900
code = np.zeros((H, W, 4), dtype="uint8")
for x in range(x0, x1):
    col = np.where(m_code[:, x])[0]
    if len(col) == 0: continue
    vals = a[col, x].astype("uint8")
    for y in range(y0, y1):
        code[y, x] = (*(a[y, x] if m_code[y, x] else vals[(y - y0) % len(vals)]), 255)
# keep the extension only behind the curtain or under the visible code, so no code peeks out elsewhere
keep = (m_codebox | m_curtain)
keep[:, :588] = False
code[~keep, 3] = 0
Image.fromarray(code, "RGBA").save(f"{out}/code.png", optimize=True)

# composite check
page = Image.new("RGBA", (W, H), (255,255,255,255))
page.alpha_composite(Image.fromarray(code, "RGBA"))
for n in ("curtain.png", "alice.png"):
    page.alpha_composite(Image.open(f"{out}/{n}"))
comp = np.asarray(page.convert("RGB")).astype(int)
d = np.abs(comp - a).max(axis=2)
print("alice px", int(m_alice.sum()), "curtain px", int(m_curtain.sum()), "code px", int(m_code.sum()))
print("mean diff", round(float(d.mean()),3), " px>40:", int((d>40).sum()), "of", W*H)
page.convert("RGB").save(f"{out}/composite.png")
for n in ("alice.png","curtain.png"):
    g = Image.new("RGBA", (W,H), (200,120,200,255)); g.alpha_composite(Image.open(f"{out}/{n}")); g.convert("RGB").save(f"{out}/view-{n}")
g = Image.new("RGBA", (W,H), (200,120,200,255)); g.alpha_composite(Image.fromarray(code,"RGBA")); g.convert("RGB").save(f"{out}/view-code.png")
