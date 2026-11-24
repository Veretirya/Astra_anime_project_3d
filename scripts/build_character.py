"""Build Mika from the CC0 VRoid HairSample_Female base and original garments.

Usage: python3 scripts/build_character.py /path/to/HairSample_Female.vrm
Requires numpy and Pillow. All generated geometry is embedded in a portable GLB.
"""
import copy
import io
import json
import math
import pathlib
import struct
import sys
import urllib.request
import zipfile
from embed_model import embed_model

import numpy as np
from PIL import Image


if len(sys.argv) > 1:
    source = pathlib.Path(sys.argv[1]).read_bytes()
else:
    with urllib.request.urlopen('https://opengameart.org/sites/default/files/hairsample_female.zip') as response:
        source = zipfile.ZipFile(io.BytesIO(response.read())).read('HairSample_Female.vrm')
size = struct.unpack_from('<I', source, 12)[0]
original = json.loads(source[20:20 + size])
binary = source[28 + size:]
out = {
    'asset': {'version': '2.0', 'generator': 'Kinema Lab character workshop',
              'copyright': 'VRoid Project (CC0) base; custom Mika garments and styling'},
    'scene': 0, 'scenes': copy.deepcopy(original['scenes']),
    'nodes': copy.deepcopy(original['nodes']), 'skins': [], 'meshes': [],
    'materials': [], 'textures': [], 'images': [], 'accessors': [], 'bufferViews': [],
    'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
    'extras': {'character': 'Mika', 'baseLicense': 'CC0-1.0', 'modelRevision': 'MIKA-R12',
               'humanoid': {b['bone']: original['nodes'][b['node']]['name']
                            for b in original['extensions']['VRM']['humanoid']['humanBones']}}
}
blob = bytearray()
types = {5126: '<f4', 5123: '<u2', 5125: '<u4', 5121: 'u1'}
widths = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_attr(i):
    a = original['accessors'][i]
    bv = original['bufferViews'][a['bufferView']]
    offset = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(binary, dtype=types[a['componentType']],
                         count=a['count'] * widths[a['type']], offset=offset).reshape(a['count'], -1).copy()


def view(data):
    while len(blob) % 4:
        blob.append(0)
    out['bufferViews'].append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)})
    blob.extend(data)
    return len(out['bufferViews']) - 1


def accessor(data, typ='VEC3', numeric=5126, bounds=False):
    values = np.array(data, dtype=types[numeric]).reshape(-1, widths[typ])
    a = {'bufferView': view(values.tobytes()), 'componentType': numeric, 'type': typ, 'count': len(values)}
    if bounds:
        a.update(min=values.min(axis=0).tolist(), max=values.max(axis=0).tolist())
    out['accessors'].append(a)
    return len(out['accessors']) - 1


def texture(image, name, opaque=False):
    buf = io.BytesIO()
    if opaque:
        image.convert('RGB').save(buf, 'JPEG', quality=94)
    else:
        image.save(buf, 'PNG', optimize=True)
    out['images'].append({'name': name, 'mimeType': 'image/jpeg' if opaque else 'image/png',
                          'bufferView': view(buf.getvalue())})
    out['textures'].append({'source': len(out['images']) - 1, 'sampler': 0})
    return len(out['textures']) - 1


def source_image(index):
    bv = original['bufferViews'][original['images'][index]['bufferView']]
    start = bv.get('byteOffset', 0)
    return Image.open(io.BytesIO(binary[start:start + bv['byteLength']])).convert('RGBA')


def srgb(c):
    return [((v / 255 + .055) / 1.055) ** 2.4 if v > 10 else v / 3294.6 for v in c]


def material(name, color=(255, 255, 255), tex=None, alpha=False, double=True, rough=.85, metal=0):
    pbr = {'baseColorFactor': srgb(color) + [1], 'metallicFactor': metal, 'roughnessFactor': rough}
    if tex is not None:
        pbr['baseColorTexture'] = {'index': tex}
    m = {'name': name, 'pbrMetallicRoughness': pbr, 'doubleSided': double,
         'alphaMode': 'MASK' if alpha else 'OPAQUE', 'alphaCutoff': .32}
    out['materials'].append(m)
    return len(out['materials']) - 1


