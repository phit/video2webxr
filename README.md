# Enable Youtube PC VR in Chromium

I couldn't find a way to watch Youtube VR videos on the PC without paying?

This is a Chromium extension to enable WebXR on Youtube 360°, VR180 and 3D videos thanks to https://threejs.org/

### Install Instructions - Easy way
1. Using Microsoft Edge, open the extension page at: https://microsoftedge.microsoft.com/addons/detail/enable-youtube-pc-vr-in-e/bcadncfmfmigccocnahamkkpbfopjffp
2. Click "Get" on the right hand side

### Install Instructions - Manual way
1. Install a Chromium based browser - Chrome, Edge, Brave etc.
2. Download the project from github and unzip it to a folder
3. Open the extensions in the browser and enable developer mode
4. Click "Load Unpacked" and choose the folder

### Usage Instructions
1. Turn VR on first
2. Start a new browser so that it detects the hardware
3. Open a 360° or VR180 video on https://www.youtube.com/vr/
4. Click on the white cardboard icon in the bottom right hand corner of the video
5. Pick the video's projection in the dropdown next to the "Enter VR" button (see below)
6. Click on the "Enter VR" button in the middle bottom of the video
7. Enjoy

| Projection | Use it for |
|---|---|
| 360° EAC (YouTube default) | 360° videos - this is how YouTube serves them on desktop |
| 360° EAC 3D | 3D 360° videos served as stereo EAC |
| 360° cubemap | videos in a plain 3x2 cubemap layout |
| 360° equirectangular | 360° videos served as a single equirectangular image |
| 360° 3D top/bottom, side by side | 3D equirectangular 360° videos |
| 180° | VR180 videos |
| 180° 3D side by side | 3D 180° videos with both eyes side by side |
| Flat screen | videos YouTube only serves as a normal 16:9 picture |

You can switch the projection while in VR. If the image looks jumbled into squares, try a 360° EAC option; if it looks stretched or doubled, try the others.

![Click the Cardboard Icon](pcytvr1.png)
![Click the Enter VR Button](pcytvr2.png)

### Troubleshooting
If it stops working after switching videos try refreshing the browser and it should be able to be enabled again

If it says "VR NOT SUPPPORTED" then the browser hasn't detected your hardware
- Make sure your VR is turned on and calibrated to your room
- Make sure you have given Youtube.com permission to access "Virtual reality" in the "site permissions"
- Microsoft Edge may not detect SteamVR by default; start it with `--enable-features=WebXR,OpenXR --force-webxr-runtime=openxr`
- Only one browser can use the headset at a time; close other browser windows that have entered VR
- I have tested this on a HTC Vive Cosmos, please let me know if it works on other hardware configurations - it is generic and should work most devices

If you don't see the white cardboard icon in the bottom right hand corner of the youtube.com video then the extension is not installed or disabled

There isn't much error handling, pull requests welcome