import * as THREE from 'three';

// The meshes each projection shows the video on, built from VRPlayer's video material

// The video frame's width / height, 16:9 until it's known
export function videoAspect(video) {
    return video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
}

// The way a viewer looking towards yaw faces (yaw 0: -Z)
export function forwardFromYaw(yaw) {
    return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

// Texture regions for each eye: [offsetU, offsetV, scaleU, scaleV]
const FULL_FRAME = [0, 0, 1, 1];
const LEFT_HALF = [0, 0, 0.5, 1],
    RIGHT_HALF = [0.5, 0, 0.5, 1];
const TOP_HALF = [0, 0.5, 1, 0.5],
    BOTTOM_HALF = [0, 0, 1, 0.5];

// Pixels left out at each side of an eye's half, so filtering doesn't blend the other eye's edge
// in. More than half a pixel, because the flat screen's smaller mipmaps blur wider.
const EYE_EDGE_PX = 2;

// Maps a geometry's 0-1 uvs onto a texture region of the video. A half is trimmed at both of its
// edges on the split axis, so each eye's picture stays centred where it was: trimming only the
// shared edge would shift the two eyes' pictures against each other, which reads as depth
// (everything closer side by side, a vertical offset between the eyes top/bottom).
export function remapUV(geometry, [offsetU, offsetV, scaleU, scaleV], video) {
    const trimU = scaleU < 1 && video.videoWidth ? EYE_EDGE_PX / video.videoWidth : 0;
    const trimV = scaleV < 1 && video.videoHeight ? EYE_EDGE_PX / video.videoHeight : 0;
    offsetU += trimU;
    offsetV += trimV;
    scaleU -= 2 * trimU;
    scaleV -= 2 * trimV;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, offsetU + uv.getX(i) * scaleU, offsetV + uv.getY(i) * scaleV);
    }
}

// Each projection builds its meshes from the video material (and the player, for the depth).
// Stereo projections put one mesh on layer 1 (left eye) and one on layer 2 (right eye);
// three.js renders those layers to the matching eye in VR.
export const PROJECTIONS = {
    EAC: { build: (m) => [eacMesh(m)] },
    EAC_LR: { build: (m) => eacStereoMeshes(m) },
    CUBE: { build: (m) => [boxMesh(backSide(m), CUBE_FACES)] },
    360: { build: (m) => [sphereMesh(m, false, FULL_FRAME)] },
    '360_TB': {
        build: (m) => [sphereMesh(m, false, TOP_HALF, 1), sphereMesh(m, false, BOTTOM_HALF, 2)],
    },
    '360_LR': {
        build: (m) => [sphereMesh(m, false, LEFT_HALF, 1), sphereMesh(m, false, RIGHT_HALF, 2)],
    },
    180: { build: (m) => [sphereMesh(m, true, FULL_FRAME)], hemisphere: true },
    '180_LR': {
        build: (m) => [sphereMesh(m, true, LEFT_HALF, 1), sphereMesh(m, true, RIGHT_HALF, 2)],
        hemisphere: true,
    },
    FLAT: { build: (m) => [flatScreenMesh(m)] },
    FLAT_LR: { build: (m) => flatStereoMeshes(m, 'LR') },
    FLAT_TB: { build: (m) => flatStereoMeshes(m, 'TB') },
    FLAT_AI: { build: (m, player) => [depthScreenMesh(m, player.depthSource(), player.depthStrength)] },
};

// Equirectangular sphere (or front hemisphere for 180°), centred on -Z where the viewer faces.
// 360° always covers 180° vertically, even when squeezed (e.g. 2:1 top/bottom). For 180° the
// vertical field of view follows the eye's aspect ratio: YouTube's VR180 is 4:3, 180° x 135°.
export const SPHERE_RADIUS = 500;
function sphereMesh(material, halfSphere, region, layer) {
    const horizontalFov = halfSphere ? Math.PI : Math.PI * 2;
    const video = material.map.image;
    let verticalFov = Math.PI;
    if (halfSphere && video.videoWidth && video.videoHeight) {
        const eyeAspect = (video.videoWidth * region[2]) / (video.videoHeight * region[3]);
        verticalFov = Math.min(Math.PI, horizontalFov / eyeAspect);
    }
    const geometry = new THREE.SphereGeometry(
        SPHERE_RADIUS,
        60,
        40,
        halfSphere ? Math.PI : Math.PI / 2,
        horizontalFov,
        (Math.PI - verticalFov) / 2,
        verticalFov,
    );
    geometry.scale(-1, 1, 1); // Invert the geometry to match equirectangular projection
    remapUV(geometry, region, video);
    const mesh = new THREE.Mesh(geometry, material);
    if (layer) mesh.layers.set(layer);
    return mesh;
}

