"""Rebuild the inline registry from the reviewed SVG sources; no extra packages."""
from pathlib import Path
import json
import xml.etree.ElementTree as ET

repo = Path(__file__).resolve().parents[1]
icons = {}
allowed = {'svg', 'g', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'ellipse'}
for path in sorted((repo / 'static/icons/actions').glob('*.svg')):
    source = path.read_text(encoding='utf-8')
    root = ET.fromstring(source)
    if root.attrib.get('viewBox') != '0 0 24 24' or root.attrib.get('stroke') != 'currentColor':
        raise ValueError(f'Invalid viewBox or theme color: {path.name}')
    for element in root.iter():
        if element.tag.split('}')[-1] not in allowed:
            raise ValueError(f'Unsupported SVG element: {path.name}')
        for key, value in element.attrib.items():
            if key.lower().startswith('on') or key in ('href', 'style', 'id') or 'url(' in value:
                raise ValueError(f'Unsupported SVG attribute: {path.name}')
    icons[path.stem] = source.replace('<svg ', '<svg class="action-icon" aria-hidden="true" focusable="false" ', 1)
target = repo / 'static/action_icons_registry.js'
target.write_text("'use strict';\nconst ionActionIcons=Object.freeze(" + json.dumps(icons, ensure_ascii=False, separators=(',', ':')) + ");\n", encoding='utf-8')
print(f'{len(icons)} icons built.')
