import * as THREE from 'three';
import { PROJECTION_LABELS } from './projections.js';
import { VRControls } from './vr-controls.js';

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
const LEFT_HALF = [0, 0, 0.5, 1],
    RIGHT_HALF = [0.5, 0, 0.5, 1];
const TOP_HALF = [0, 0.5, 1, 0.5],
    BOTTOM_HALF = [0, 0, 1, 0.5];

// Each projection builds its meshes. Stereo projections put one mesh on layer 1 (left eye)
// and one on layer 2 (right eye); three.js renders those layers to the matching eye in VR.
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
    180: { build: (m) => [sphereMesh(m, true, FULL_FRAME)] },
    '180_LR': {
        build: (m) => [sphereMesh(m, true, LEFT_HALF, 1), sphereMesh(m, true, RIGHT_HALF, 2)],
    },
    FLAT: { build: (m) => [flatScreenMesh(m)] },
};

// Equirectangular sphere (or front hemisphere for 180°), centred on -Z where the viewer faces.
// The vertical field of view follows the eye's aspect ratio (same angle per pixel both ways),
// e.g. YouTube serves VR180 as 4:3 frames covering 180° x 135°.
function sphereMesh(material, halfSphere, [offsetU, offsetV, scaleU, scaleV], layer) {
    const horizontalFov = halfSphere ? Math.PI : Math.PI * 2;
    const video = material.map.image;
    const eyeAspect =
        video.videoWidth && video.videoHeight
            ? (video.videoWidth * scaleU) / (video.videoHeight * scaleV)
            : horizontalFov / Math.PI;
    const verticalFov = Math.min(Math.PI, horizontalFov / eyeAspect);
    const geometry = new THREE.SphereGeometry(
        500,
        60,
        40,
        halfSphere ? Math.PI : Math.PI / 2,
        horizontalFov,
        (Math.PI - verticalFov) / 2,
        verticalFov,
    );
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

// A 2m tall screen, for videos that are only available flat. VRPlayer puts it in its movable
// screen group, 3m in front of the viewer to start with.
const SCREEN_DISTANCE = 3;
const BACKGROUND = 0x101010;
function flatScreenMesh(material) {
    const video = material.map.image;
    const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    return new THREE.Mesh(new THREE.PlaneGeometry(2 * aspect, 2), material);
}

// Renders a <video> element into a WebXR session with a switchable projection
export class VRPlayer {
    constructor(video, projection) {
        this.video = video;
        this.projection = projection;
        this.meshes = [];

        // a near plane of a few centimetres, so the controls panel and a screen pulled close
        // aren't clipped away (the XR session takes its depth range from this camera)
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 2000);
        this.camera.layers.enable(1); // render left view when no stereo available

        const texture = new THREE.VideoTexture(video);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        this.material = new THREE.MeshBasicMaterial({ map: texture });

        this.scene = new THREE.Scene();
        // In AR sessions the headset shows the room wherever the image is transparent. The
        // render loop clears the frame itself (see render()), opaque dark grey normally and
        // transparent for passthrough, because three.js would always clear to transparent there.
        this.passthrough = false;
        // AR sessions can show the headset's passthrough; asked early, so entering VR doesn't
        // have to wait for the answer and lose the click's user activation
        this.arSupported = false;
        navigator.xr
            ?.isSessionSupported('immersive-ar')
            .then((supported) => {
                this.arSupported = supported;
            })
            .catch(() => {});
        // the 360°/180° meshes, turned by "Recenter", and the flat screen, which can be grabbed
        this.world = new THREE.Group();
        this.screen = new THREE.Group();
        this.placeScreen(new THREE.Vector3(), 0);
        this.scene.add(this.world, this.screen);
        this.setProjection(projection);
        // the geometry depends on the video's aspect ratio, which can change with quality switches
        this.onVideoResize = () => this.setProjection(this.projection);
        video.addEventListener('resize', this.onVideoResize);

        // antialias also turns on multisampling for the headset's image (three.js passes it on
        // to the XR layer), which smooths the edges of the screen, panel and lasers
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.xr.enabled = true;
        this.renderer.xr.setReferenceSpaceType('local');
        this.renderer.autoClear = false;
        this.vrControls = new VRControls(this);
        this.timer = new THREE.Timer();
        this.renderer.setAnimationLoop((timestamp) => {
            this.timer.update(timestamp);
            this.vrControls.update(this.timer.getDelta());
            this.render();
        });
        this.onSessionEnd = () => this.setPassthrough(false);
        this.renderer.xr.addEventListener('sessionend', this.onSessionEnd);

        this.onWindowResize = () => {
            if (this.renderer.xr.isPresenting) return;
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', this.onWindowResize);
    }

    // Starts an immersive session. Chrome only allows this from a user gesture in the page,
    // so call it synchronously from a click handler. Where the browser supports AR, the
    // session is an AR one, which looks the same until passthrough is turned on.
    async enterVR() {
        const mode = this.arSupported ? 'immersive-ar' : 'immersive-vr';
        const session = await navigator.xr.requestSession(mode, {
            optionalFeatures: ['local-floor', 'bounded-floor'],
        });
        await this.renderer.xr.setSession(session);
        return session;
    }

    // Whether the current session can show the room around the video
    get passthroughAvailable() {
        return this.renderer.xr.isPresenting && this.renderer.xr.getEnvironmentBlendMode() === 'alpha-blend';
    }

    setPassthrough(on) {
        this.passthrough = on;
    }

    // Clears the frame (in VR, the headset's image, which three.js binds before the animation
    // loop runs): alpha 1 hides the room in AR sessions, alpha 0 lets it show through
    render() {
        this.renderer.setClearColor(BACKGROUND, this.passthrough ? 0 : 1);
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        // shortcut: Frame needs an explicit GPU flush before XR submission; remove after a runtime fix.
        if (this.renderer.xr.isPresenting) this.renderer.getContext().flush();
    }

    get canvas() {
        return this.renderer.domElement;
    }

    setProjection(name) {
        this.projection = name;
        if (this.select) this.select.value = name;
        this.disposeMeshes();
        this.meshes = PROJECTIONS[name].build(this.material);
        const parent = name === 'FLAT' ? this.screen : this.world;
        for (const mesh of this.meshes) parent.add(mesh);
    }

    // Puts the flat screen in front of a viewer at position, looking towards yaw
    placeScreen(position, yaw) {
        const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        this.screen.position.copy(position).addScaledVector(forward, SCREEN_DISTANCE);
        this.screen.rotation.set(0, yaw, 0);
        this.screen.scale.setScalar(1);
    }

    // The Enter VR button and projection dropdown side by side, plus any extra buttons
    createControls(...extraButtons) {
        this.controls = document.createElement('div');
        Object.assign(this.controls.style, { display: 'flex', justifyContent: 'center', gap: '8px' });
        this.controls.append(this.createVRButton(), this.createProjectionSelect(), ...extraButtons);
        return this.controls;
    }

    // Like three.js' VRButton, but enters through enterVR(), which picks AR when available
    createVRButton() {
        const button = document.createElement('button');
        styleControl(button);
        button.style.width = '100px';
        button.textContent = 'ENTER VR';
        button.disabled = true;
        const supported = (mode) => navigator.xr?.isSessionSupported(mode).catch(() => false) ?? false;
        Promise.all([supported('immersive-vr'), supported('immersive-ar')]).then(([vr, ar]) => {
            button.disabled = !vr && !ar;
            if (button.disabled) button.textContent = 'VR NOT SUPPORTED';
        });
        button.onclick = () => {
            const session = this.renderer.xr.getSession();
            if (session) session.end();
            else this.enterVR().catch((e) => console.warn('video2webxr: entering VR failed:', e));
        };
        this.renderer.xr.addEventListener('sessionstart', () => {
            button.textContent = 'EXIT VR';
        });
        this.renderer.xr.addEventListener('sessionend', () => {
            button.textContent = 'ENTER VR';
        });
        return button;
    }

    createProjectionSelect() {
        const select = document.createElement('select');
        select.id = 'VRProjectionSelect';
        select.title = 'Video projection';
        for (const [value, label] of PROJECTION_LABELS) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            option.style.background = '#222';
            select.appendChild(option);
        }
        select.value = this.projection;
        styleControl(select);
        select.onchange = () => this.setProjection(select.value);
        this.select = select;
        return select;
    }

    disposeMeshes() {
        for (const mesh of this.meshes) {
            mesh.removeFromParent();
            mesh.geometry.dispose();
            if (mesh.material !== this.material) mesh.material.dispose();
        }
        this.meshes = [];
    }

    async dispose() {
        const session = this.renderer.xr.getSession();
        if (session) await session.end().catch(() => {});
        this.renderer.setAnimationLoop(null);
        this.vrControls.dispose();
        this.video.removeEventListener('resize', this.onVideoResize);
        window.removeEventListener('resize', this.onWindowResize);
        this.disposeMeshes();
        this.material.map.dispose();
        this.material.dispose();
        this.renderer.xr.removeEventListener('sessionend', this.onSessionEnd);
        this.canvas.remove();
        if (this.controls) this.controls.remove();
        this.renderer.dispose();
    }
}

// Same look as three.js' VR button
export function styleControl(element) {
    Object.assign(element.style, {
        padding: '12px 6px',
        border: '1px solid #fff',
        borderRadius: '4px',
        background: 'rgba(0,0,0,0.1)',
        color: '#fff',
        font: 'normal 13px sans-serif',
        opacity: '0.5',
        outline: 'none',
        cursor: 'pointer',
    });
    element.onmouseenter = () => {
        element.style.opacity = '1.0';
    };
    element.onmouseleave = () => {
        element.style.opacity = '0.5';
    };
}