mat_map = {}
for idx in list(range(10)) + [12]:
    m = original['materials'][idx]
    ti = m['pbrMetallicRoughness']['baseColorTexture']['index']
    image = source_image(original['textures'][ti]['source'])
    image.thumbnail((1024, 1024) if idx in (7, 9) else (512, 768))
    pixels = np.asarray(image).astype(float).copy()
    if idx == 12:
        light = pixels[:, :, :3].mean(axis=2)
        tone = np.clip((light - 14) / 64, 0, 1)
        for c, (lo, hi) in enumerate([(193, 255), (123, 207), (137, 213)]):
            pixels[:, :, c] = lo + (hi - lo) * tone
    if idx == 5:
        light = pixels[:, :, :3].mean(axis=2) / 255
        warm = np.clip(light * 2.6, 0, 1)
        for c, (lo, hi) in enumerate([(45, 188), (27, 115), (44, 128)]):
            pixels[:, :, c] = lo + (hi - lo) * warm
    if idx == 4:
        pixels[:, :, :3] = [133, 82, 86]
    if idx in (7, 9):
        pixels[:, :, 3] = 255
    image = Image.fromarray(np.uint8(np.clip(pixels, 0, 255)), 'RGBA')
    tex = texture(image, m['name'], idx in (7, 9))
    mat_map[idx] = material(m['name'], tex=tex, alpha=idx not in [7, 9], double=True,
                            rough=.57 if idx == 12 else .88)

for skin in original['skins']:
    new = copy.deepcopy(skin)
    new['inverseBindMatrices'] = accessor(read_attr(skin['inverseBindMatrices']), 'MAT4')
    out['skins'].append(new)

lining = material('Charcoal fitted shorts', (64, 61, 66), rough=.96)

for mi, mesh in enumerate(original['meshes']):
    new_mesh = {'name': ['Mika_Face', 'Mika_Body', 'Mika_RoseHair'][mi], 'primitives': []}
    groups = {}
    for pi, p in enumerate(mesh['primitives']):
        mat = p['material']
        if mat not in mat_map or (mi == 2 and not 6 <= pi <= 21) or (mi == 0 and mat == 8):
            continue
        if mi == 1:
            # Keep the complete source topology, including hip and upper-thigh faces.
            # The fitted underlayer shares vertices and skin weights with the body.
            triangles = read_attr(p['indices']).ravel().reshape(-1, 3)
            center_y = read_attr(p['attributes']['POSITION'])[triangles, 1].mean(axis=1)
            covered = (center_y >= .727) & (center_y <= .984)
            for cloth, mask in [(False, ~covered), (True, covered)]:
                if mask.any():
                    groups.setdefault((mat, cloth), []).append((p, triangles[mask].ravel()))
        else:
            groups.setdefault((mat, False), []).append((p, read_attr(p['indices']).ravel()))
    for (mat, cloth), primitives in groups.items():
        p = primitives[0][0]
        indices = np.concatenate([ind for _, ind in primitives])
        unique, inverse = np.unique(indices, return_inverse=True)
        attributes = {}
        for name, old in p['attributes'].items():
            a = original['accessors'][old]
            data = read_attr(old)[unique]
            if mi == 2 and name == 'POSITION':
                # Extend the back layers into a tapered, softly waving wolf cut.
                x, y, z = (data[:, i].copy() for i in range(3))
                back = np.clip((z + .010) / .065, 0, 1)
                lower = np.clip((1.53 - y) / .15, 0, 1)
                data[:, 1] -= .19 * lower * back
                data[:, 0] += np.sign(x) * (.014 * np.sin(lower * 6) - .026 * lower) * back
                data[:, 2] += lower * back * .045
            attributes[name] = accessor(data, a['type'], a['componentType'], name == 'POSITION')
        pr = {'attributes': attributes, 'indices': accessor(inverse, 'SCALAR', 5123),
              'material': lining if cloth else mat_map[mat], 'mode': 4}
        if mi == 0 and 'targets' in p:
            pr['targets'] = []
            for morph in [13, 2, 26, 37]:
                target = p['targets'][morph]
                pr['targets'].append({'POSITION': accessor(read_attr(target['POSITION'])[unique], bounds=True)})
        new_mesh['primitives'].append(pr)
    if mi == 0:
        new_mesh['extras'] = {'targetNames': ['Blink', 'Smile', 'LipSmile', 'MouthOpen']}
        new_mesh['weights'] = [0, .12, .29, .085]
    out['meshes'].append(new_mesh)

