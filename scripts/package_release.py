"""Package the built studio as a network-independent HTML and a source project."""
import pathlib
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
public, dist = root / 'public', root / 'dist'
target = public / 'downloads'
target.mkdir(exist_ok=True)
(dist / 'downloads').mkdir(exist_ok=True)
html = (dist / 'index.html').read_text()
# The normal production entry already includes the actual model and every texture.
html = html.replace('<head>', '<head><script>globalThis.__KINEMA_PORTABLE__=true;</script>', 1)
portable = target / 'kinema-studio.html'
portable.write_text(html)
(dist / 'downloads' / portable.name).write_text(html)
archive = target / 'kinema-project.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=7) as z:
    for fn in ['README.md', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts']:
        z.write(root / fn, 'Kinema-Lab/' + fn)
    for directory in ['src', 'scripts', 'public']:
        for f in sorted((root / directory).rglob('*')):
            if f.is_file() and 'downloads' not in f.parts and '__pycache__' not in f.parts:
                z.write(f, 'Kinema-Lab/' + f.relative_to(root).as_posix())
    z.write(portable, 'Kinema-Lab/Kinema-Studio.html')
    if (root / 'artifacts/verification.json').exists():
        z.write(root / 'artifacts/verification.json', 'Kinema-Lab/artifacts/verification.json')
(dist / 'downloads' / archive.name).write_bytes(archive.read_bytes())
print('Portable HTML:', round(portable.stat().st_size / 1048576, 2), 'MiB')
print('Source project:', round(archive.stat().st_size / 1048576, 2), 'MiB')