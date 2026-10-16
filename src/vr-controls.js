import * as THREE from 'three';
import { PROJECTION_LABELS } from './projections.js';

// In-VR controls: a laser from each controller, a panel with the video's controls, and
// moving things around like in the Steam Frame's UI. Point the laser and pull the trigger to
// use a control. The panel and the flat screen each have a bar below them: drag it with the
// trigger to move them (or hold the grip anywhere on them); while held, the thumbstick moves
// them away/closer and resizes them. The screen's bottom right corner resizes it. A/X or B/Y
// hide and show the panel, and the trigger shows it again too. Clicking the flat screen
// plays/pauses; double clicking its left or right third skips back or forward.

// The panel is drawn into a canvas and shown on a plane PANEL_WIDTH metres wide
const CANVAS_W = 1280;
const CANVAS_H = 256;
const PANEL_WIDTH = 1.0;
const PANEL_HEIGHT = (PANEL_WIDTH * CANVAS_H) / CANVAS_W;
const SKIP_SECONDS = 10;
const DOUBLE_CLICK_MS = 300;
const LASER_LENGTH = 5;
const HANDLE_OPACITY = 0.5;
const MIN_SCALE = 0.2;
const MAX_SCALE = 10;
// How quickly dragged windows catch up with the controller (per second); lower is smoother
// but lags more
const SMOOTHING = 12;

// xr-standard gamepad mapping
const BUTTON_A_X = 4;
const BUTTON_B_Y = 5;
const AXIS_STICK_X = 2;
const AXIS_STICK_Y = 3;

// Hit areas on the canvas, in canvas pixels
const ROW_TOP = 24;
const ROW_BOTTOM = 140;
const ROW_HEIGHT = 92;
const AREAS_WITH_PASSTHROUGH = {
    seek: { x: 150, y: ROW_TOP + 28, w: 980, h: 36 },
    back: { x: 16, y: ROW_BOTTOM, w: 88, h: ROW_HEIGHT },
    play: { x: 112, y: ROW_BOTTOM, w: 88, h: ROW_HEIGHT },
    forward: { x: 208, y: ROW_BOTTOM, w: 88, h: ROW_HEIGHT },
    mute: { x: 328, y: ROW_BOTTOM, w: 88, h: ROW_HEIGHT },
    volume: { x: 428, y: ROW_BOTTOM + 28, w: 172, h: 36 },
    previousProjection: { x: 616, y: ROW_BOTTOM, w: 56, h: ROW_HEIGHT },
    nextProjection: { x: 912, y: ROW_BOTTOM, w: 56, h: ROW_HEIGHT },
    passthrough: { x: 984, y: ROW_BOTTOM, w: 88, h: ROW_HEIGHT },
    recenter: { x: 1080, y: ROW_BOTTOM, w: 88, h: ROW_HEIGHT },
    exit: { x: 1176, y: ROW_BOTTOM, w: 88, h: ROW_HEIGHT },
};
// Without passthrough (no AR session) the projection switcher takes the button's place
const { passthrough: _, ...withoutPassthrough } = AREAS_WITH_PASSTHROUGH;
const AREAS_WITHOUT_PASSTHROUGH = {
    ...withoutPassthrough,
    nextProjection: { x: 1004, y: ROW_BOTTOM, w: 56, h: ROW_HEIGHT },
};
const SLIDERS = new Set(['seek', 'volume']);

// Steam Deck / Steam Frame colours
const THEME = {
    panel: 'rgba(35, 38, 46, 0.96)',
    focus: '#3d4450',
    button: '#323843',
    accent: '#1a9fff',
    track: '#4b5260',
    buffered: '#6b7280',
    separator: '#3a3f4a',
    text: '#dcdedf',
    label: '#b8bcbf',
    font: '"Motiva Sans", "Segoe UI", system-ui, sans-serif',
};

// A transparent plane with a white shape drawn by draw(context, width, height); the plane is
// bigger than the shape so it's easy to hit
function handleMesh(width, height, pixelsPerMetre, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * pixelsPerMetre);
    canvas.height = Math.round(height * pixelsPerMetre);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.strokeStyle = '#fff';
    draw(context, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: HANDLE_OPACITY, depthWrite: false }),
    );
}