bones = {original['nodes'][n]['name']: i for i, n in enumerate(original['skins'][1]['joints'])}
hips = bones['J_Bip_C_Hips']
spine = bones['J_Bip_C_Spine']
chest = bones['J_Bip_C_Chest']
upper = bones['J_Bip_C_UpperChest']
garments = {'name': 'Mika_Atelier', 'primitives': []}
tau = math.pi * 2


def make_surface(fn, nu, nv, mat, weights, reverse=False):
    points, uvs, joints, values, indices = [], [], [], [], []
    for v in range(nv + 1):
        for u in range(nu + 1):
            uv = (u / nu, v / nv)
            point = fn(*uv)
            points.append(point)
            uvs.append(uv)
            w = weights(*point) if callable(weights) else [(weights, 1)]
            joints.append([x[0] for x in w] + [0] * (4 - len(w)))
            values.append([x[1] for x in w] + [0] * (4 - len(w)))
    for v in range(nv):
        for u in range(nu):
            a = v * (nu + 1) + u
            b, c, d = a + 1, a + nu + 1, a + nu + 2
            indices.extend([a, c, b, b, c, d] if not reverse else [a, b, c, b, d, c])
    pos = np.array(points)
    faces = np.array(indices).reshape(-1, 3)
    normals = np.zeros_like(pos)
    fnormal = np.cross(pos[faces[:, 1]] - pos[faces[:, 0]], pos[faces[:, 2]] - pos[faces[:, 0]])
    for col in range(3):
        np.add.at(normals, faces[:, col], fnormal)
    normals /= np.maximum(np.linalg.norm(normals, axis=1)[:, None], 1e-12)
    garments['primitives'].append({'mode': 4, 'material': mat, 'indices': accessor(indices, 'SCALAR', 5123),
        'attributes': {'POSITION': accessor(pos, bounds=True), 'NORMAL': accessor(normals),
        'TEXCOORD_0': accessor(uvs, 'VEC2'), 'JOINTS_0': accessor(joints, 'VEC4', 5123),
        'WEIGHTS_0': accessor(values, 'VEC4')}})


def body_weights(x, y, z):
    stops = [.94, 1.01, 1.13, 1.28]
    ids = [hips, spine, chest, upper]
    for i in range(3):
        if y < stops[i + 1]:
            t = np.clip((y - stops[i]) / (stops[i + 1] - stops[i]), 0, 1)
            return [(ids[i], 1 - t), (ids[i + 1], t)]
    return [(upper, 1)]


# The wrap is fitted to horizontal cross-sections of the actual skin mesh.
body_pos = read_attr(original['meshes'][1]['primitives'][0]['attributes']['POSITION'])
body_faces = read_attr(original['meshes'][1]['primitives'][0]['indices']).ravel().reshape(-1, 3)
triangles = body_pos[body_faces]
profile_y = np.linspace(.91, 1.325, 84)
section_angles = np.linspace(0, tau, 145)
cross_sections = []
for height in profile_y:
    hits = []
    for ia, ib in [(0, 1), (1, 2), (2, 0)]:
        aa, bb = triangles[:, ia], triangles[:, ib]
        mask = ((aa[:, 1] - height) * (bb[:, 1] - height) < 0)
        a, b = aa[mask], bb[mask]
        if len(a):
            ps = a + (b - a) * ((height - a[:, 1]) / (b[:, 1] - a[:, 1]))[:, None]
            hits.extend(ps[np.abs(ps[:, 0]) < .148])
    points = np.array(hits)
    if not len(points):
        cross_sections.append(np.full(len(section_angles), .1))
        continue
    angles = np.arctan2(points[:, 0], -points[:, 2]) % tau
    radius = np.hypot(points[:, 0], points[:, 2])
    order = np.argsort(angles)
    cross_sections.append(np.interp(section_angles, angles[order], radius[order], period=tau))
