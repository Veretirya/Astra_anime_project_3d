"""Keep an exact, text-safe copy of Mika in the application module graph."""
import base64
import gzip
import hashlib
import json
from pathlib import Path
import struct


def embed_model(model):
    data = Path(model).read_bytes()
    if struct.unpack_from('<4sII', data) != (b'glTF', 2, len(data)):
        raise ValueError('Expected a complete glTF 2.0 binary')
    size = struct.unpack_from('<I', data, 12)[0]
    scene = json.loads(data[20:20 + size])
    if any('uri' in asset for asset in scene['buffers'] + scene.get('images', [])):
        raise ValueError('All buffers and textures must be embedded in the GLB')
    target = Path(__file__).resolve().parents[1] / 'src/assets/mika-model.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    bundle = {'byteLength': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
              'gzipBase64': base64.b64encode(gzip.compress(data, mtime=0)).decode('ascii')}
    target.write_text(json.dumps(bundle, separators=(',', ':')) + '\n', encoding='ascii')
    print('Embedded', len(data), 'bytes of verified GLB in', target.name)


if __name__ == '__main__':
    embed_model(Path(__file__).resolve().parents[1] / 'public/models/mika.glb')