import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

let camera, scene, renderer, videoMaterial;
let vrVideo, onVideoResize, buttonRow;
let videoMeshes = [];
let projection = 'EAC'; // what YouTube serves 360° videos as on desktop

// Chrome exposes XRWebGLBinding.createProjectionLayer even when the session isn't granted
// the 'layers' feature. three.js only checks that the method exists, sets up a projection
// layer the session can't use, and Chrome then never delivers an XR frame (SteamVR shows
// "not responding"). Hide it so three.js falls back to XRWebGLLayer. This only affects the
// extension's isolated world, not YouTube's own scripts.
if (typeof XRWebGLBinding !== 'undefined') {
    delete XRWebGLBinding.prototype.createProjectionLayer;
}

// Function to be executed when the cardboard icon is clicked
function handleCardboardIconClick() {
    const videoElement = document.querySelectorAll('video')[0]
    console.log("clicked cardboard button");
    if (renderer) {
        console.log("VR already enabled, ignoring click");
        return;
    }
    EnableVRVideo(videoElement)
    animate();
}
  
// Function to add the cardboard icon to a video element
function addCardboardIconToVideo() {
    // Check if the img has already been added
    const iconCheck = document.querySelector('#cardboardimg');
    if (iconCheck) {
        return;
    }
    // Create a new <img> element for the cardboard icon
    const iconImg = document.createElement('img');
    const cardboardimg = 'data:application/octet-stream;base64,iVBORw0KGgoAAAANSUhEUgAAADQAAAA0CAYAAADFeBvrAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsIAAA7CARUoSoAAAANnSURBVGhD7ZhNaxNBGMezMdsEigRa8IUeBMGUCj1JUehFQSwe6hfwoDf9BB700Lsfwp7Egy+oVQqiR6keJAejhEgC6UmkREjMa5vE/9P8DaYzm9lNUkjo/GDYeWb+88zz7OzMbhKyWCwWi8VisUwsDq8KjUZj1nXdGKrtTsvY4CC2SjQa/U27ByWhVCoVXlhYeOg4zi0UF01jl1C73a6jrGez2fuJRKLFdj17e3t3IZ4IEOsdht0lzOv/XON1EljhtYuSEBKXx2wi0MWqW6Fx2zP9UGLVJTTR2ITGnYETwoZM4dh822q1tlCvsnlg4KMmvsSn+Gbz8Ozu7r6GQ08w6Xdorubz+WMcEqrX6/Nof0lJYJrN5gbe/ufpLpTL5SKYYwU+M5RokVg5xJt+CWGCHIKfo1QB/S8o9Q2SeYWh2k8wJHkGPvOUKgydEPpuUqYFyZ5FAEXKjUD7B2MSHK4Fj+BtyhV0CfneQxi/gzv2jqYWfDDmoPtE0wi0WxiToakFCcue2qFpxHdC+FAtYPIiTU+g22bVCLR5Vj2Zmpoqytw0jQRZoelarRal6Ql0s6wa8aPFCkVlbppGgqzQHFZoiaaWSqUyA90lmkagvShjaGrBCi3J3DSNBHoPhcPhtWQy2T2uD4KE72HyUzT/IZs/LUXqnaYO0J6WMTQVZC6wRnMw+p1yAo7ZZ9Vq9STl++CdFMFp9ICSLkjiB/xdTqfTESlSlzZ2d5Gx4oPu9pE5ZC5KtOhOOeX8F1EkElmlqQW+fqK8QZG7fgIrdx13e7HT2wF9dQS6jEfmC5v2wUl5Af4/Qt+zH6H/imQ3Uf2FvnmUVZSDq90D/G+4rnuDph7TCvkFd/c5XSpIH2VDoVuhQHsoCJhvnVWFfn3DcigJIeB0uVx+T1NB+kRDc6QcVkKP4/F4jaaC9ImG5kgZeUIItIw98oSmJ6IRLc2RoSSESVgbDIzfxMmWpemJaERLc2QoCeEIHiojHL2PWDUSRKsDx7qvP0k+8xoY3PFvhULhA00josWYYX6dmmMtlUrT8obG3RPkbe+3bONFd4VufIMX7bKMPeDLVFqI8anESjddPP+sx5f1Il5cx1E1PYIOvreaeFQzsVhM+we6Ccw1gwDPIU4/h5QjPynwDTi6/x0sFovFYrEcCUKhvx967WCqRNtOAAAAAElFTkSuQmCC'
    iconImg.src = cardboardimg
    iconImg.id = 'cardboardimg'
    iconImg.className = 'ytp-button';
  
    // Attach the onclick event to the cardboard icon
    iconImg.onclick = handleCardboardIconClick;
  
    const rightControls = document.querySelector('.ytp-right-controls');
    if (rightControls) {
        // Append the image to the div element
        rightControls.appendChild(iconImg);
    }
}

