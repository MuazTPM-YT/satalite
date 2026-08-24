// build the 3D mesh for a solved cross-section.
//
// The solver is 2D because the elements are prismatic: it solves ONE section and that
// section is the answer at every point along the length. So the 3D view is that one
// section swept, and the sweep must be uniform by construction, not by care.
//
// The mechanism is the UV map. Every vertex - caps and side walls alike - takes
// (u, v) = (x / w, y / h). z is never read. There is therefore no expression anywhere
// that could put a gradient along the length, and buildSectionGeometry is the single
// place that could ever change.
import * as THREE from "three";

export interface SectionGeometry {
    geometry: THREE.ExtrudeGeometry;
    capGeometry: THREE.ShapeGeometry;
    // how far the geometry was moved to sit on the origin, so a hit point can be
    // converted back into section coordinates.
    offset: THREE.Vector3;
}

// outline in metres, extruded along z. w_m and h_m are the TEXTURE extent - the solver's
// raster, not the outline bounding box, so a cell and a texel line up.
export function buildSectionGeometry(
    outline_m: [number, number][],
    length_m: number,
    w_m: number,
    h_m: number,
): SectionGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(outline_m[0][0], outline_m[0][1]);
    for (let i = 1; i < outline_m.length; i++) shape.lineTo(outline_m[i][0], outline_m[i][1]);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, { depth: length_m, bevelEnabled: false });
    const capGeometry = new THREE.ShapeGeometry(shape);

    // THE invariant: uv is a function of (x, y) only. Adding z here would put a colour
    // gradient along the length, which the model does not have.
    for (const g of [geometry, capGeometry]) {
        const pos = g.attributes.position;
        const uv = g.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
            uv.setXY(i, pos.getX(i) / w_m, pos.getY(i) / h_m);
        }
        uv.needsUpdate = true;
    }

    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const cx = (bb.max.x + bb.min.x) / 2;
    const cy = (bb.max.y + bb.min.y) / 2;
    const cz = (bb.max.z + bb.min.z) / 2;
    geometry.translate(-cx, -cy, -cz);
    capGeometry.translate(-cx, -cy, 0);

    return { geometry, capGeometry, offset: new THREE.Vector3(cx, cy, cz) };
}
