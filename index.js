import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

let camera, scene, renderer;

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

    // Create the sphere geometry
    const sphereGeometry = new THREE.SphereGeometry(500, 60, 40);
    sphereGeometry.scale(-1, 1, 1); // Invert the geometry to match equirectangular projection

    // Create the sphere material
    const sphereMaterial = new THREE.MeshBasicMaterial({ map: texture });

    // Create the video sphere
    const videoSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    scene.add(videoSphere);

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
        alertsbox.appendChild( VRButton.createButton( renderer ) );
        document.querySelector('#VRButton').style.position='relative'
    }

    window.addEventListener( 'resize', onWindowResize );
}

function onWindowResize() {
    if (renderer.xr.isPresenting) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize( window.innerWidth, window.innerHeight );
}

function animate() {
    renderer.setAnimationLoop( render );
}

function render() {
    renderer.render( scene, camera );
}