// Create a MutationObserver to watch for new video elements
const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(addedNode => {
        // Check if the added node is a video element
        if (addedNode instanceof HTMLVideoElement) {
            addCardboardIconToVideo(addedNode);
        }
        });
    });
});

// Attach the cardboard icon to each video element
const videoElements = document.querySelectorAll('video');
videoElements.forEach(video => {
    addCardboardIconToVideo(video);
});

// Start observing the entire document for changes
observer.observe(document, { childList: true, subtree: true });

function EnableVRVideo(videoElement) {
    console.log("enabling VR on " + videoElement);
    
    // remove the webgl viewer of the 360 video
    const webgl = document.querySelector('.webgl')
    if (webgl) { webgl.remove(); }
    const spherecontrol = document.querySelector('.ytp-webgl-spherical-control');
    if (spherecontrol) { spherecontrol.remove(); }

    camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 1, 2000 );
    camera.layers.enable( 1 ); // render left view when no stereo available

    const texture = new THREE.VideoTexture(videoElement);
    texture.colorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    scene.background = new THREE.Color( 0x101010 );

    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    videoMaterial = new THREE.MeshBasicMaterial({ map: texture });
    setProjection(projection);
    // the geometry depends on the video's aspect ratio, which can change with quality switches
    vrVideo = videoElement;
    onVideoResize = () => setProjection(projection);
    videoElement.addEventListener('resize', onVideoResize);

    renderer = new THREE.WebGLRenderer();
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType( 'local' );

    const container = document.querySelector('.html5-video-container')
    container.appendChild( renderer.domElement );
    
    // clean alerts box and add VR button
    const alertsbox = document.querySelector('#alerts')
    if (alertsbox) {
        if (alertsbox.firstChild) {
            alertsbox.removeChild(alertsbox.firstChild);
        }
        // lay the VR button and the projection dropdown out side by side
        buttonRow = document.createElement('div');
        buttonRow.style.display = 'flex';
        buttonRow.style.justifyContent = 'center';
        buttonRow.style.gap = '8px';
        const vrButton = VRButton.createButton( renderer );
        vrButton.style.position = 'static';
        buttonRow.appendChild( vrButton );
        buttonRow.appendChild( createProjectionSelect() );
        alertsbox.appendChild( buttonRow );
    }

    window.addEventListener( 'resize', onWindowResize );
}

// Texture regions for each eye: [offsetU, offsetV, scaleU, scaleV]
const FULL_FRAME = [0, 0, 1, 1];
const LEFT_HALF = [0, 0, 0.5, 1], RIGHT_HALF = [0.5, 0, 0.5, 1];
const TOP_HALF = [0, 0.5, 1, 0.5], BOTTOM_HALF = [0, 0, 1, 0.5];

// Each projection builds its meshes. Stereo projections put one mesh on layer 1 (left eye)
// and one on layer 2 (right eye); three.js renders those layers to the matching eye in VR.
const PROJECTIONS = {
    'EAC':    { label: '360° EAC (YouTube default)', build: () => [eacMesh()] },
    'EAC_LR': { label: '360° EAC 3D', build: () => eacStereoMeshes() },
    'CUBE':   { label: '360° cubemap', build: () => [boxMesh(videoMaterialBackSide(), CUBE_FACES)] },
    '360':    { label: '360° equirectangular', build: () => [sphereMesh(false, FULL_FRAME)] },
    '360_TB': { label: '360° 3D top/bottom', build: () => [sphereMesh(false, TOP_HALF, 1), sphereMesh(false, BOTTOM_HALF, 2)] },
    '360_LR': { label: '360° 3D side by side', build: () => [sphereMesh(false, LEFT_HALF, 1), sphereMesh(false, RIGHT_HALF, 2)] },
    '180':    { label: '180°', build: () => [sphereMesh(true, FULL_FRAME)] },
    '180_LR': { label: '180° 3D side by side', build: () => [sphereMesh(true, LEFT_HALF, 1), sphereMesh(true, RIGHT_HALF, 2)] },
    'FLAT':   { label: 'Flat screen', build: () => [flatScreenMesh()] },
};

