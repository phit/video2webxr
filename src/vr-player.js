import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

// Chrome exposes XRWebGLBinding.createProjectionLayer even when the session isn't granted
// the 'layers' feature. three.js only checks that the method exists, sets up a projection
// layer the session can't use, and Chrome then never delivers an XR frame (SteamVR shows
// "not responding"). Hide it so three.js falls back to XRWebGLLayer. This only affects the
// extension's isolated world, not the page's own scripts.
if (typeof XRWebGLBinding !== 'undefined') {
    delete XRWebGLBinding.prototype.createProjectionLayer;
}

// Texture regions for each eye: [offsetU, offsetV, scaleU, scaleV]
const FULL_FRAME = [0, 0, 1, 1];
const LEFT_HALF = [0, 0, 0.5, 1], RIGHT_HALF = [0.5, 0, 0.5, 1];
const TOP_HALF = [0, 0.5, 1, 0.5], BOTTOM_HALF = [0, 0, 1, 0.5];

// Each projection builds its meshes. Stereo projections put one mesh on layer 1 (left eye)
// and one on layer 2 (right eye); three.js renders those layers to the matching eye in VR.
export const PROJECTIONS = {
    'EAC':    { label: '360° EAC (YouTube default)', build: (m) => [eacMesh(m)] },
    'EAC_LR': { label: '360° EAC 3D', build: (m) => eacStereoMeshes(m) },
    'CUBE':   { label: '360° cubemap', build: (m) => [boxMesh(backSide(m), CUBE_FACES)] },
    '360':    { label: '360° equirectangular', build: (m) => [sphereMesh(m, false, FULL_FRAME)] },
    '360_TB': { label: '360° 3D top/bottom', build: (m) => [sphereMesh(m, false, TOP_HALF, 1), sphereMesh(m, false, BOTTOM_HALF, 2)] },
    '360_LR': { label: '360° 3D side by side', build: (m) => [sphereMesh(m, false, LEFT_HALF, 1), sphereMesh(m, false, RIGHT_HALF, 2)] },
    '180':    { label: '180°', build: (m) => [sphereMesh(m, true, FULL_FRAME)] },
    '180_LR': { label: '180° 3D side by side', build: (m) => [sphereMesh(m, true, LEFT_HALF, 1), sphereMesh(m, true, RIGHT_HALF, 2)] },
    'FLAT':   { label: 'Flat screen', build: (m) => [flatScreenMesh(m)] },
};

// Equirectangular sphere (or front hemisphere for 180°), centred on -Z where the viewer faces.
// The vertical field of view follows the eye's aspect ratio (same angle per pixel both ways),
// e.g. YouTube serves VR180 as 4:3 frames covering 180° x 135°.
function sphereMesh(material, halfSphere, [offsetU, offsetV, scaleU, scaleV], layer) {
    const horizontalFov = halfSphere ? Math.PI : Math.PI * 2;
    const video = material.map.image;
    const eyeAspect = video.videoWidth && video.videoHeight
        ? (video.videoWidth * scaleU) / (video.videoHeight * scaleV)
        : horizontalFov / Math.PI;
    const verticalFov = Math.min(Math.PI, horizontalFov / eyeAspect);
    const geometry = new THREE.SphereGeometry(500, 60, 40,
        halfSphere ? Math.PI : Math.PI / 2, horizontalFov,
        (Math.PI - verticalFov) / 2, verticalFov);
    geometry.scale(-1, 1, 1); // Invert the geometry to match equirectangular projection
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, offsetU + uv.getX(i) * scaleU, offsetV + uv.getY(i) * scaleV);
    }
    const mesh = new THREE.Mesh(geometry, material);
    if (layer) mesh.layers.set(layer);
    return mesh;
}

// Cube projections, ported from videojs-vr. Each face lists the corners of its cell in the
// video frame as [bottom-left, bottom-right, top-right, top-left] (UV space, v pointing up).
const v2 = (x, y) => new THREE.Vector2(x, y);
const CUBE_FACES = {
    left:   [v2(0, .5), v2(1 / 3, .5), v2(1 / 3, 1), v2(0, 1)],
    right:  [v2(1 / 3, .5), v2(2 / 3, .5), v2(2 / 3, 1), v2(1 / 3, 1)],
    top:    [v2(2 / 3, .5), v2(1, .5), v2(1, 1), v2(2 / 3, 1)],
    bottom: [v2(0, 0), v2(1 / 3, 0), v2(1 / 3, .5), v2(0, .5)],
    front:  [v2(1 / 3, 0), v2(2 / 3, 0), v2(2 / 3, .5), v2(1 / 3, .5)],
    back:   [v2(2 / 3, 0), v2(1, 0), v2(1, .5), v2(2 / 3, .5)],
};