cross_sections = np.array(cross_sections)


def fit_body(y, a, offset=0):
    i = np.clip((y - profile_y[0]) / (profile_y[-1] - profile_y[0]) * (len(profile_y) - 1), 0, len(profile_y) - 1.0001)
    low = int(i)
    row = cross_sections[low] * (1 - i + low) + cross_sections[low + 1] * (i - low)
    r = np.interp(a % tau, section_angles, row) + offset
    return r * math.sin(a), y, -r * math.cos(a)


cream = material('Ivory woven cotton', (246, 235, 226))
seam = material('Wrap seam', (221, 201, 192))
linen = material('Dusty lilac linen', (185, 158, 168))
skirt_mat = material('Charcoal pleated twill', (53, 51, 54))
sash = material('Umber waist sash', (100, 73, 68))
brown = material('Cocoa slouch knit', (109, 77, 76))
rib = material('Knitted rib cuffs', (88, 63, 63))
choker = material('Velvet choker', (60, 47, 46))
gold = material('Brushed gold', (211, 176, 107), rough=.33, metal=.45)
ty, tx = np.mgrid[0:512, 0:256]
grain = 243 + 5 * np.cos(tx * .88 + .9 * np.sin(ty * 1.7)) + 3 * np.sin(ty * 1.51)
grain += np.random.default_rng(18).normal(0, 1.4, grain.shape)
weave = texture(Image.fromarray(np.uint8(np.clip(grain, 0, 255))).convert('RGB'), 'Fine knit weave', True)
for mat_id in [brown, rib, cream, skirt_mat, sash]:
    out['materials'][mat_id]['pbrMetallicRoughness']['baseColorTexture'] = {'index': weave}

def wrap(u, v):
    a = tau * u
    y = 1.137 + v * .105 + .005 * math.sin(a + .6)
    return fit_body(y, a, .0045 + .0013 * math.sin(v * math.pi * 8))
make_surface(wrap, 112, 28, cream, body_weights)
for k in [.08, .35, .62, .88]:
    make_surface(lambda u, v, k=k: fit_body(1.137 + (k + v * .009) * .105 + .005 * math.sin(u * tau + .6), u * tau, .006),
                 96, 1, seam, body_weights)

def tailored_vest():
    # Cut an open-front vest from a fitted garment, preserving shoulder skinning.
    primitive = next(p for p in original['meshes'][1]['primitives'] if p['material'] == 10)
    attr = {key: read_attr(idx) for key, idx in primitive['attributes'].items()}
    original_texture = source_image(17).convert('L').resize((768, 768))
    tint = np.asarray(original_texture, dtype=float) / 255
    tinted = np.uint8(np.clip(np.array([211, 189, 199])[None, None, :] * (.52 + .48 * tint[:, :, None]), 0, 255))
    pbr = out['materials'][linen]['pbrMetallicRoughness']
    pbr['baseColorFactor'] = [1, 1, 1, 1]
    pbr['baseColorTexture'] = {'index': texture(Image.fromarray(tinted), 'Linen folds', True)}
    blend = np.zeros((len(attr['POSITION']), len(original['skins'][1]['joints'])))
    for k in range(4):
        np.add.at(blend, (np.arange(len(blend)), attr['JOINTS_0'][:, k]), attr['WEIGHTS_0'][:, k])
    verts = np.column_stack([attr['POSITION'], attr['NORMAL'], attr['TEXCOORD_0'], blend])
    polys = []
    def cut(poly, distance):
        result = []
        for i, b in enumerate(poly):
            a = poly[i - 1]
            da, db = distance(a), distance(b)
            if (da >= 0) != (db >= 0):
                result.append(a + (b - a) * (da / (da - db)))
            if db >= 0:
                result.append(b)
        return result
    for tri in read_attr(primitive['indices']).reshape(-1, 3):
        for sign in [-1, 1]:
            poly = [p.copy() for p in verts[tri]]
            for fn in [lambda p: p[1] - .939 - .011 * math.cos(p[0] * 15),
                       lambda p: 1.353 - p[1],
                       lambda p: sign * p[0],
                       lambda p: .092 + .051 * np.clip((1.325 - p[1]) / .11, 0, 1) - sign * p[0],
                       lambda p: sign * p[0] - (.043 + .013 * math.sin((p[1] - .94) * 8)) * np.clip((-p[2] + .005) / .046, 0, 1)]:
                poly = cut(poly, fn)
                if len(poly) < 3:
                    break
            for k in range(1, len(poly) - 1):
                polys.extend([poly[0], poly[k], poly[k + 1]])
    points, indices = np.unique(np.round(np.array(polys), 7), axis=0, return_inverse=True)
    normal = points[:, 3:6]
    normal /= np.maximum(1e-9, np.linalg.norm(normal, axis=1)[:, None])
    clearance = .002 + .0075 * np.exp(-((points[:, 1] - 1.20) / .065) ** 2)
    pos = points[:, :3] + normal * clearance[:, None]
    weights = points[:, 8:]
    joints = np.argsort(-weights, axis=1)[:, :4]
    values = np.take_along_axis(weights, joints, axis=1)
    values /= np.maximum(1e-9, values.sum(axis=1)[:, None])
    garments['primitives'].append({'mode': 4, 'material': linen, 'indices': accessor(indices, 'SCALAR', 5123),
        'attributes': {'POSITION': accessor(pos, bounds=True), 'NORMAL': accessor(normal),
                       'TEXCOORD_0': accessor(points[:, 6:8], 'VEC2'), 'JOINTS_0': accessor(joints, 'VEC4', 5123),
                       'WEIGHTS_0': accessor(values, 'VEC4')}})
