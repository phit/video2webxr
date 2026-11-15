import * as THREE from 'three';
import { DEPTH_STRENGTHS, DepthSource } from './depth.js';
import { forwardFromYaw, PROJECTIONS, SPHERE_RADIUS } from './meshes.js';
import { DISTANCES, depthSupported, enterVRError, FLAT_PROJECTIONS, PROJECTION_LABELS } from './projections.js';
import { VRControls } from './vr-controls.js';

// Chrome exposes XRWebGLBinding.createProjectionLayer even when the session isn't granted
// the 'layers' feature. three.js only checks that the method exists, sets up a projection
// layer the session can't use, and Chrome then never delivers an XR frame (SteamVR shows
// "not responding"). Hide it so three.js falls back to XRWebGLLayer. This only affects the
// extension's isolated world, not the page's own scripts.
if (typeof XRWebGLBinding !== 'undefined') {
    delete XRWebGLBinding.prototype.createProjectionLayer;
}

// AR sessions can show passthrough. Asked when the script loads, because the click that
// enters VR can't wait for the answer without losing its user activation.
let arSupported = false;
navigator.xr
    ?.isSessionSupported('immersive-ar')
    .then((supported) => {
        arSupported = supported;
    })
    .catch(() => {});

// The viewer sits behind the centre of a 180° video by one of DISTANCES (see projections.js),
// remembered per site
const DISTANCE_KEY = 'video2webxr-distance';
// Physically stepping back from where you recentered moves you back too, as if the hemisphere
// were a dome of this radius (metres): the real 500m sphere would hardly change, and a small
// sphere would make 3D videos feel closer, since the eyes would converge on its surface.
// Only backwards along the recentered forward direction counts, so swaying and leaning don't
// shift the picture.
const WALK_RADIUS = 3;
const MAX_DISTANCE = 1.5; // in radii, keeps the far side within the camera's far plane

// The flat screen starts this far (metres) in front of the viewer
const SCREEN_DISTANCE = 3;
// around the flat screen, and behind everything unless passthrough is on
const BACKGROUND = 0x101010;

// The flat screen usually shows the video much smaller than its resolution (a 4K video on the
// 2 m screen at 3 m), which shimmers without mipmaps. 360°/180° roughly match the headset's
// resolution, so they skip the cost of making mipmaps for every frame.
const SCREEN_ANISOTROPY = 8; // three.js caps it at what the GPU supports
function useMipmaps(texture, on) {
    if (texture.generateMipmaps === on) return;
    texture.generateMipmaps = on;
    texture.minFilter = on ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    texture.anisotropy = on ? SCREEN_ANISOTROPY : 1;
    // the GPU copy was allocated with the old number of mipmap levels; Texture's own dispose,
    // since VideoTexture's would also stop the frame updates
    THREE.Texture.prototype.dispose.call(texture);
    texture.needsUpdate = true;
}

// Renders a <video> element into a WebXR session with a switchable projection
export class VRPlayer {
    constructor(video, projection) {
        this.video = video;
        this.projection = projection;
        this.meshes = [];

        // a near plane of a few centimetres, so the controls panel and a screen pulled close
        // aren't clipped away (the XR session takes its depth range from this camera)
        this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 2000);
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
        // to the XR layer), which smooths the edges of the screen, panel and lasers. The canvas
        // itself is never shown, so it's kept tiny.
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(1, 1, false);
        this.renderer.xr.enabled = true;
        this.renderer.xr.setReferenceSpaceType('local');
        this.renderer.autoClear = false;
        this.vrControls = new VRControls(this);
        this.timer = new THREE.Timer();
        // Nothing is shown outside VR, so render (and estimate depth) only in a session. The
        // loop stays set: three.js switches it between the page's and the session's frames.
        this.renderer.setAnimationLoop((timestamp) => {
            if (!this.renderer.xr.isPresenting) return;
            this.timer.update(timestamp);
            // a long first frame shouldn't count as time the controllers stood still
            this.vrControls.update(Math.min(this.timer.getDelta(), 0.1));
            this.placeSphere();
            this.render();
        });
        this.onSessionStart = () => {
            this.timer.reset();
            if (this.projection === 'FLAT_AI') this.depthSource().start();
        };
        this.onSessionEnd = () => {
            this.depth?.stop();
            this.setPassthrough(false);
        };
        this.renderer.xr.addEventListener('sessionstart', this.onSessionStart);
        this.renderer.xr.addEventListener('sessionend', this.onSessionEnd);
    }

    // Starts an immersive session. Chrome only allows this from a user gesture in the page,
    // so call it synchronously from a click handler. Where the browser supports AR, the
    // session is an AR one, which looks the same until passthrough is turned on.
    async enterVR() {
        const mode = arSupported ? 'immersive-ar' : 'immersive-vr';
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

    setProjection(name) {
        this.projection = name;
        if (this.select) this.select.value = name;
        this.disposeMeshes();
        this.meshes = PROJECTIONS[name].build(this.material, this);
        const parent = this.isFlat ? this.screen : this.sphere;
        for (const mesh of this.meshes) parent.add(mesh);
        useMipmaps(this.material.map, this.isFlat);
        // estimate depth only while it's shown in VR
        if (name === 'FLAT_AI' && this.renderer?.xr.isPresenting) this.depthSource().start();
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

    // What's holding up the AI depth (downloading the model, starting, failed), if it's shown
    get depthStatus() {
        return this.projection === 'FLAT_AI' ? (this.depth?.status ?? '') : '';
    }

    // The next 3D strength level of "Flat screen 3D (AI)", wrapping around
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
        this.screen.position.copy(position).addScaledVector(forwardFromYaw(yaw), SCREEN_DISTANCE);
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
        this.disposeMeshes();
        this.material.map.dispose();
        this.material.dispose();
        this.depth?.dispose();
        this.renderer.xr.removeEventListener('sessionstart', this.onSessionStart);
        this.renderer.xr.removeEventListener('sessionend', this.onSessionEnd);
        if (this.controls) this.controls.remove();
        this.renderer.dispose();
        // or Chrome keeps the context until garbage collection, and warns after a few videos
        this.renderer.forceContextLoss();
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