// The pill-shaped bar under a window, dragged to move it
function moveBar(width) {
    return handleMesh(width, width / 6, 1024, (c, w, h) => {
        const barHeight = h / 4;
        c.beginPath();
        c.roundRect(0, (h - barHeight) / 2, w, barHeight, barHeight / 2);
        c.fill();
    });
}

// The rounded corner bracket at a window's bottom right, dragged to resize it. The plane is
// centred on the window's corner; the bracket sits just outside it.
function resizeCorner(size) {
    return handleMesh(size, size, 1024, (c, w, h) => {
        const line = w / 14;
        const radius = w / 5;
        const gap = line * 1.5; // between the window's edge and the bracket
        const right = w / 2 + gap;
        const bottom = h / 2 + gap;
        const length = w / 2 - line;
        c.lineWidth = line;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(right, bottom - length);
        c.lineTo(right, bottom - radius);
        c.arcTo(right, bottom, right - radius, bottom, radius);
        c.lineTo(right - length, bottom);
        c.stroke();
    });
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '--:--';
    const s = Math.floor(seconds % 60)
        .toString()
        .padStart(2, '0');
    const m = Math.floor(seconds / 60) % 60;
    const h = Math.floor(seconds / 3600);
    return h ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export class VRControls {
    // player: the VRPlayer whose video, scene and screen these controls drive
    constructor(player) {
        this.player = player;
        this.video = player.video;
        this.renderer = player.renderer;
        this.raycaster = new THREE.Raycaster();

        this.canvas = document.createElement('canvas');
        this.canvas.width = CANVAS_W;
        this.canvas.height = CANVAS_H;
        this.context = this.canvas.getContext('2d');
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.panel = new THREE.Mesh(
            new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT),
            new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }),
        );
        this.panel.visible = false;
        this.resetPanelPosition();
        player.scene.add(this.panel);

        // handles: each knows what it moves or resizes
        this.panelBar = moveBar(0.3);
        this.panelBar.userData = { handle: 'move', target: this.panel };
        this.panel.add(this.panelBar);
        this.screenBar = moveBar(0.5);
        this.screenBar.userData = { handle: 'move', target: player.screen };
        this.screenCorner = resizeCorner(0.3);
        this.screenCorner.userData = { handle: 'resize', target: player.screen };
        player.screen.add(this.screenBar, this.screenCorner);
        this.handles = [this.panelBar, this.screenBar, this.screenCorner];
        this.plane = new THREE.Plane();
        this.quaternion = new THREE.Quaternion();
        this.facing = new THREE.Object3D(); // works out which way a dragged window faces

        this.controllers = [0, 1].map((index) => this.createController(index));

        this.onSessionStart = () => {
            this.panel.visible = true;
        };
        this.onSessionEnd = () => {
            this.panel.visible = false;
            for (const controller of this.controllers) this.release(controller);
        };
        this.renderer.xr.addEventListener('sessionstart', this.onSessionStart);
        this.renderer.xr.addEventListener('sessionend', this.onSessionEnd);
    }

    createController(index) {
        const controller = this.renderer.xr.getController(index);
        const laser = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
        );
        laser.scale.z = LASER_LENGTH;
        const dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.006, 12, 8),
            new THREE.MeshBasicMaterial({ color: 0xffffff }),
        );
        dot.visible = false;
        controller.add(laser, dot);
        controller.userData = {
            laser,
            dot,
            hover: null, // { object: panel, screen or handle, hit }
            held: null, // what the controller carries
            heldByTrigger: false, // carried by a bar (trigger) rather than the grip
            resizing: null,
            sliding: null,
            buttons: [],
        };

        controller.addEventListener('connected', (event) => {
            controller.userData.inputSource = event.data;
        });
        controller.addEventListener('disconnected', () => {
            this.release(controller);
            controller.userData.inputSource = null;
        });
        controller.addEventListener('selectstart', () => this.onTrigger(controller));
        controller.addEventListener('selectend', () => {
            controller.userData.sliding = null;
            controller.userData.resizing = null;
            if (controller.userData.heldByTrigger) this.release(controller);
        });
        controller.addEventListener('squeezestart', () => this.grab(controller));
        controller.addEventListener('squeezeend', () => this.release(controller));
        this.player.scene.add(controller);
        return controller;
    }

    // Below the screen, tilted towards the viewer
    resetPanelPosition(origin = new THREE.Vector3(), yaw = 0) {
        const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        this.panel.position.copy(origin).addScaledVector(forward, 1.0);
        this.panel.position.y -= 0.45;
        this.panel.rotation.set(-0.5, yaw, 0, 'YXZ');
    }

    // What the laser can hit: the panel, and the screen when the video is shown flat
    targets() {
        const targets = [];
        if (this.panel.visible) targets.push(this.panel);
        if (this.player.projection === 'FLAT') targets.push(this.player.screen);
        return targets;
    }

    // Called every frame before rendering
    update(delta) {
        if (!this.renderer.xr.isPresenting) return;
        this.layoutHandles();
        for (const controller of this.controllers) this.updateController(controller, delta);
        // handles light up while pointed at or in use
        for (const handle of this.handles) {
            const { handle: kind, target } = handle.userData;
            const active = this.controllers.some(
                ({ userData: d }) =>
                    d.hover?.object === handle ||
                    (kind === 'move' && d.heldByTrigger && d.held === target) ||
                    (kind === 'resize' && d.resizing === target),
            );
            handle.material.opacity = active ? 1 : HANDLE_OPACITY;
        }
        if (this.panel.visible) this.draw();
    }

    // The handles follow their window's edges but keep their own size (and their gap to the
    // window) when the window is scaled, like in the Steam Frame's UI
    layoutHandles() {
        const panelScale = this.panel.scale.x;
        this.panelBar.scale.setScalar(1 / panelScale);
        this.panelBar.position.set(0, -PANEL_HEIGHT / 2 - 0.04 / panelScale, 0.001);

        const flat = this.player.projection === 'FLAT';
        this.screenBar.visible = flat;
        this.screenCorner.visible = flat;
        if (!flat) return;
        const { width, height } = this.screenSize();
        const scale = this.player.screen.scale.x;
        this.screenBar.scale.setScalar(1 / scale);
        this.screenBar.position.set(0, -height / 2 - 0.07 / scale, 0.001);
        this.screenCorner.scale.setScalar(1 / scale);
        this.screenCorner.position.set(width / 2, -height / 2, 0.002);
    }

    screenSize() {
        const mesh = this.player.meshes[0];
        return mesh?.geometry.parameters ?? { width: 1, height: 1 };
    }

    updateController(controller, delta) {
        const data = controller.userData;
        const gamepad = data.inputSource?.gamepad;
        if (gamepad) {
            // A/X or B/Y, on the press only
            for (const button of [BUTTON_A_X, BUTTON_B_Y]) {
                const pressed = !!gamepad.buttons[button]?.pressed;
                if (pressed && !data.buttons[button]) this.togglePanel();
                data.buttons[button] = pressed;
            }
        }

        this.raycaster.setFromXRController(controller);
        if (data.resizing) this.resize(data.resizing, delta);
        const hit = data.held || data.resizing ? null : this.raycaster.intersectObjects(this.targets(), true)[0];
        data.hover = hit ? { object: this.hitTarget(hit.object), hit } : null;
        const length = hit ? hit.distance : LASER_LENGTH;
        data.laser.scale.z = length;
        data.dot.visible = !!hit;
        data.dot.position.set(0, 0, -length);
        if (data.held) this.dragHeld(data, gamepad?.axes, delta);

        if (data.sliding) {
            const point = this.panelPoint(hit);
            if (point) this.slide(data.sliding, point);
        }
    }

    // The panel, the screen or a handle, for a mesh the laser hit
    hitTarget(object) {
        if (object.userData.handle) return object;
        return object === this.panel ? this.panel : this.player.screen;
    }

    // Scales the screen around its centre so its bottom right corner follows the laser, eased
    // like dragging
    resize(screen, delta) {
        const center = screen.getWorldPosition(new THREE.Vector3());
        screen.getWorldQuaternion(this.quaternion);
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
        this.plane.setFromNormalAndCoplanarPoint(normal, center);
        const point = this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
        if (!point) return;
        const local = point.sub(center).applyQuaternion(this.quaternion.invert());
        const { width, height } = this.screenSize();
        const scale = Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, Math.max(local.x / (width / 2), -local.y / (height / 2))),
        );
        const ease = 1 - Math.exp(-delta * SMOOTHING);
        screen.scale.setScalar(THREE.MathUtils.lerp(screen.scale.x, scale, ease));
    }

    // Canvas pixel under a laser hit on the panel
    panelPoint(hit) {
        if (!hit || hit.object !== this.panel || !hit.uv) return null;
        return { x: hit.uv.x * CANVAS_W, y: (1 - hit.uv.y) * CANVAS_H };
    }

    // The panel's layout; the passthrough button only shows in sessions that can do it
    get areas() {
        return this.player.passthroughAvailable ? AREAS_WITH_PASSTHROUGH : AREAS_WITHOUT_PASSTHROUGH;
    }

    areaAt(point) {
        if (!point) return null;
        for (const [name, area] of Object.entries(this.areas)) {
            // sliders get a taller hit area than they're drawn
            const pad = SLIDERS.has(name) ? 24 : 0;
            if (
                point.x >= area.x &&
                point.x <= area.x + area.w &&
                point.y >= area.y - pad &&
                point.y <= area.y + area.h + pad
            ) {
                return name;
            }
        }
        return null;
    }

    onTrigger(controller) {
        const hover = controller.userData.hover;
        if (hover?.object.userData.handle === 'move') {
            this.grab(controller, true);
            return;
        }
        if (hover?.object.userData.handle === 'resize') {
            controller.userData.resizing = hover.object.userData.target;
            return;
        }
        if (hover?.object === this.player.screen && hover.hit.uv) {
            this.clickScreen(hover.hit.uv.x);
            return;
        }
        if (!this.panel.visible) {
            this.showPanel();
            return;
        }
        const point = this.panelPoint(controller.userData.hover?.hit);
        const area = this.areaAt(point);
        if (!area) return;
        if (SLIDERS.has(area)) {
            controller.userData.sliding = area;
            this.slide(area, point);
            return;
        }
        this.activate(area);
    }

    // Clicks on the flat screen work like YouTube on a phone: a click plays/pauses, a double
    // click on the left or right third skips back or forward, and every further click there
    // skips again. A click on a side waits briefly to see whether it's a double click.
    clickScreen(x) {
        const zone = x < 1 / 3 ? 'back' : x > 2 / 3 ? 'forward' : null;
        const now = performance.now();
        const last = this.lastScreenClick;
        this.lastScreenClick = { time: now, zone };
        clearTimeout(this.screenClickTimer);
        if (zone && last?.zone === zone && now - last.time < DOUBLE_CLICK_MS) {
            this.activate(zone);
        } else if (zone) {
            this.screenClickTimer = setTimeout(() => this.activate('play'), DOUBLE_CLICK_MS);
        } else {
            this.activate('play');
        }
    }

    activate(area) {
        const video = this.video;
        switch (area) {
            case 'play':
                if (video.paused) video.play().catch(() => {});
                else video.pause();
                break;
            case 'back':
                video.currentTime = Math.max(0, video.currentTime - SKIP_SECONDS);
                break;
            case 'forward':
                video.currentTime = Math.min(video.duration || Infinity, video.currentTime + SKIP_SECONDS);
                break;
            case 'mute':
                video.muted = !video.muted;
                break;
            case 'previousProjection':
            case 'nextProjection': {
                const ids = PROJECTION_LABELS.map(([id]) => id);
                const step = area === 'nextProjection' ? 1 : -1;
                const index = (ids.indexOf(this.player.projection) + step + ids.length) % ids.length;
                this.player.setProjection(ids[index]);
                break;
            }
            case 'passthrough':
                if (this.player.passthroughAvailable) this.player.setPassthrough(!this.player.passthrough);
                break;
            case 'recenter':
                this.recenter();
                break;
            case 'exit':
                this.renderer.xr.getSession()?.end();
                break;
        }
    }

    slide(area, point) {
        const { x, w } = this.areas[area];
        const fraction = Math.min(1, Math.max(0, (point.x - x) / w));
        if (area === 'seek') {
            if (Number.isFinite(this.video.duration)) this.video.currentTime = fraction * this.video.duration;
        } else {
            this.video.volume = fraction;
            this.video.muted = fraction === 0;
        }
    }

    togglePanel() {
        if (this.panel.visible) this.panel.visible = false;
        else this.showPanel();
    }

    // Shows the panel, bringing it back in front of the viewer if it was moved out of view
    showPanel() {
        this.panel.visible = true;
        const { position, direction, yaw } = this.headPose();
        const toPanel = this.panel.getWorldPosition(new THREE.Vector3()).sub(position);
        const distance = toPanel.length();
        const angle = toPanel.angleTo(direction);
        if (angle > 0.8 || distance < 0.3 || distance > 4) this.resetPanelPosition(position, yaw);
    }

    // Where the viewer's head is and where it looks
    headPose() {
        const head = this.renderer.xr.getCamera();
        const position = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
        const direction = new THREE.Vector3(0, 0, -1).transformDirection(head.matrixWorld);
        return { position, direction, yaw: Math.atan2(-direction.x, -direction.z) };
    }

    // Picks up what the laser points at (a handle picks up its window). It then hangs on the
    // laser at the same distance, held at the point where it was grabbed.
    grab(controller, byTrigger = false) {
        const hover = controller.userData.hover;
        const target = hover?.object.userData.target ?? hover?.object;
        if (!target || this.controllers.some((c) => c.userData.held === target)) return;
        Object.assign(controller.userData, {
            held: target,
            heldByTrigger: byTrigger,
            sliding: null,
            resizing: null,
            grabDistance: hover.hit.distance,
            grabPoint: target.worldToLocal(hover.hit.point.clone()), // in the target's unscaled units
            grabScale: target.scale.x,
        });
    }

    release(controller) {
        controller.userData.held = null;
        controller.userData.heldByTrigger = false;
    }

    // Moves a held window along the laser, turned to face the viewer: the screen stays upright,
    // the panel also tilts towards the viewer, neither rolls. The thumbstick moves it
    // away/closer (forward/back) and resizes it (left/right). It eases towards where the
    // controller says, which smooths out the hand's and the tracking's jitter.
    dragHeld(data, axes, delta) {
        const object = data.held;
        const push = -(axes?.[AXIS_STICK_Y] || 0);
        const grow = axes?.[AXIS_STICK_X] || 0;
        if (Math.abs(push) > 0.2) {
            data.grabDistance = Math.min(20, Math.max(0.3, data.grabDistance * (1 + push * delta * 1.5)));
        }
        if (Math.abs(grow) > 0.2) {
            data.grabScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, data.grabScale * (1 + grow * delta)));
        }

        const ray = this.raycaster.ray;
        const point = ray.origin.clone().addScaledVector(ray.direction, data.grabDistance);
        const head = this.headPose().position;
        this.facing.position.copy(point);
        this.facing.lookAt(head.x, object === this.panel ? head.y : point.y, head.z);
        // where the object's origin goes so the grabbed point lands on the laser
        const offset = data.grabPoint.clone().multiplyScalar(data.grabScale).applyQuaternion(this.facing.quaternion);
        const position = point.sub(offset);

        const ease = 1 - Math.exp(-delta * SMOOTHING);
        object.position.lerp(position, ease);
        object.quaternion.slerp(this.facing.quaternion, ease);
        object.scale.setScalar(THREE.MathUtils.lerp(object.scale.x, data.grabScale, ease));
        data.laser.scale.z = data.grabDistance;
    }

    // Puts the screen, the panel and the front of 360°/180° videos where the viewer looks
    recenter() {
        const { position, yaw } = this.headPose();
        this.player.placeScreen(position, yaw);
        this.player.world.position.copy(position);
        this.player.world.rotation.set(0, yaw, 0);
        this.resetPanelPosition(position, yaw);
    }

    // Styled after the Steam Frame UI: dark slate panel, a lighter button with a blue underline
    // for the focused control, thin sliders with a blue fill and a white knob
    draw() {
        const video = this.video;
        const hovered = new Set(
            this.controllers.map((c) => this.areaAt(this.panelPoint(c.userData.hover?.hit))).filter(Boolean),
        );
        // only redraw when something visible changed
        const state = [
            Math.floor(video.currentTime),
            Math.floor(video.duration),
            video.paused,
            video.muted,
            video.volume.toFixed(2),
            this.player.projection,
            this.player.passthrough,
            this.player.passthroughAvailable,
            [...hovered].join(),
            Math.floor(video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0),
        ].join('|');
        if (state === this.drawnState) return;
        this.drawnState = state;

        const c = this.context;
        const areas = this.areas;
        const roundRect = (x, y, w, h, r, color) => {
            c.fillStyle = color;
            c.beginPath();
            c.roundRect(x, y, w, h, r);
            c.fill();
        };
        const text = (
            value,
            x,
            y,
            { size = 28, color = THEME.text, align = 'center', weight = 500, spacing = 0 } = {},
        ) => {
            c.font = `${weight} ${size}px ${THEME.font}`;
            c.letterSpacing = `${spacing}px`;
            c.textAlign = align;
            c.textBaseline = 'middle';
            c.fillStyle = color;
            c.fillText(value, x, y);
            c.letterSpacing = '0px';
        };
        // focused control: lighter background with a short blue line centred at the bottom
        const focus = (x, y, w, h) => {
            roundRect(x, y, w, h, 4, THEME.focus);
            const line = w * 0.5;
            roundRect(x + (w - line) / 2, y + h - 10, line, 5, 2.5, THEME.accent);
        };
        // filled: a grey button; active: a switched-on toggle, drawn blue
        const iconButton = (name, drawIcon, { filled = false, active = false } = {}) => {
            const { x, y, w, h } = areas[name];
            if (hovered.has(name)) focus(x, y, w, h);
            else if (filled) roundRect(x, y, w, h, 4, THEME.button);
            c.save();
            c.translate(x + w / 2, y + h / 2);
            const color = active ? THEME.accent : THEME.text;
            c.fillStyle = color;
            c.strokeStyle = color;
            c.lineWidth = 4;
            c.lineCap = 'round';
            c.lineJoin = 'round';
            drawIcon();
            c.restore();
        };
        const slider = (name, fraction, buffered = 0) => {
            const { x, y, w, h } = areas[name];
            const mid = y + h / 2;
            roundRect(x, mid - 4, w, 8, 4, THEME.track);
            if (buffered) roundRect(x, mid - 4, w * buffered, 8, 4, THEME.buffered);
            roundRect(x, mid - 4, w * fraction, 8, 4, THEME.accent);
            c.fillStyle = '#fff';
            c.beginPath();
            c.arc(x + w * fraction, mid, 20, 0, Math.PI * 2);
            c.fill();
        };
        const speaker = (muted) => {
            c.beginPath();
            c.moveTo(-22, -8);
            c.lineTo(-12, -8);
            c.lineTo(0, -20);
            c.lineTo(0, 20);
            c.lineTo(-12, 8);
            c.lineTo(-22, 8);
            c.closePath();
            c.fill();
            c.beginPath();
            if (muted) {
                c.moveTo(10, -9);
                c.lineTo(26, 9);
                c.moveTo(26, -9);
                c.lineTo(10, 9);
            } else {
                c.arc(2, 0, 12, -0.9, 0.9);
                c.moveTo(2 + 22 * Math.cos(-0.9), 22 * Math.sin(-0.9));
                c.arc(2, 0, 22, -0.9, 0.9);
            }
            c.stroke();
        };
        // circular arrow around the skip seconds, open at the top, pointing back or forward
        const skipIcon = (direction) => {
            const gapStart = -Math.PI / 2 - 0.5;
            const gapEnd = -Math.PI / 2 + 0.5;
            c.beginPath();
            c.arc(0, 0, 24, gapEnd, gapStart);
            c.stroke();
            // arrowhead on the end the arrow turns towards
            const tipAngle = direction < 0 ? gapEnd : gapStart;
            const tx = 24 * Math.cos(tipAngle);
            const ty = 24 * Math.sin(tipAngle);
            c.beginPath();
            c.moveTo(tx - 9 * direction, ty - 7);
            c.lineTo(tx, ty);
            c.lineTo(tx - 9 * direction, ty + 7);
            c.stroke();
            text(String(SKIP_SECONDS), 0, 2, { size: 18, weight: 700 });
        };

        c.clearRect(0, 0, CANVAS_W, CANVAS_H);
        roundRect(0, 0, CANVAS_W, CANVAS_H, 12, THEME.panel);

        // row 1: time, seek bar, duration; the whole row lights up when focused, like a
        // Quick Settings slider row
        const duration = video.duration;
        const seekable = Number.isFinite(duration) && duration > 0;
        const seekMid = areas.seek.y + areas.seek.h / 2;
        if (hovered.has('seek')) roundRect(16, ROW_TOP - 8, CANVAS_W - 32, 96, 4, THEME.focus);
        text(formatTime(video.currentTime), 80, seekMid, { color: THEME.label });
        text(seekable ? formatTime(duration) : 'LIVE', 1200, seekMid, {
            color: THEME.label,
            spacing: seekable ? 0 : 2,
        });
        const buffered =
            video.buffered.length && seekable ? video.buffered.end(video.buffered.length - 1) / duration : 0;
        slider('seek', seekable ? video.currentTime / duration : 1, buffered);

        roundRect(16, ROW_BOTTOM - 14, CANVAS_W - 32, 2, 1, THEME.separator);

        // row 2: transport, volume, projection, recenter, exit
        iconButton('back', () => skipIcon(-1));
        iconButton('play', () => {
            c.beginPath();
            if (video.paused) {
                c.moveTo(-13, -20);
                c.lineTo(20, 0);
                c.lineTo(-13, 20);
                c.closePath();
                c.fill();
            } else {
                c.fillRect(-15, -19, 10, 38);
                c.fillRect(5, -19, 10, 38);
            }
        });
        iconButton('forward', () => skipIcon(1));
        iconButton('mute', () => speaker(video.muted || video.volume === 0));
        if (hovered.has('volume')) {
            const { x, w } = areas.volume;
            roundRect(x - 20, ROW_BOTTOM, w + 40, ROW_HEIGHT, 4, THEME.focus);
        }
        slider('volume', video.muted ? 0 : video.volume);

        iconButton('previousProjection', () => text('‹', 0, -3, { size: 52, weight: 400 }));
        iconButton('nextProjection', () => text('›', 0, -3, { size: 52, weight: 400 }));
        const label = PROJECTION_LABELS.find(([id]) => id === this.player.projection)?.[1] ?? '';
        const labelX = (areas.previousProjection.x + areas.previousProjection.w + areas.nextProjection.x) / 2;
        text('PROJECTION', labelX, ROW_BOTTOM + 26, { size: 18, color: THEME.label, weight: 600, spacing: 2 });
        text(label, labelX, ROW_BOTTOM + 60, { size: 24 });

        // passthrough, only in sessions that can show the room: a headset with the room's
        // horizon showing through its visor
        if (areas.passthrough) {
            iconButton(
                'passthrough',
                () => {
                    c.beginPath();
                    c.roundRect(-26, -15, 52, 30, 10);
                    c.stroke();
                    c.beginPath();
                    c.moveTo(-14, 5);
                    c.lineTo(-5, -4);
                    c.lineTo(3, 3);
                    c.lineTo(8, -2);
                    c.lineTo(14, 5);
                    c.stroke();
                },
                { filled: true, active: this.player.passthrough },
            );
        }
        // recenter: a target
        iconButton(
            'recenter',
            () => {
                c.beginPath();
                c.arc(0, 0, 14, 0, Math.PI * 2);
                c.moveTo(0, -24);
                c.lineTo(0, -8);
                c.moveTo(0, 8);
                c.lineTo(0, 24);
                c.moveTo(-24, 0);
                c.lineTo(-8, 0);
                c.moveTo(8, 0);
                c.lineTo(24, 0);
                c.stroke();
            },
            { filled: true },
        );
        // exit VR: an arrow out of a door
        iconButton(
            'exit',
            () => {
                c.beginPath();
                c.moveTo(2, -20);
                c.lineTo(-20, -20);
                c.lineTo(-20, 20);
                c.lineTo(2, 20);
                c.moveTo(-6, 0);
                c.lineTo(22, 0);
                c.moveTo(13, -9);
                c.lineTo(22, 0);
                c.lineTo(13, 9);
                c.stroke();
            },
            { filled: true },
        );

        this.texture.needsUpdate = true;
    }

    dispose() {
        clearTimeout(this.screenClickTimer);
        this.renderer.xr.removeEventListener('sessionstart', this.onSessionStart);
        this.renderer.xr.removeEventListener('sessionend', this.onSessionEnd);
        for (const controller of this.controllers) {
            this.release(controller);
            this.player.scene.remove(controller);
            for (const child of [...controller.children]) {
                child.geometry.dispose();
                child.material.dispose();
                controller.remove(child);
            }
        }
        for (const handle of this.handles) {
            handle.removeFromParent();
            handle.geometry.dispose();
            handle.material.map.dispose();
            handle.material.dispose();
        }
        this.player.scene.remove(this.panel);
        this.panel.geometry.dispose();
        this.panel.material.dispose();
        this.texture.dispose();
    }
}