tailored_vest()

def skirt(u, v):
    a = tau * u
    fold = np.interp((u * 14 + v * .06) % 1, [0, .12, .72, .94, 1], [-.82, 1, .57, -1, -.82])
    flare = (1 - v) ** .90
    ripple = (.002 + .019 * flare) * fold
    return ((.139 + .082 * flare + ripple) * math.sin(a),
            .654 + v * .302 + .012 * (1 - v) * math.sin(a * 5 + .4),
            -.005 - (.099 + .071 * flare + ripple) * math.cos(a))
def skirt_weights(x, y, z):
    w = .45 * np.clip((.95 - y) / .30, 0, 1) ** 1.45
    left = np.clip(.5 - x / .20, 0, 1)
    return [(hips, 1 - w), (bones['J_Bip_L_UpperLeg'], w * left), (bones['J_Bip_R_UpperLeg'], w * (1 - left))]
make_surface(skirt, 224, 32, skirt_mat, skirt_weights)
def waistband(u, v):
    a = tau * u
    r = .0023 * math.sin(v * 15 + math.sin(a * 2 + v))
    return ((.138 + (1 - v) * .010 + r) * math.sin(a), .933 + .055 * v + .004 * math.sin(a + .3),
            -.009 - (.103 + (1 - v) * .002 + r) * math.cos(a))
make_surface(waistband, 112, 18, sash, hips)
for s in [-1, 1]:
    leg = bones['J_Bip_' + ('L' if s == -1 else 'R') + '_LowerLeg']
    def legging(u, v, s=s):
        a = tau * u
        y = .09 + .424 * v
        cx = s * (.048 + .012 * v)
        cz = .014 - .013 * v
        profile = np.interp(v, [0, .12, .32, .60, .80, 1], [.037, .048, .043, .057, .06, .049])
        folds = 0
        for center, tilt, phase, amp in [(.13, .025, 1, .009), (.27, -.067, .2, .015), (.46, .079, 2.1, .013), (.65, -.058, .6, .014), (.83, .056, 1.2, .012)]:
            distance = v - center - tilt * math.sin(a + phase)
            folds += amp * math.exp(-(distance / .038) ** 2) - .004 * math.exp(-((distance + .037) / .027) ** 2)
        r = profile + folds + .0019 * math.sin(3 * a + v * 5) * math.sin(v * math.pi)
        return cx + r * math.sin(a), y + .005 * math.cos(a) * math.sin(v * math.pi), cz - r * 1.02 * math.cos(a)
    make_surface(legging, 72, 66, brown, leg)
    for yy, h, rr, xx, zz in [(.083, .048, .037, .048, .019), (.505, .031, .050, .06, .001)]:
        make_surface(lambda u, v, yy=yy, h=h, rr=rr, xx=xx, zz=zz, s=s:
            (s * xx + (rr + .0009 * math.cos(u * tau * 42)) * math.sin(tau * u), yy + h * v,
             zz - (rr + .0009 * math.cos(u * tau * 42)) * math.cos(tau * u)), 128, 5, rib, leg)

