"""Ship both games from the same verified single-document build."""
import hashlib
import json
import pathlib
import re
import struct
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
dist, public = root / 'dist', root / 'public'
downloads = public / 'downloads'
downloads.mkdir(exist_ok=True)
(dist / 'downloads').mkdir(exist_ok=True)
html = (dist / 'index.html').read_bytes()
assert b'/models/mika.glb' not in html and b'<script type="module"' in html
version = re.search(r"BUILD = '([^']+)'", (root / 'src/release.ts').read_text()).group(1)
bundle = json.loads((root / 'src/assets/mika-model.json').read_text())
glb = (public / 'models/mika.glb').read_bytes()
assert hashlib.sha256(glb).hexdigest() == bundle['sha256']
model = json.loads(glb[20:20 + struct.unpack_from('<I', glb, 12)[0]])
assert model['extras']['modelRevision'] == 'MIKA-R12'
assert b'Charcoal fitted shorts' in glb and bundle['gzipBase64'].encode() in html
assert 'Скачать обе игры'.encode() in html and 'Вернуться в THEATRE'.encode() in html
release_name = f'MIKA-DUO-{version}.html'
kinema = html.replace(b'<html lang="ru">', b'<html lang="ru" data-start="kinema">', 1)
assert kinema != html
for target in (downloads, dist / 'downloads'):
    (target / release_name).write_bytes(html)
    (target / 'theatre.html').write_bytes(html)
    (target / 'kinema-studio.html').write_bytes(kinema)
archive = downloads / 'theatre-project.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=7) as z:
    for name in ('README.md', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts'):
        z.write(root / name, 'THEATRE/' + name)
    for folder in ('src', 'scripts', 'public/licenses', 'public/models'):
        for f in sorted((root / folder).rglob('*')):
            if f.is_file() and '__pycache__' not in f.parts:
                z.write(f, 'THEATRE/' + f.relative_to(root).as_posix())
    z.write(public / 'favicon.svg', 'THEATRE/public/favicon.svg')
    z.writestr('THEATRE/' + release_name, html)
    for f in (root / 'artifacts').glob('theatre-*.json'):
        z.write(f, 'THEATRE/artifacts/' + f.name)
    for f in (root / 'artifacts').glob('rig-*.json'):
        z.write(f, 'THEATRE/artifacts/' + f.name)
(dist / 'downloads' / archive.name).write_bytes(archive.read_bytes())
print('One-file release:', release_name, round(len(html) / 1048576, 2), 'MiB')
print('Release SHA-256:', hashlib.sha256(html).hexdigest())
print('Source project:', round(archive.stat().st_size / 1048576, 2), 'MiB')