"""Generador de iconos PNG para PWA usando solo stdlib (zlib + struct).

Se ejecuta una sola vez para producir los archivos en NUBE/icons/.
No se necesita en runtime: la app no depende de Python.
"""
import zlib
import struct
import os
import math

def make_chunk(ctype, data):
    length = struct.pack('>I', len(data))
    crc = struct.pack('>I', zlib.crc32(ctype + data) & 0xffffffff)
    return length + ctype + data + crc

def write_png(path, width, height, pixel_fn):
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = make_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter None
        for x in range(width):
            r, g, b, a = pixel_fn(x, y)
            raw.append(r); raw.append(g); raw.append(b); raw.append(a)
    idat = make_chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    iend = make_chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(sig + ihdr + idat + iend)

def lerp(a, b, t):
    return int(a + (b - a) * t)

def in_circle(x, y, cx, cy, r):
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r

def circle_alpha(x, y, cx, cy, r):
    dx, dy = x - cx, y - cy
    d = math.sqrt(dx * dx + dy * dy)
    if d <= r - 0.5:
        return 1.0
    if d >= r + 0.5:
        return 0.0
    return r + 0.5 - d

def make_cloud_icon(size, maskable=False):
    s = size
    top = (30, 58, 138)
    bottom = (99, 102, 241)
    radius = 0 if maskable else int(s * 0.22)

    cx, cy = s / 2, s * 0.52
    cloud_scale = 0.26 if maskable else 0.32
    R = s * cloud_scale
    circles = [
        (cx - R * 0.85, cy + R * 0.10, R * 0.70),
        (cx + R * 0.85, cy + R * 0.10, R * 0.70),
        (cx - R * 0.25, cy - R * 0.50, R * 0.80),
        (cx + R * 0.45, cy - R * 0.30, R * 0.95),
        (cx,            cy + R * 0.35, R * 0.90),
    ]

    def pixel(x, y):
        if radius > 0:
            corners = [
                (radius, radius),
                (s - radius - 1, radius),
                (radius, s - radius - 1),
                (s - radius - 1, s - radius - 1),
            ]
            if (x < radius or x > s - radius - 1) and (y < radius or y > s - radius - 1):
                for ccx, ccy in corners:
                    if abs(x - ccx) <= radius and abs(y - ccy) <= radius:
                        if not in_circle(x, y, ccx, ccy, radius):
                            return (0, 0, 0, 0)
                        break

        t = y / s
        bg = (lerp(top[0], bottom[0], t),
              lerp(top[1], bottom[1], t),
              lerp(top[2], bottom[2], t))

        cloud_a = 0.0
        for ccx, ccy, rr in circles:
            a = circle_alpha(x, y, ccx, ccy, rr)
            if a > cloud_a:
                cloud_a = a
            if cloud_a >= 1.0:
                break

        if cloud_a > 0:
            r = lerp(bg[0], 255, cloud_a)
            g = lerp(bg[1], 255, cloud_a)
            b = lerp(bg[2], 255, cloud_a)
            return (r, g, b, 255)

        return (bg[0], bg[1], bg[2], 255)

    return pixel

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.normpath(os.path.join(here, '..', 'icons'))
    os.makedirs(out, exist_ok=True)
    targets = [
        ('icon-192.png', 192, False),
        ('icon-512.png', 512, False),
        ('maskable-512.png', 512, True),
        ('apple-touch-icon.png', 180, False),
        ('favicon-32.png', 32, False),
    ]
    for name, size, mask in targets:
        print(f'Generando {name} ({size}x{size})...')
        write_png(os.path.join(out, name), size, size, make_cloud_icon(size, mask))
    print('Listo. Archivos en', out)

if __name__ == '__main__':
    main()
