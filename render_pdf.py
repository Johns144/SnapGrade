import json, sys, random, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
random.seed(int(sys.argv[3]) if len(sys.argv) > 3 else 11); np.random.seed(5)
pdf, tag = sys.argv[1], sys.argv[2]
lay = json.load(open(tag + '-layout.json'))
paper = sys.argv[4] if len(sys.argv) > 4 else 'a4'
DPI = 200
subprocess.check_call(['pdftoppm', '-r', str(DPI), '-gray', '-png', '-singlefile', pdf, tag + '-page'])
page = Image.open(tag + '-page.png').convert('L')
PWmm, PHmm = (215.9, 279.4) if paper == 'letter' else (210, 297)
pxmm = page.width / PWmm
ox, oy = PWmm / 2 - lay['W'] / 2, PHmm / 2 - lay['H'] / 2
dr = ImageDraw.Draw(page)
def P(x, y): return ((ox + x) * pxmm, (oy + y) * pxmm)
def disk(x, y, r, tone):
    X, Y = P(x, y); R = r * pxmm
    dr.ellipse([X - R, Y - R, X + R, Y + R], fill=tone)
truth = []
for q in lay['qs']:
    roll = random.random()
    if roll < 0.08: truth.append('')
    elif roll < 0.14:
        for j in random.sample(range(lay['k']), 2): disk(q['b'][j]['x'], q['b'][j]['y'], lay['R'] * 0.85, 70)
        truth.append('*')
    else:
        j = random.randrange(lay['k']); b = q['b'][j]
        disk(b['x'] + random.uniform(-.3, .3), b['y'] + random.uniform(-.3, .3), lay['R'] * random.uniform(.7, .92), random.choice([25, 60, 95, 120]))
        truth.append('ABCDE'[j])
sid = ''.join(random.choice('0123456789') for _ in range(lay['idLen']))
for i, col in enumerate(lay['idCols']):
    b = col['b'][int(sid[i])]; disk(b['x'], b['y'], lay['RID'] * .85, 45)

def coeffs(src, dst):
    A = []; B = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u*x, -u*y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v*x, -v*y]); B.append(v)
    return np.linalg.solve(np.array(A, float), np.array(B, float))
def photo(name, quad, rot=0, dark=0.35):
    OW, OH = 1500, 2000
    img = Image.fromarray(np.random.normal(95, 10, (OH, OW)).clip(0, 255).astype('uint8'), 'L')
    src = [(0, 0), (page.width, 0), (page.width, page.height), (0, page.height)]
    c = coeffs(quad, src)
    wp = page.transform((OW, OH), Image.PERSPECTIVE, tuple(c), resample=Image.BICUBIC, fillcolor=0)
    mask = Image.new('L', page.size, 255).transform((OW, OH), Image.PERSPECTIVE, tuple(c), resample=Image.BILINEAR, fillcolor=0)
    img.paste(wp, (0, 0), mask)
    a = np.asarray(img, float); yy, xx = np.mgrid[0:OH, 0:OW]
    a = a * (1 - dark * (xx / OW) * .8 - .15 * (yy / OH)) + np.random.normal(0, 5, a.shape)
    img = Image.fromarray(a.clip(0, 255).astype('uint8'), 'L').filter(ImageFilter.GaussianBlur(1.6))
    if rot: img = img.rotate(rot, expand=True)
    img.save(name)
photo(tag + '-p1.png', [(170, 230), (1320, 180), (1390, 1830), (120, 1900)])
photo(tag + '-p2.png', [(260, 160), (1280, 300), (1330, 1700), (210, 1850)], rot=180, dark=.45)
photo(tag + '-p3.png', [(110, 300), (1400, 210), (1430, 1790), (160, 1950)], rot=90)
json.dump({'answers': truth, 'sid': sid}, open(tag + '-truth.json', 'w'))
print('ok', tag, len(truth), sid)