// Cube projections, ported from videojs-vr. Each face lists the corners of its cell in the
// video frame as [bottom-left, bottom-right, top-right, top-left] (UV space, v pointing up).
const v2 = (x, y) => new THREE.Vector2(x, y);
const CUBE_FACES = {
    left: [v2(0, 0.5), v2(1 / 3, 0.5), v2(1 / 3, 1), v2(0, 1)],
    right: [v2(1 / 3, 0.5), v2(2 / 3, 0.5), v2(2 / 3, 1), v2(1 / 3, 1)],
    top: [v2(2 / 3, 0.5), v2(1, 0.5), v2(1, 1), v2(2 / 3, 1)],
    bottom: [v2(0, 0), v2(1 / 3, 0), v2(1 / 3, 0.5), v2(0, 0.5)],
    front: [v2(1 / 3, 0), v2(2 / 3, 0), v2(2 / 3, 0.5), v2(1 / 3, 0.5)],
    back: [v2(2 / 3, 0), v2(1, 0), v2(1, 0.5), v2(2 / 3, 0.5)],
};

// YouTube's equi-angular cubemap: left/front/right on the top row, bottom/back/top on the
// bottom row rotated by 90°
function eacFaces() {
    return {
        right: [v2(0, 0.5), v2(1 / 3, 0.5), v2(1 / 3, 1), v2(0, 1)],
        front: [v2(1 / 3, 0.5), v2(2 / 3, 0.5), v2(2 / 3, 1), v2(1 / 3, 1)],
        left: [v2(2 / 3, 0.5), v2(1, 0.5), v2(1, 1), v2(2 / 3, 1)],
        bottom: [v2(1 / 3, 0), v2(1 / 3, 0.5), v2(0, 0.5), v2(0, 0)],
        back: [v2(1 / 3, 0.5), v2(1 / 3, 0), v2(2 / 3, 0), v2(2 / 3, 0.5)],
        top: [v2(1, 0), v2(1, 0.5), v2(2 / 3, 0.5), v2(2 / 3, 0)],
    };
}

// BoxGeometry builds its faces in the order +X, -X, +Y, -Y, +Z, -Z, four vertices each in
// the order top-left, top-right, bottom-left, bottom-right. The box is viewed from inside
// and turned around so its front face ends up in front of the viewer.
function boxMesh(material, faces, layer) {
    const geometry = new THREE.BoxGeometry(256, 256, 256);
    const uv = geometry.attributes.uv;
    ['right', 'left', 'top', 'bottom', 'front', 'back'].forEach((name, face) => {
        const [bottomLeft, bottomRight, topRight, topLeft] = faces[name];
        // mirrored horizontally, because the face is seen from the back
        [topRight, topLeft, bottomRight, bottomLeft].forEach((corner, i) => {
            uv.setXY(face * 4 + i, corner.x, corner.y);
        });
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = -Math.PI;
    if (layer) mesh.layers.set(layer);
    return mesh;
}

function backSide(material) {
    const clone = material.clone();
    clone.side = THREE.BackSide;
    return clone;
}

// "Continuity correction": EAC faces are packed edge to edge, so trim a 2px strip on each
// face edge to avoid bleeding from the neighbouring face
const EAC_EDGE_PX = 2;

function eacMesh(material, mapMatrix = new THREE.Matrix3(), scaleMatrix = new THREE.Matrix3(), layer) {
    const video = material.map.image;
    const height = video.videoHeight || 1080;
    const faces = eacFaces();
    for (const corners of Object.values(faces)) {
        const lowY = Math.min(...corners.map((c) => c.y));
        const highY = Math.max(...corners.map((c) => c.y));
        for (const corner of corners) {
            if (corner.y === lowY) corner.y += EAC_EDGE_PX / height;
            if (corner.y === highY) corner.y -= EAC_EDGE_PX / height;
            corner.x = (corner.x / height) * (height - EAC_EDGE_PX * 2) + EAC_EDGE_PX / height;
        }
    }
    const shader = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
            mapped: { value: material.map },
            mapMatrix: { value: mapMatrix },
            contCorrect: { value: EAC_EDGE_PX },
            faceWH: { value: new THREE.Vector2(1 / 3, 1 / 2).applyMatrix3(scaleMatrix) },
            vidWH: { value: new THREE.Vector2(video.videoWidth || 1920, height).applyMatrix3(scaleMatrix) },
        },
        vertexShader: `
            varying vec2 vUv;
            uniform mat3 mapMatrix;
            void main() {
                vUv = (mapMatrix * vec3(uv, 1.)).xy;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
            }`,
        // undo the equi-angular spacing: tan-distributed cube coordinates -> linear texture coordinates
        fragmentShader: `
            varying vec2 vUv;
            uniform sampler2D mapped;
            uniform vec2 faceWH;
            uniform vec2 vidWH;
            uniform float contCorrect;
            const float PI = 3.1415926535897932384626433832795;
            void main() {
                vec2 corner = vUv - mod(vUv, faceWH) + vec2(0, contCorrect / vidWH.y);
                vec2 faceWHadj = faceWH - vec2(0, contCorrect * 2. / vidWH.y);
                vec2 p = (vUv - corner) / faceWHadj - .5;
                vec2 q = 2. / PI * atan(2. * p) + .5;
                gl_FragColor = texture2D(mapped, corner + q * faceWHadj);
            }`,
    });
    return boxMesh(shader, faces, layer);
}

