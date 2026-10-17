import sys, math, numpy as np
from PIL import Image, ImageFilter
src, out = sys.argv[1], sys.argv[2]
MODE = sys.argv[3] if len(sys.argv)>3 else "full"
FILL = sys.argv[4] if len(sys.argv)>4 else "#000"
im = Image.open(src).convert("RGBA")
bg = Image.new("RGBA", im.size, (255,255,255,255)); bg.alpha_composite(im)
L = bg.convert("L")
a = np.array(L)
ys, xs = np.where(a < 110)
x0,x1,y0,y1 = xs.min()-6, xs.max()+7, ys.min()-6, ys.max()+7
L = L.crop((x0,y0,x1,y1)).filter(ImageFilter.GaussianBlur(0.6))
f = (255 - np.array(L).astype(float)) / 255.0   # ink = high
H, W = f.shape
lvl = 0.5
# marching squares, segments keyed by edge ids
def interp(p, q, vp, vq):
    t = (lvl - vp) / (vq - vp) if vq != vp else 0.5
    return (p[0] + t*(q[0]-p[0]), p[1] + t*(q[1]-p[1]))
segs = []
v = f
inside = v >= lvl
cs = (inside[:-1,:-1].astype(int)*8 + inside[:-1,1:]*4 + inside[1:,1:]*2 + inside[1:,:-1]*1)
idx = np.argwhere((cs>0)&(cs<15))
table = {1:[(3,2)],2:[(2,1)],3:[(3,1)],4:[(0,1)],5:[(0,3),(2,1)],6:[(0,2)],7:[(0,3)],
         8:[(0,3)],9:[(0,2)],10:[(0,1),(2,3)],11:[(0,1)],12:[(3,1)],13:[(2,1)],14:[(3,2)]}
# edges: 0 top,1 right,2 bottom,3 left ; point on edge for cell (r,c)
def pt(r,c,e):
    tl,tr,br,bl = v[r,c],v[r,c+1],v[r+1,c+1],v[r+1,c]
    if e==0: return interp((c,r),(c+1,r),tl,tr)
    if e==1: return interp((c+1,r),(c+1,r+1),tr,br)
    if e==2: return interp((c,r+1),(c+1,r+1),bl,br)
    return interp((c,r),(c,r+1),tl,bl)
def key(r,c,e):  # canonical edge id shared between neighbours
    if e==0: return ('h',r,c)
    if e==2: return ('h',r+1,c)
    if e==3: return ('v',r,c)
    return ('v',r,c+1)
adj = {}
for r,c in idx:
    for a_,b_ in table[cs[r,c]]:
        ka,kb = key(r,c,a_),key(r,c,b_)
        adj.setdefault(ka,[]).append((kb,pt(r,c,a_)))
        adj.setdefault(kb,[]).append((ka,pt(r,c,b_)))
seen=set(); loops=[]
for k0 in list(adj):
    if k0 in seen: continue
    path=[]; k=k0; prev=None
    while True:
        seen.add(k)
        nb=adj[k]
        p=nb[0][1]; path.append(p)
        nxt=None
        for kk,_ in nb:
            if kk!=prev and kk not in seen: nxt=kk;break
        if nxt is None: break
        prev=k; k=nxt
    if len(path)>12: loops.append(path)
def dp(pts, eps):
    if len(pts)<3: return pts
    a=np.array(pts); 
    def rec(i,j):
        p,q=a[i],a[j]; d=q-p; n=np.hypot(*d)
        seg=a[i+1:j]
        if len(seg)==0: return [i]
        dist=np.abs(d[0]*(seg[:,1]-p[1])-d[1]*(seg[:,0]-p[0]))/n if n>0 else np.hypot(*(seg-p).T)
        m=dist.argmax()
        if dist[m]>eps: return rec(i,i+1+m)+rec(i+1+m,j)
        return [i]
    # closed: split at farthest pair
    j=int(np.argmax(np.hypot(*(a-a[0]).T)))
    keep=rec(0,j)+rec(j,len(a)-1)+[len(a)-1]
    return [pts[i] for i in sorted(set(keep))]
if MODE=="icon":
    loops=[lp for lp in loops if max(p[0] for p in lp)<450]
LABEL="MyPrivacyTOOL.IO" if MODE=="full" else "MyPrivacyTOOL icon"
d=[]
for lp in loops:
    s=dp(lp,0.4)
    if len(s)<3: continue
    n=len(s); P=np.array(s)
    def ang(i):
        a_=P[i-1]-P[i]; b_=P[(i+1)%n]-P[i]
        c=np.dot(a_,b_)/(np.hypot(*a_)*np.hypot(*b_)+1e-9); return math.degrees(math.acos(max(-1,min(1,c))))
    corner=[ang(i)<140 for i in range(n)]
    mid=lambda i,j:((P[i][0]+P[j][0])/2,(P[i][1]+P[j][1])/2)
    st=mid(n-1,0)
    seg=[f"M{st[0]:.1f} {st[1]:.1f}"]
    for i in range(n):
        j=(i+1)%n
        m=mid(i,j)
        if corner[i]: seg.append(f"L{P[i][0]:.1f} {P[i][1]:.1f}L{m[0]:.1f} {m[1]:.1f}")
        else: seg.append(f"Q{P[i][0]:.1f} {P[i][1]:.1f} {m[0]:.1f} {m[1]:.1f}")
    seg.append("Z"); d.append("".join(seg))
path_d="".join(d)
if MODE=="icon":
    xs_=[p[0] for lp in loops for p in lp]; ys_=[p[1] for lp in loops for p in lp]
    vx,vy,vw,vh=min(xs_)-2,min(ys_)-2,max(xs_)-min(xs_)+4,max(ys_)-min(ys_)+4
else:
    vx,vy,vw,vh=0,0,W,H
svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx:.1f} {vy:.1f} {vw:.1f} {vh:.1f}" role="img" aria-label="{LABEL}"><path fill="{FILL}" fill-rule="evenodd" d="{path_d}"/></svg>'
open(out,"w").write(svg)
print(W,H,len(loops),len(svg)//1024,"KB")