neck = bones['J_Bip_C_Neck']
make_surface(lambda u, v: (.047 * math.sin(u * tau), 1.369 + v * .015, .007 - .044 * math.cos(u * tau)),
             76, 3, choker, neck)

# Fine gold hairpins sit on the right fringe rather than floating on the face.
head = bones['J_Bip_C_Head']

# A continuous scalp, overlapping tapered back locks, and face-framing curls form
# a true volumetric hairstyle rather than two-dimensional alpha cards.
hair_pixels = np.zeros((640, 128, 3), dtype=np.uint8)
for py in range(640):
    t = py / 639
    u = np.linspace(0, 1, 128)
    ridge = np.sin(u * math.pi) ** .65
    fine = np.sin(u * 83 + .9 * np.sin(t * 9)) * 1.6 + np.sin(u * 254 + t * 3) * .85
    sheen = 20 * math.exp(-((t - .21 - .025 * math.sin(t * 2)) / .107) ** 2)
    for c, (base, lift) in enumerate([(198, 32), (128, 38), (146, 34)]):
        hair_pixels[py, :, c] = np.clip(base + lift * ridge + fine + sheen - t * 10, 0, 255)
rose = material('Rose layered silk hair', tex=texture(Image.fromarray(hair_pixels), 'Rose strand albedo', True), rough=.64)
rose_cap = material('Rose hair base', (211, 145, 157), rough=.75)
def scalp(u, v):
    a = u * tau
    phi = .004 + v * (1.79 - .61 * math.cos(a))
    return .101 * math.sin(phi) * math.sin(a), 1.523 + .126 * math.cos(phi), .009 - .113 * math.sin(phi) * math.cos(a)
make_surface(scalp, 112, 32, rose_cap, head, True)

for layer, count in [(0, 19), (1, 23), (2, 17)]:
    for i in range(count):
        angle = .88 + (tau - 1.76) * (i + .15 * layer) / (count - 1)
        variation = math.sin(i * 4.7 + layer * 2.2)
        def lock(u, t, angle=angle, i=i, variation=variation, layer=layer, count=count):
            side = 2 * u - 1
            upper_t = min(1, t / .39)
            lower_t = max(0, (t - .39) / .61)
            taper = max(.004, (1 - lower_t ** 2.5) ** .76)
            half_width = (tau - 1.76) / count * .77
            a = angle + side * half_width * taper + .13 * math.sin(t * 6 + i * .27) * t
            phi = .018 + upper_t * 1.48
            wave = .010 * math.sin(lower_t * 7.6 + i * .31) * math.sin(lower_t * math.pi)
            flick = (.023 + .016 * layer) * lower_t ** 4 * (1 + .4 * variation)
            ridge = .0034 * (1 - side * side) * taper
            radial = .105 + .004 * layer + wave + flick + ridge
            length = .28 + .06 * (-math.cos(angle)) + .033 * variation - .074 * layer
            x = radial * math.sin(phi) * math.sin(a) + .007 * math.sin(lower_t * 6 + i) * lower_t
            y = 1.523 + (.131 + .003 * layer) * math.cos(phi) - length * lower_t
            z = .009 - (radial + .01) * math.sin(phi) * math.cos(a) + .039 * lower_t ** 1.5
            return x, y, z
        make_surface(lock, 7, 31, rose, head, True)

for sign in [-1, 1]:
    for layer in range(3):
        def tendril(u, t, sign=sign, layer=layer):
            a = u * tau
            taper = max(.004, math.sin(math.pi * t) ** .67)
            w = (.024 - layer * .004) * taper
            y = 1.631 - t * (.381 - layer * .036 + sign * .013)
            cx = .055 + .047 * math.sin(t * 2.2) + .014 * math.sin(t * 8.4 + .6) + layer * .004
            z = -.047 - .034 * math.sin(t * math.pi) - .013 * math.sin(t * 7) - .021 * t + layer * .0025
            return sign * cx + w * math.cos(a), y + .007 * math.cos(a) * taper, z + w * .34 * math.sin(a)
        make_surface(tendril, 9, 36, rose, head, True)

