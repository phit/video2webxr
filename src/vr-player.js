import * as THREE from 'three';
import { DEPTH_STRENGTHS, DepthSource } from './depth.js';
import { depthSupported, enterVRError, FLAT_PROJECTIONS, PROJECTION_LABELS } from './projections.js';
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
    FLAT_AI: { build: (m, player) => [depthScreenMesh(m, player.depthSource(), player.depthStrength)] },
};

// Equirectangular sphere (or front hemisphere for 180°), centred on -Z where the viewer faces.
// The vertical field of view follows the eye's aspect ratio (same angle per pixel both ways),
// e.g. YouTube serves VR180 as 4:3 frames covering 180° x 135°.
const SPHERE_RADIUS = 500;
function sphereMesh(material, halfSphere, [offsetU, offsetV, scaleU, scaleV], layer) {
    const horizontalFov = halfSphere ? Math.PI : Math.PI * 2;
    const video = material.map.image;
    const eyeAspect =
        video.videoWidth && video.videoHeight
            ? (video.videoWidth * scaleU) / (video.videoHeight * scaleV)
            : horizontalFov / Math.PI;
    const verticalFov = Math.min(Math.PI, horizontalFov / eyeAspect);
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

// How far behind the centre of a 180° video the viewer sits, as a fraction of the sphere's
// radius. The hemisphere then becomes a big curved screen in front of you instead of
// wrapping around you: at these steps it spans about 150°, 127° and 103°, so close-ups feel
// less in your face, at the cost of some stretching towards the edges. Only a sizeable
// fraction of the radius makes a difference, which is why this isn't just a step back.
export const DISTANCES = [0, 0.25, 0.5, 0.8];
const DISTANCE_KEY = 'video2webxr-distance';
// Physically stepping back from where you recentered moves you back too, as if the hemisphere
// were a dome of this radius (metres): the real 500m sphere would hardly change, and a small
// sphere would make 3D videos feel closer, since the eyes would converge on its surface.
// Only backwards along the recentered forward direction counts, so swaying and leaning don't
// shift the picture.
const WALK_RADIUS = 3;
const MAX_DISTANCE = 1.5; // in radii, keeps the far side within the camera's far plane

// A 2m tall screen, for videos that are only available flat. VRPlayer puts it in its movable
// screen group, 3m in front of the viewer to start with.
const SCREEN_DISTANCE = 3;
const BACKGROUND = 0x101010;
function flatScreenMesh(material) {
    const video = material.map.image;
    const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    return new THREE.Mesh(new THREE.PlaneGeometry(2 * aspect, 2), material);
}

// The flat screen made 3D: a finely divided plane whose vertices the depth map (0 far, 1 near)
// pushes towards or away from the viewer, by up to half the strength (in metres) each way.
// Both eyes look at the same mesh, so the depth shows as real parallax.
const DEPTH_MESH_COLUMNS = 192;

// depth: the DepthSource, which supplies both the depth map and the matching frames
function depthScreenMesh(material, depth, strength) {
    const video = material.map.image;
    const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    const geometry = new THREE.PlaneGeometry(
        2 * aspect,
        2,
        DEPTH_MESH_COLUMNS,
        Math.round(DEPTH_MESH_COLUMNS / aspect),
    );
    const shader = new THREE.ShaderMaterial({
        uniforms: { mapped: depth.picture, depthMap: { value: depth.texture }, strength },
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
            void main() {
                gl_FragColor = texture2D(mapped, vUv);
                #include <colorspace_fragment>
            }`,
    });
    return new THREE.Mesh(geometry, shader);
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
        // "Flat screen 3D (AI)" needs depth estimation on the GPU; it's offered once that's known
        // to work. The depth source is made when first needed and kept, so switching back and
        // forth doesn't reload the model.
        this.depthSupported = false;
        this.depth = null;
        this.depthStrength = { value: DEPTH_STRENGTHS[1] }; // a uniform shared with the mesh
        depthSupported().then((supported) => {
            this.depthSupported = supported;
            if (supported && this.select) this.select.add(projectionOption('FLAT_AI'));
        });
        // the 360°/180° meshes, turned by "Recenter", and the flat screen, which can be grabbed
        this.world = new THREE.Group();
        this.screen = new THREE.Group();
        this.placeScreen(new THREE.Vector3(), 0);
        this.scene.add(this.world, this.screen);
        // the sphere meshes, moved forward by the distance setting so the viewer ends up
        // behind the centre; remembered per site, since the page's storage is all a content
        // script has
        this.sphere = new THREE.Group();
        this.world.add(this.sphere);
        this.headPosition = new THREE.Vector3();
        try {
            const distance = Number(localStorage.getItem(DISTANCE_KEY));
            this.distance = DISTANCES.includes(distance) ? distance : 0;
        } catch {
            this.distance = 0; // storage blocked
        }
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
            this.placeSphere();
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

    // enterVR() for the in-page controls: why it failed goes to lastError and the line below the
    // Enter VR button. Resolves to whether VR started.
    startSession() {
        this.lastError = null;
        if (this.errorLine) this.errorLine.hidden = true;
        return this.enterVR().then(
            () => true,
            (e) => {
                console.warn('video2webxr: entering VR failed:', e);
                this.lastError = enterVRError(e);
                if (this.errorLine) {
                    this.errorLine.textContent = this.lastError;
                    this.errorLine.hidden = false;
                }
                return false;
            },
        );
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
        this.meshes = PROJECTIONS[name].build(this.material, this);
        const parent = this.isFlat ? this.screen : this.sphere;
        for (const mesh of this.meshes) parent.add(mesh);
        // estimate depth only while it's shown
        if (name === 'FLAT_AI') this.depthSource().start();
        else this.depth?.stop();
    }

    // Whether the video is shown on the movable flat screen
    get isFlat() {
        return FLAT_PROJECTIONS.has(this.projection);
    }

    depthSource() {
        this.depth ??= new DepthSource(this.video, this.material.map);
        return this.depth;
    }

    // The next 3D strength level of "Flat screen 3D (AI)", wrapping around
    // what's holding up the AI depth (downloading the model, starting, failed), if it's shown
    get depthStatus() {
        return this.projection === 'FLAT_AI' ? (this.depth?.status ?? '') : '';
    }

    cycleDepthStrength() {
        const index = DEPTH_STRENGTHS.indexOf(this.depthStrength.value);
        this.depthStrength.value = DEPTH_STRENGTHS[(index + 1) % DEPTH_STRENGTHS.length];
    }

    // The projections this browser can show, in dropdown order
    get projectionIds() {
        return PROJECTION_LABELS.map(([id]) => id).filter((id) => id !== 'FLAT_AI' || this.depthSupported);
    }

    // Puts the viewer the distance setting plus however far they stepped back behind the
    // centre of a 180° video (see WALK_RADIUS); called every frame
    placeSphere() {
        let back = 0;
        if (this.isHemisphere && this.renderer.xr.isPresenting) {
            this.renderer.xr.getCamera().getWorldPosition(this.headPosition);
            back = Math.max(0, this.world.worldToLocal(this.headPosition).z);
        }
        const distance = this.isHemisphere ? Math.min(MAX_DISTANCE, this.distance + back / WALK_RADIUS) : 0;
        this.sphere.position.z = back - distance * SPHERE_RADIUS;
    }

    // Whether the projection is a 180° one, which the distance setting applies to
    get isHemisphere() {
        return !!PROJECTIONS[this.projection].hemisphere;
    }

    cycleDistance() {
        this.distance = DISTANCES[(DISTANCES.indexOf(this.distance) + 1) % DISTANCES.length];
        try {
            localStorage.setItem(DISTANCE_KEY, this.distance);
        } catch {
            // only kept for this video
        }
    }

    // Puts the flat screen in front of a viewer at position, looking towards yaw
    placeScreen(position, yaw) {
        const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        this.screen.position.copy(position).addScaledVector(forward, SCREEN_DISTANCE);
        this.screen.rotation.set(0, yaw, 0);
        this.screen.scale.setScalar(1);
    }

    // The Enter VR button and projection dropdown side by side, plus any extra buttons
    // (YouTube only), with a line below for why entering VR failed
    createControls(...extraButtons) {
        this.controls = document.createElement('div');
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', justifyContent: 'center', gap: '8px' });
        this.errorLine = document.createElement('div');
        this.errorLine.hidden = true;
        Object.assign(this.errorLine.style, {
            margin: '8px auto 0',
            maxWidth: '640px',
            padding: '8px 12px',
            borderRadius: '12px',
            background: CONTROL_BACKGROUND,
            color: CONTROL_TEXT,
            textAlign: 'center',
            font: '13px/1.4 Roboto, Arial, sans-serif',
        });
        row.append(this.createVRButton(), this.createProjectionSelect(), ...extraButtons);
        this.controls.append(row, this.errorLine);
        return this.controls;
    }

    // Like three.js' VRButton, but enters through enterVR(), which picks AR when available
    createVRButton() {
        const button = document.createElement('button');
        styleControl(button);
        button.style.minWidth = '110px';
        button.textContent = 'ENTER VR';
        button.disabled = true;
        const supported = (mode) => navigator.xr?.isSessionSupported(mode).catch(() => false) ?? false;
        Promise.all([supported('immersive-vr'), supported('immersive-ar')]).then(([vr, ar]) => {
            button.disabled = !vr && !ar;
            if (button.disabled) {
                button.textContent = 'VR NOT SUPPORTED';
                button.style.cursor = 'default';
            }
        });
        button.onclick = () => {
            const session = this.renderer.xr.getSession();
            if (session) {
                session.end();
                return;
            }
            this.startSession();
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
        for (const id of this.projectionIds) select.appendChild(projectionOption(id));
        select.value = this.projection;
        styleControl(select);
        // its own arrow, clear of the rounded end, instead of the browser's at the very edge
        Object.assign(select.style, {
            appearance: 'none',
            paddingRight: '36px',
            backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(SELECT_ARROW)}")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 14px center',
        });
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
        this.depth?.dispose();
        this.renderer.xr.removeEventListener('sessionend', this.onSessionEnd);
        this.canvas.remove();
        if (this.controls) this.controls.remove();
        this.renderer.dispose();
    }
}

function projectionOption(id) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = PROJECTION_LABELS.find(([value]) => value === id)[1];
    // the open dropdown list
    Object.assign(option.style, { background: CONTROL_BACKGROUND, color: CONTROL_TEXT });
    return option;
}

// Shaped like YouTube's chip buttons, in fixed colours that read on both its light and dark
// theme: YouTube's dark-theme chip grey, like its black Subscribe button in the light theme.
// (YouTube's own theme variables aren't reachable from here.)
const CONTROL_BACKGROUND = '#272727';
const CONTROL_HOVER = '#3f3f3f';
const CONTROL_TEXT = '#f1f1f1';
const SELECT_ARROW = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8"><path d="M1 1.5l5 5 5-5" fill="none" stroke="${CONTROL_TEXT}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function styleControl(element) {
    Object.assign(element.style, {
        height: '36px',
        padding: '0 16px',
        border: 'none',
        borderRadius: '18px',
        backgroundColor: CONTROL_BACKGROUND,
        color: CONTROL_TEXT,
        font: '500 14px Roboto, Arial, sans-serif',
        cursor: 'pointer',
    });
    element.onmouseenter = () => {
        if (!element.disabled) element.style.backgroundColor = CONTROL_HOVER;
    };
    element.onmouseleave = () => {
        element.style.backgroundColor = CONTROL_BACKGROUND;
    };
}