// Equirectangular sphere (or front hemisphere for 180°), centred on -Z where the viewer faces.
// The vertical field of view follows the eye's aspect ratio (same angle per pixel both ways),
// e.g. YouTube serves VR180 as 4:3 frames covering 180° x 135°.
function sphereMesh(halfSphere, [offsetU, offsetV, scaleU, scaleV], layer) {
    const horizontalFov = halfSphere ? Math.PI : Math.PI * 2;
    const video = videoMaterial.map.image;
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
    const mesh = new THREE.Mesh(geometry, videoMaterial);
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

function videoMaterialBackSide() {
    const material = videoMaterial.clone();
    material.side = THREE.BackSide;
    return material;
}

// "Continuity correction": EAC faces are packed edge to edge, so trim a 2px strip on each
// face edge to avoid bleeding from the neighbouring face
const EAC_EDGE_PX = 2;

function eacMesh(mapMatrix = new THREE.Matrix3(), scaleMatrix = new THREE.Matrix3(), layer) {
    const video = videoMaterial.map.image;
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
    const material = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
            mapped: { value: videoMaterial.map },
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
    return boxMesh(material, faces, layer);
}

// Stereo EAC: the two eyes' cubemaps side by side, each rotated by 90°
function eacStereoMeshes() {
    const scaleMatrix = new THREE.Matrix3().set(0, 0.5, 0, 1, 0, 0, 0, 0, 1);
    return [
        eacMesh(new THREE.Matrix3().set(0, -0.5, 0.5, 1, 0, 0, 0, 0, 1), scaleMatrix, 1),
        eacMesh(new THREE.Matrix3().set(0, -0.5, 1, 1, 0, 0, 0, 0, 1), scaleMatrix, 2),
    ];
}

// A 2m tall screen 3m in front of the viewer, for videos YouTube only serves flat
function flatScreenMesh() {
    const video = videoMaterial.map.image;
    const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * aspect, 2), videoMaterial);
    mesh.position.set(0, 0, -3);
    return mesh;
}

function setProjection(name) {
    projection = name;
    for (const mesh of videoMeshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        if (mesh.material !== videoMaterial) mesh.material.dispose();
    }
    videoMeshes = PROJECTIONS[name].build();
    for (const mesh of videoMeshes) scene.add(mesh);
}

function createProjectionSelect() {
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
    select.value = projection;
    Object.assign(select.style, {
        padding: '12px 6px', border: '1px solid #fff', borderRadius: '4px',
        background: 'rgba(0,0,0,0.1)', color: '#fff', font: 'normal 13px sans-serif',
        opacity: '0.5', outline: 'none', cursor: 'pointer'
    });
    select.onmouseenter = () => { select.style.opacity = '1.0'; };
    select.onmouseleave = () => { select.style.opacity = '0.5'; };
    select.onchange = () => setProjection(select.value);
    return select;
}

function onWindowResize() {
    if (renderer.xr.isPresenting) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize( window.innerWidth, window.innerHeight );
}

// YouTube switches videos without a page load, so tear everything down when it navigates;
// the cardboard icon can then enable VR again on the next video
async function DisableVRVideo() {
    if (!renderer) return;
    console.log("disabling VR");
    const session = renderer.xr.getSession();
    if (session) await session.end().catch(() => {});
    renderer.setAnimationLoop( null );
    vrVideo.removeEventListener('resize', onVideoResize);
    window.removeEventListener( 'resize', onWindowResize );
    for (const mesh of videoMeshes) {
        mesh.geometry.dispose();
        if (mesh.material !== videoMaterial) mesh.material.dispose();
    }
    videoMeshes = [];
    videoMaterial.map.dispose();
    videoMaterial.dispose();
    renderer.domElement.remove();
    if (buttonRow) buttonRow.remove();
    renderer.dispose();
    renderer = null;
}

document.addEventListener('yt-navigate-start', DisableVRVideo);

function animate() {
    renderer.setAnimationLoop( render );
}

function render() {
    renderer.render( scene, camera );
}