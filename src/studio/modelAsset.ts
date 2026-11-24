import { gunzipSync } from 'three/addons/libs/fflate.module.js'
import model from '../assets/mika-model.json'

let cached: Promise<ArrayBuffer> | undefined

async function unpackModel(): Promise<ArrayBuffer> {
  const binary = atob(model.gzipBase64)
  const compressed = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) compressed[i] = binary.charCodeAt(i)

  let buffer: ArrayBuffer
  if (typeof DecompressionStream === 'function') {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
    buffer = await new Response(stream).arrayBuffer()
  } else {
    // Older mobile browsers use the same lossless payload, without a network fallback.
    buffer = gunzipSync(compressed).slice().buffer
  }
  const header = new DataView(buffer)
  if (buffer.byteLength !== model.byteLength || header.getUint32(0, true) !== 0x46546c67 ||
      header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== buffer.byteLength) {
    throw new Error('Встроенная модель повреждена. Откройте приложение заново.')
  }
  return buffer
}

// Rendering, retrying the scene, and GLB export share one decoded asset.
export function getMikaBuffer() {
  return cached ??= unpackModel().catch((error: unknown) => {
    cached = undefined
    throw error
  })
}