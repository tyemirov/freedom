import json

def process_geojson(input_file, output_file):
    with open(input_file, 'r') as f:
        data = json.load(f)

    state_shapes = {}

    for feature in data['features']:
        name = feature['properties']['name']
        geometry = feature['geometry']
        
        # Flatten all coordinates to find bounding box
        coords = []
        if geometry['type'] == 'Polygon':
            for ring in geometry['coordinates']:
                coords.extend(ring)
        elif geometry['type'] == 'MultiPolygon':
            for polygon in geometry['coordinates']:
                for ring in polygon:
                    coords.extend(ring)
        
        if not coords:
            continue

        lons = [c[0] for c in coords]
        lats = [c[1] for c in coords]
        
        min_lon, max_lon = min(lons), max(lons)
        min_lat, max_lat = min(lats), max(lats)
        
        lon_range = max_lon - min_lon
        lat_range = max_lat - min_lat
        
        # Prevent division by zero
        if lon_range == 0: lon_range = 1
        if lat_range == 0: lat_range = 1
        
        # Determine scaling to fit in 100x100 while preserving aspect ratio
        # SVG Y increases downwards, so we'll flip latitudes
        scale = 100 / max(lon_range, lat_range)
        
        # Offset to center
        offset_x = (100 - lon_range * scale) / 2
        offset_y = (100 - lat_range * scale) / 2

        def transform(lon, lat):
            x = (lon - min_lon) * scale + offset_x
            # Flip Y: (max_lat - lat) * scale
            y = (max_lat - lat) * scale + offset_y
            return round(x, 2), round(y, 2)

        path_parts = []
        
        if geometry['type'] == 'Polygon':
            for ring in geometry['coordinates']:
                ring_path = []
                for i, c in enumerate(ring):
                    x, y = transform(c[0], c[1])
                    if i == 0:
                        ring_path.append(f"M{x} {y}")
                    else:
                        ring_path.append(f"L{x} {y}")
                ring_path.append("Z")
                path_parts.append(" ".join(ring_path))
        elif geometry['type'] == 'MultiPolygon':
            for polygon in geometry['coordinates']:
                for ring in polygon:
                    ring_path = []
                    for i, c in enumerate(ring):
                        x, y = transform(c[0], c[1])
                        if i == 0:
                            ring_path.append(f"M{x} {y}")
                        else:
                            ring_path.append(f"L{x} {y}")
                    ring_path.append("Z")
                    path_parts.append(" ".join(ring_path))
        
        state_shapes[name] = " ".join(path_parts)

    with open(output_file, 'w') as f:
        json.dump(state_shapes, f)

if __name__ == "__main__":
    process_geojson('states.json', 'state_shapes.json')
