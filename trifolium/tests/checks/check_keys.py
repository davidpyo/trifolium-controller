"""Every schema key must name something its store actually reads.

The menu tree declares keys like "device:pusherEscChannel"; DeviceStore::fromJson reads
doc["pusherEscChannel"]. Nothing ties the two together at compile time, so a renamed store key
leaves a schema node whose writes land nowhere - which is exactly what happened when boardIndex
became boardId. This checks the pairing by grepping both sides.
"""
import glob
import re
import sys

keys = set()
for path in glob.glob('src/*.cpp') + glob.glob('src/*.h'):
    for m in re.finditer(r'"(device|profile):([^"]+)"', open(path, encoding='utf-8').read()):
        key = m.group(2)
        # The per-motor items build their keys by token pasting ("device:motorConfig[" #N "].kp"),
        # so the source holds fragments rather than whole keys. The fragment's own segments are
        # covered by the complete keys other items declare.
        if key.endswith('['):
            continue
        keys.add((m.group(1), key))

stores = {
    'device': open('src/deviceStore.cpp', encoding='utf-8').read(),
    'profile': open('src/profileStore.cpp', encoding='utf-8').read(),
}

missing = []
for store, key in sorted(keys):
    # Strip array subscripts and take every path segment: motorConfig[0].stage -> motorConfig, stage
    segments = [s for s in re.split(r'\[[^\]]*\]|\.', key) if s]
    source = stores[store]
    for segment in segments:
        if ('"%s"' % segment) not in source:
            missing.append('%s:%s -> no "%s" in %sStore' % (store, key, segment, store))

print('%d schema keys checked against both stores' % len(keys))
for m in missing:
    print('FAIL: ' + m)
print('\n%s' % ('all keys resolve' if not missing else '%d unresolved' % len(missing)))
sys.exit(1 if missing else 0)