for k in range(2):
    def pin(u, v, k=k):
        a = u * tau
        return (.058 + .021 * v + .0017 * math.cos(a), 1.548 + .018 * v + k * .009 + .0017 * math.sin(a),
                -.100 + .019 * v - .0008 * math.cos(a))
    make_surface(pin, 10, 8, gold, head)

def generated_attr(i):
    a = out['accessors'][i]
    v = out['bufferViews'][a['bufferView']]
    return np.frombuffer(blob[v['byteOffset']:v['byteOffset'] + v['byteLength']],
                         dtype=types[a['componentType']]).reshape(a['count'], widths[a['type']])


# Batch all locks and garment seams sharing a material into one GPU draw call.
surfaces = garments['primitives']
garments['primitives'] = []
for mat in sorted(set(p['material'] for p in surfaces)):
    collection = [p for p in surfaces if p['material'] == mat]
    if len(collection) == 1:
        garments['primitives'].extend(collection)
        continue
    buffers = {key: [] for key in collection[0]['attributes']}
    indices, delta = [], 0
    for primitive in collection:
        for name, idx in primitive['attributes'].items():
            buffers[name].append(generated_attr(idx))
        indices.append(generated_attr(primitive['indices']).astype(np.uint32) + delta)
        delta += len(buffers['POSITION'][-1])
    attrs = {}
    for name, arr in buffers.items():
        info = out['accessors'][collection[0]['attributes'][name]]
        attrs[name] = accessor(np.concatenate(arr), info['type'], info['componentType'], name == 'POSITION')
    garments['primitives'].append({'mode': 4, 'material': mat, 'attributes': attrs,
                                  'indices': accessor(np.concatenate(indices), 'SCALAR', 5123 if delta < 65536 else 5125)})
out['meshes'].append(garments)
out['nodes'].append({'name': 'Mika_Clothing', 'mesh': len(out['meshes']) - 1, 'skin': 1})
out['scenes'][0]['nodes'].append(len(out['nodes']) - 1)
refs = set(s['inverseBindMatrices'] for s in out['skins'])
for mesh in out['meshes']:
    for pr in mesh['primitives']:
        refs.update(pr['attributes'].values())
        refs.add(pr['indices'])
        for morph in pr.get('targets', []):
            refs.update(morph.values())
amap = {old: new for new, old in enumerate(sorted(refs))}
for sk in out['skins']:
    sk['inverseBindMatrices'] = amap[sk['inverseBindMatrices']]
for mesh in out['meshes']:
    for pr in mesh['primitives']:
        pr['indices'] = amap[pr['indices']]
        pr['attributes'] = {k: amap[v] for k, v in pr['attributes'].items()}
        for morph in pr.get('targets', []):
            for k in list(morph):
                morph[k] = amap[morph[k]]
out['accessors'] = [out['accessors'][i] for i in sorted(refs)]
src_blob, src_views = blob, out['bufferViews']
blob, out['bufferViews'] = bytearray(), []
vmap = {}
for item in out['accessors'] + out['images']:
    i = item['bufferView']
    if i not in vmap:
        s = src_views[i]
        vmap[i] = view(src_blob[s['byteOffset']:s['byteOffset'] + s['byteLength']])
    item['bufferView'] = vmap[i]
while len(blob) % 4:
    blob.append(0)
out['buffers'] = [{'byteLength': len(blob)}]
document = json.dumps(out, separators=(',', ':')).encode()
document += b' ' * ((-len(document)) % 4)
target = pathlib.Path('public/models/mika.glb')
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(struct.pack('<4sII', b'glTF', 2, 28 + len(document) + len(blob))
                   + struct.pack('<I4s', len(document), b'JSON') + document
                   + struct.pack('<I4s', len(blob), b'BIN\0') + blob)
print('Built', target, f'({target.stat().st_size / 1024 / 1024:.2f} MiB),', len(garments['primitives']), 'custom garment surfaces')
embed_model(target)