// YouTube's equi-angular cubemap: left/front/right on the top row, bottom/back/top on the
// bottom row rotated by 90°
function eacFaces() {
    return {
        right:  [v2(0, .5), v2(1 / 3, .5), v2(1 / 3, 1), v2(0, 1)],
        front:  [v2(1 / 3, .5), v2(2 / 3, .5), v2(2 / 3, 1), v2(1 / 3, 1)],
        left:   [v2(2 / 3, .5), v2(1, .5), v2(1, 1), v2(2 / 3, 1)],
        bottom: [v2(1 / 3, 0), v2(1 / 3, .5), v2(0, .5), v2(0, 0)],
        back:   [v2(1 / 3, .5), v2(1 / 3, 0), v2(2 / 3, 0), v2(2 / 3, .5)],
        top:    [v2(1, 0), v2(1, .5), v2(2 / 3, .5), v2(2 / 3, 0)],
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
        [topRight, topLeft, bottomRight, bottomLeft].forEach((corner, i) => uv.setXY(face * 4 + i, corner.x, corner.y));
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
        const lowY = Math.min(...corners.map(c => c.y));
        const highY = Math.max(...corners.map(c => c.y));
        for (const corner of corners) {
            if (corner.y === lowY) corner.y += EAC_EDGE_PX / height;
            if (corner.y === highY) corner.y -= EAC_EDGE_PX / height;
            corner.x = corner.x / height * (height - EAC_EDGE_PX * 2) + EAC_EDGE_PX / height;
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
                #include <colorspace_fragment>
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

// A 2m tall screen 3m in front of the viewer, for videos that are only available flat
function flatScreenMesh(material) {
    const video = material.map.image;
    const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * aspect, 2), material);
    mesh.position.set(0, 0, -3);
    return mesh;
}

// Renders a <video> element into a WebXR session with a switchable projection
export class VRPlayer {
    constructor(video, projection) {
        this.video = video;
        this.projection = projection;
        this.meshes = [];

        this.camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 1, 2000 );
        this.camera.layers.enable( 1 ); // render left view when no stereo available

        const texture = new THREE.VideoTexture(video);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        this.material = new THREE.MeshBasicMaterial({ map: texture });

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color( 0x101010 );
        this.setProjection(projection);
        // the geometry depends on the video's aspect ratio, which can change with quality switches
        this.onVideoResize = () => this.setProjection(this.projection);
        video.addEventListener('resize', this.onVideoResize);

        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setPixelRatio( window.devicePixelRatio );
        this.renderer.setSize( window.innerWidth, window.innerHeight );
        this.renderer.xr.enabled = true;
        this.renderer.xr.setReferenceSpaceType( 'local' );
        this.renderer.setAnimationLoop( () => this.renderer.render( this.scene, this.camera ) );

        this.onWindowResize = () => {
            if (this.renderer.xr.isPresenting) return;
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize( window.innerWidth, window.innerHeight );
        };
        window.addEventListener( 'resize', this.onWindowResize );
    }

    get canvas() {
        return this.renderer.domElement;
    }

    setProjection(name) {
        this.projection = name;
        this.disposeMeshes();
        this.meshes = PROJECTIONS[name].build(this.material);
        for (const mesh of this.meshes) this.scene.add(mesh);
    }

    // The Enter VR button and projection dropdown side by side, plus any extra buttons
    createControls(...extraButtons) {
        this.controls = document.createElement('div');
        Object.assign(this.controls.style, { display: 'flex', justifyContent: 'center', gap: '8px' });
        const vrButton = VRButton.createButton( this.renderer );
        vrButton.style.position = 'static';
        this.controls.append(vrButton, this.createProjectionSelect(), ...extraButtons);
        return this.controls;
    }

    createProjectionSelect() {
        const select = document.createElement('select');
        select.id = 'VRProjectionSelect';
        select.title = 'Video projection';
        for (const [value, { label }] of Object.entries(PROJECTIONS)) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            option.style.background = '#222';
            select.appendChild(option);
        }
        select.value = this.projection;
        styleControl(select);
        select.onchange = () => this.setProjection(select.value);
        return select;
    }

    disposeMeshes() {
        for (const mesh of this.meshes) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            if (mesh.material !== this.material) mesh.material.dispose();
        }
        this.meshes = [];
    }

    async dispose() {
        const session = this.renderer.xr.getSession();
        if (session) await session.end().catch(() => {});
        this.renderer.setAnimationLoop( null );
        this.video.removeEventListener('resize', this.onVideoResize);
        window.removeEventListener( 'resize', this.onWindowResize );
        this.disposeMeshes();
        this.material.map.dispose();
        this.material.dispose();
        this.canvas.remove();
        if (this.controls) this.controls.remove();
        this.renderer.dispose();
    }
}

// Same look as three.js' VR button
export function styleControl(element) {
    Object.assign(element.style, {
        padding: '12px 6px', border: '1px solid #fff', borderRadius: '4px',
        background: 'rgba(0,0,0,0.1)', color: '#fff', font: 'normal 13px sans-serif',
        opacity: '0.5', outline: 'none', cursor: 'pointer'
    });
    element.onmouseenter = () => { element.style.opacity = '1.0'; };
    element.onmouseleave = () => { element.style.opacity = '0.5'; };
}