// Stereo EAC: the two eyes' cubemaps side by side, each rotated by 90°
function eacStereoMeshes(material) {
    const scaleMatrix = new THREE.Matrix3().set(0, 0.5, 0, 1, 0, 0, 0, 0, 1);
    return [
        eacMesh(material, new THREE.Matrix3().set(0, -0.5, 0.5, 1, 0, 0, 0, 0, 1), scaleMatrix, 1),
        eacMesh(material, new THREE.Matrix3().set(0, -0.5, 1, 1, 0, 0, 0, 0, 1), scaleMatrix, 2),
    ];
}

// A 2m tall screen, for videos that are only available flat; VRPlayer puts it in its movable
// screen group
function flatScreenMesh(material) {
    const video = material.map.image;
    const aspect = videoAspect(video);
    return new THREE.Mesh(new THREE.PlaneGeometry(2 * aspect, 2), material);
}

// The flat screen in 3D, from a frame with the two eyes side by side ('LR') or above each other
// ('TB', left eye on top): one plane per eye, in the same place. Most of these videos are "half"
// side by side or top/bottom, each eye squeezed to half the width or height of a normal 16:9
// frame, so the screen keeps the frame's shape. A frame twice as wide (32:9) or twice as tall
// (16:18) as usual holds two full-size pictures, so the screen gets one eye's shape.
const FULL_SBS_ASPECT = 3;
const FULL_TB_ASPECT = 1.2;
function flatStereoMeshes(material, split) {
    const video = material.map.image;
    const frameAspect = videoAspect(video);
    let aspect = frameAspect;
    if (split === 'LR' && frameAspect >= FULL_SBS_ASPECT) aspect = frameAspect / 2;
    if (split === 'TB' && frameAspect <= FULL_TB_ASPECT) aspect = frameAspect * 2;
    const halves = split === 'LR' ? [LEFT_HALF, RIGHT_HALF] : [TOP_HALF, BOTTOM_HALF];
    return halves.map((region, eye) => {
        const geometry = new THREE.PlaneGeometry(2 * aspect, 2);
        remapUV(geometry, region, video);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.layers.set(eye + 1);
        return mesh;
    });
}

// The flat screen made 3D: a finely divided plane whose vertices the depth map (0 far, 1 near)
// pushes towards or away from the viewer, by up to half the strength (in metres) each way.
// Both eyes look at the same mesh, so the depth shows as real parallax.
const DEPTH_MESH_COLUMNS = 192;

// depth: the DepthSource, which supplies both the depth map and the matching frames
function depthScreenMesh(material, depth, strength) {
    const video = material.map.image;
    const aspect = videoAspect(video);
    const geometry = new THREE.PlaneGeometry(
        2 * aspect,
        2,
        DEPTH_MESH_COLUMNS,
        Math.round(DEPTH_MESH_COLUMNS / aspect),
    );
    const shader = new THREE.ShaderMaterial({
        // three.js uploads video textures as they are, without decoding sRGB like it does for
        // the depth source's frames, so the live video (shown until the first estimate) is
        // decoded here; the built-in materials do the same
        uniforms: {
            mapped: depth.picture,
            depthMap: { value: depth.texture },
            strength,
            decodeVideo: {
                get value() {
                    return depth.picture.value.isVideoTexture === true;
                },
            },
        },
        vertexShader: `
            varying vec2 vUv;
            uniform sampler2D depthMap;
            uniform float strength;
            void main() {
                vUv = uv;
                // the depth map's first row is the top of the picture
                float depth = texture2D(depthMap, vec2(uv.x, 1. - uv.y)).r;
                vec3 displaced = position + vec3(0., 0., (depth - .5) * strength);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.);
            }`,
        fragmentShader: `
            varying vec2 vUv;
            uniform sampler2D mapped;
            uniform bool decodeVideo;
            void main() {
                gl_FragColor = texture2D(mapped, vUv);
                if (decodeVideo) gl_FragColor = sRGBTransferEOTF(gl_FragColor);
                #include <colorspace_fragment>
            }`,
    });
    return new THREE.Mesh(geometry, shader);
}
