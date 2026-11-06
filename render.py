import json, math, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

random.seed(7); np.random.seed(7)
lay = json.load(open('layout.json'))
PXMM = 12
PW, PH = 210, 297
page = Image.new('L', (PW*PXMM, PH*PXMM), 242)
dr = ImageDraw.Draw(page)
ox, oy = PW/2 - lay['W']/2, PH/2 - lay['H']/2

def P(x, y): return ((ox + x) * PXMM, (oy + y) * PXMM)

# corner squares
for m in lay['markers']:
    x, y = P(m['x'], m['y']); s = m['s'] * PXMM / 2
    dr.rectangle([x - s, y - s, x + s, y + s], fill=8)

font = ImageFont.load_default()
def circle(x, y, r, outline=None, fill=None, width=1):
    X, Y = P(x, y); R = r * PXMM
    dr.ellipse([X - R, Y - R, X + R, Y + R], outline=outline, fill=fill, width=width)

truth = []
ans_letters = 'ABCDE'[:lay['k']]
for q in lay['qs']:
    for b in q['b']:
        circle(b['x'], b['y'], lay['R'], outline=40, width=4)
        X, Y = P(b['x'], b['y'])
        dr.text((X - 5, Y - 6), b['c'], fill=150, font=font)
    X, Y = P(q['numX'], q['y']); dr.text((X - 14, Y - 6), str(q['n']), fill=30, font=font)
    roll = random.random()
    if roll < 0.08:
        truth.append('')                                  # blank
    elif roll < 0.14:
        two = random.sample(range(lay['k']), 2)           # double mark
        for j in two:
            b = q['b'][j]; circle(b['x'], b['y'], lay['R'] * 0.85, fill=70)
        truth.append('*')
    else:
        j = random.randrange(lay['k']); b = q['b'][j]
        tone = random.choice([25, 60, 95, 120])           # pen, dark pencil, pencil, light pencil
        jitter = (random.uniform(-0.3, 0.3), random.uniform(-0.3, 0.3))
        circle(b['x'] + jitter[0], b['y'] + jitter[1], lay['R'] * random.uniform(0.7, 0.92), fill=tone)
        truth.append(ans_letters[j])

# student id
sid = ''.join(random.choice('0123456789') for _ in range(lay['idLen']))
for i, col in enumerate(lay['idCols']):
    for b in col['b']:
        circle(b['x'], b['y'], lay['RID'], outline=40, width=3)
    b = col['b'][int(sid[i])]; circle(b['x'], b['y'], lay['RID'] * 0.85, fill=45)

# clutter: header text lines
for yy in (10, 21, 31, 41):
    a = P(12, yy); dr.text(a, 'Name Section Date  ______________________', fill=20, font=font)
dr.line([P(10, 72), P(170, 72)], fill=80, width=3)

def coeffs(src, dst):
    A = []; B = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u*x, -u*y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v*x, -v*y]); B.append(v)
    return np.linalg.solve(np.array(A, float), np.array(B, float))

def photo(name, quad, rot=0, angle_dark=0.3):
    OW, OH = 1500, 2000
    # desk background
    bg = np.random.normal(95, 10, (OH, OW)).clip(0, 255)
    img = Image.fromarray(bg.astype('uint8'), 'L')
    src = [(0, 0), (page.width, 0), (page.width, page.height), (0, page.height)]
    c = coeffs(quad, src)  # output -> page coords
    warped = page.transform((OW, OH), Image.PERSPECTIVE, tuple(c), resample=Image.BICUBIC, fillcolor=0)
    mask = Image.new('L', page.size, 255).transform((OW, OH), Image.PERSPECTIVE, tuple(c), resample=Image.BILINEAR, fillcolor=0)
    img.paste(warped, (0, 0), mask)
    a = np.asarray(img, float)
    yy, xx = np.mgrid[0:OH, 0:OW]
    light = 1.0 - angle_dark * (xx / OW) * 0.8 - 0.15 * (yy / OH)   # uneven lighting
    a = a * light + np.random.normal(0, 5, a.shape)
    img = Image.fromarray(a.clip(0, 255).astype('uint8'), 'L').filter(ImageFilter.GaussianBlur(1.6))
    if rot: img = img.rotate(rot, expand=True)
    img.save(name)

photo('case1.png', [(170, 230), (1320, 180), (1390, 1830), (120, 1900)])
photo('case2.png', [(260, 160), (1280, 300), (1330, 1700), (210, 1850)], rot=180, angle_dark=0.45)
photo('case3.png', [(110, 300), (1400, 210), (1430, 1790), (160, 1950)], rot=90)
json.dump({'answers': truth, 'sid': sid}, open('truth.json', 'w'))
print('rendered', len(truth), 'answers, sid', sid)
